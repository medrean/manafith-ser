const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

async function cloneSite(targetUrl, outputDir) {
    try {
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const assetsDir = path.join(outputDir, 'assets');
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

        const browserOptions = {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security']
        };

        if (os.platform() === 'win32') {
            browserOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        }

        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });

        const targetOrigin = new URL(targetUrl).origin;
        const urlMap = {};
        const capturedUrls = new Set(); // نستخدم Set لمنع تحميل الملفات المكررة

        // صائد الملفات
        page.on('response', async (response) => {
            const url = response.url();
            if (url.startsWith('data:') || url.startsWith('blob:')) return;

            const status = response.status();
            if (status >= 300 && status <= 399) return;

            const request = response.request();
            const resourceType = request.resourceType();

            if (['image', 'stylesheet', 'script', 'font'].includes(resourceType)) {
                capturedUrls.add(url);
            }
        });

        await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });

        // التمرير لاصطياد كل شيء
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                let distance = 300;
                let scrolls = 0;
                let timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    scrolls++;
                    // زدنا عدد التمريرات لضمان استيقاظ كل سكربتات Next.js
                    if (totalHeight >= document.body.scrollHeight || scrolls >= 25) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 150);
            });
        });

        // 🔴 الضربة الأولى: إجبار المحرك على الانتظار حتى تهدأ الشبكة تماماً وينتهي Next.js من تحميل السكربتات المتأخرة
        await page.waitForNetworkIdle({ idleTime: 1500, timeout: 8000 }).catch(() => { });

        await page.evaluate(() => {
            document.querySelectorAll('meta[http-equiv="refresh"]').forEach(el => el.remove());
        });

        let finalHtml = await page.content();
        await browser.close();

        // التحميل الفعلي
        const urlArray = Array.from(capturedUrls);
        const chunkSize = 15;

        for (let i = 0; i < urlArray.length; i += chunkSize) {
            const chunk = urlArray.slice(i, i + chunkSize);

            await Promise.allSettled(chunk.map(async (url) => {
                try {
                    const parsedUrl = new URL(url);
                    let localPath, localRef;

                    if (parsedUrl.pathname.startsWith('/_next/image')) {
                        const safeName = crypto.createHash('md5').update(url).digest('hex') + '.webp';
                        localPath = path.join(assetsDir, safeName);
                        localRef = '/assets/' + safeName;

                        const htmlRelative = parsedUrl.pathname + parsedUrl.search;
                        urlMap[url] = localRef;
                        urlMap[htmlRelative] = localRef;
                        urlMap[htmlRelative.replace(/&/g, '&amp;')] = localRef;
                    }
                    else if (parsedUrl.origin === targetOrigin) {
                        const relativePath = parsedUrl.pathname.startsWith('/') ? parsedUrl.pathname.substring(1) : parsedUrl.pathname;
                        localPath = path.join(outputDir, relativePath);

                        // 🔴 إجبار المتصفح على تحويل الروابط المطلقة إلى محلية
                        urlMap[url] = parsedUrl.pathname + parsedUrl.search;
                    }
                    else {
                        let ext = path.extname(parsedUrl.pathname);
                        if (!ext) ext = url.includes('image') ? '.webp' : (url.includes('css') ? '.css' : '.js');
                        const safeName = crypto.createHash('md5').update(url).digest('hex').substring(0, 10) + ext;
                        localPath = path.join(assetsDir, safeName);
                        urlMap[url] = '/assets/' + safeName;
                    }

                    if (localPath) {
                        const dir = path.dirname(localPath);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                        if (!fs.existsSync(localPath)) {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 8000);
                            const response = await fetch(url, { signal: controller.signal });
                            clearTimeout(timeoutId);

                            if (response.ok) {
                                const arrayBuffer = await response.arrayBuffer();
                                await fs.promises.writeFile(localPath, Buffer.from(arrayBuffer));
                            }
                        }
                    }
                } catch (err) { }
            }));
        }

        for (const [original, local] of Object.entries(urlMap)) {
            finalHtml = finalHtml.split(original).join(local);
        }

        finalHtml = finalHtml.replace(/src="\/_next\/image\?url=[^"]+"/g, (match) => {
            for (const [originalUrl, localAsset] of Object.entries(urlMap)) {
                if (match.includes(encodeURIComponent(originalUrl)) || match.includes(originalUrl)) {
                    return `src="${localAsset}"`;
                }
            }
            return match;
        });

        const suppressReactErrorsScript = `
<script>
  // تعطيل محرك إعادة البناء القسري لـ React للحفاظ على تعديلات المحرر للأبد
  window.__NEXT_HYDRATED = true;
  if (window.ReactDOM) {
    window.ReactDOM.hydrate = function() { console.log('React hydration bypassed'); };
    window.ReactDOM.hydrateRoot = function() { console.log('React hydrateRoot bypassed'); return { render: function(){}, unmount: function(){} }; };
  }
  window.addEventListener('error', function(e) {
    if (e.message && (e.message.includes('Minified React error') || e.message.includes('Hydration') || e.message.includes('hydration'))) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
</script>
`;

        finalHtml = finalHtml.replace('<head>', '<head>' + suppressReactErrorsScript);


        // 🔴 الضربة الثانية الاحترافية: إزالة خوارزميات حماية المتصفح التي تعطل السكربتات عند العمل أوفلاين
        finalHtml = finalHtml.replace(/\s+integrity="[^"]+"/g, '');
        finalHtml = finalHtml.replace(/\s+crossorigin="[^"]*"/g, '');
        // كتم تعارضات React Hydration لمنع انهيار الصفحة
        finalHtml = finalHtml.replace('<html', '<html suppressHydrationWarning="true"');
        finalHtml = finalHtml.replace('<body', '<body suppressHydrationWarning="true"');
        finalHtml = finalHtml.replace(/srcset="[^"]+"/g, '');

        const fullDocument = finalHtml.trim().toLowerCase().startsWith('<!doctype')
            ? finalHtml
            : `<!DOCTYPE html>\n${finalHtml}`;

        fs.writeFileSync(path.join(outputDir, 'index.html'), fullDocument, 'utf8');

        return { outputDir };
    } catch (error) {
        console.error("Scraper error:", error);
        return { error: error.message };
    }
}
module.exports = { cloneSite };
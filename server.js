const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const cheerio = require('cheerio');
const { cloneSite } = require('./scraper');

const app = express();

const STORAGE_DIR = path.join(__dirname, 'storage');
const PUBLISHED_DIR = path.join(__dirname, 'published');
const CACHE_DIR = path.join(__dirname, 'local_assets_cache');

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
if (!fs.existsSync(PUBLISHED_DIR)) fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

app.use(async (req, res, next) => {
    const isStaticAsset = req.path.startsWith('/_next') ||
        req.path.startsWith('/images') ||
        req.path.startsWith('/favicon') ||
        req.query._rsc !== undefined ||
        req.path.match(/\.(woff|woff2|ttf|png|jpg|jpeg|svg|css|js|ico|webp)$/i);

    if (!isStaticAsset) return next();

    try {
        const referer = req.headers.referer || '';
        const match = referer.match(/\/storage\/([^\/]+)/) || referer.match(/\/live\/([^\/]+)/);
        if (match && match[1]) {
            const specificFile = path.join(STORAGE_DIR, match[1], req.path);
            if (fs.existsSync(specificFile) && fs.statSync(specificFile).isFile()) {
                return res.sendFile(specificFile);
            }
        }
    } catch (e) { }

    const safeFilename = encodeURIComponent(req.originalUrl).replace(/%/g, '_');
    const cachedFilePath = path.join(CACHE_DIR, safeFilename);

    if (fs.existsSync(cachedFilePath)) {
        return res.sendFile(cachedFilePath);
    }

    try {
        const sites = fs.readdirSync(STORAGE_DIR).filter(f => !f.startsWith('.'));
        let targetOrigin = 'https://manafith.com.sa';

        if (sites.length > 0) {
            const latestSite = sites[sites.length - 1];
            const sourceFile = path.join(STORAGE_DIR, latestSite, '_source_url.txt');
            if (fs.existsSync(sourceFile)) {
                targetOrigin = new URL(fs.readFileSync(sourceFile, 'utf8').trim()).origin;
            }
        }

        const remoteUrl = targetOrigin + req.originalUrl;
        const remoteRes = await fetch(remoteUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(6000)
        });

        if (remoteRes.ok) {
            const buffer = Buffer.from(await remoteRes.arrayBuffer());
            fs.writeFileSync(cachedFilePath, buffer);

            const contentType = remoteRes.headers.get('content-type');
            if (contentType) res.setHeader('Content-Type', contentType);
            return res.send(buffer);
        }
    } catch (err) { }

    if (req.path.endsWith('.js')) {
        return res.type('application/javascript').send('/* fallback */');
    }
    next();
});

app.use((req, res, next) => {
    if (req.path.startsWith('/_next') || req.path.startsWith('/images') || req.path.startsWith('/favicon')) {
        try {
            const referer = req.headers.referer || '';
            const match = referer.match(/\/storage\/([^\/]+)/) || referer.match(/\/live\/([^\/]+)/);
            if (match && match[1]) {
                const filePath = path.join(STORAGE_DIR, match[1], req.path);
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    return res.sendFile(filePath);
                }
            }
        } catch (e) { }
    }
    next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static('public'));

app.use(async (req, res, next) => {
    const isNextAsset = req.path.startsWith('/_next') ||
        req.path.startsWith('/images') ||
        req.path.startsWith('/favicon') ||
        req.query._rsc !== undefined;

    if (!isNextAsset) return next();

    const fullUrlPath = req.originalUrl;

    try {
        const sites = fs.readdirSync(STORAGE_DIR).filter(f => !f.startsWith('.'));
        for (const s of sites) {
            const localFile = path.join(STORAGE_DIR, s, req.path);
            if (fs.existsSync(localFile) && fs.statSync(localFile).isFile()) {
                return res.sendFile(localFile);
            }
        }
    } catch (e) { }

    try {
        const remoteUrl = 'https://manafith.com.sa' + fullUrlPath;
        const remoteRes = await fetch(remoteUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://manafith.com.sa/'
            },
            signal: AbortSignal.timeout(6000)
        });

        if (remoteRes.ok) {
            const contentType = remoteRes.headers.get('content-type');
            if (contentType) res.setHeader('Content-Type', contentType);

            const buffer = Buffer.from(await remoteRes.arrayBuffer());
            return res.send(buffer);
        }
    } catch (err) { }

    if (req.path.endsWith('.js')) {
        return res.type('application/javascript').send('/* fallback */');
    }
    next();
});

app.use('/assets', (req, res, next) => {
    try {
        const sites = fs.readdirSync(STORAGE_DIR).filter(f => !f.startsWith('.'));
        for (const s of sites) {
            const assetPath = path.join(STORAGE_DIR, s, 'assets', req.path);
            if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
                return res.sendFile(assetPath);
            }
        }
        if (sites.length > 0) {
            const latestSite = sites[sites.length - 1];
            const sourceFile = path.join(STORAGE_DIR, latestSite, '_source_url.txt');
            if (fs.existsSync(sourceFile)) {
                const sourceUrl = fs.readFileSync(sourceFile, 'utf8').trim();
                const origin = new URL(sourceUrl).origin;
                const remoteUrl = origin + '/assets' + req.path;
                return fetch(remoteUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
                    .then(async r => {
                        if (r.ok) {
                            const buf = Buffer.from(await r.arrayBuffer());
                            if (req.path.endsWith('.js')) res.type('application/javascript');
                            else if (req.path.endsWith('.css')) res.type('text/css');
                            else if (req.path.endsWith('.svg')) res.type('image/svg+xml');
                            return res.send(buf);
                        }
                        next();
                    })
                    .catch(() => next());
            }
        }
    } catch (e) { }
    next();
});

const noCache = {
    setHeaders: function (res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
};
app.use('/storage', express.static(STORAGE_DIR, noCache));
app.use('/live', express.static(PUBLISHED_DIR, noCache));

app.post('/api/clone', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'يرجى إدخال الرابط' });

    const siteId = 'site_' + Date.now();
    const siteDir = path.join(STORAGE_DIR, siteId);

    try {
        const result = await cloneSite(url, siteDir);
        fs.writeFileSync(path.join(siteDir, '_source_url.txt'), url, 'utf8');

        if (result.html) {
            fs.writeFileSync(path.join(siteDir, 'index.html'), result.html, 'utf8');
        }

        res.json({ success: true, siteId, html: result.html });
    } catch (err) {
        res.status(500).json({ error: 'فشل في سحب الموقع: ' + err.message });
    }
});

// مسار جلب وحفظ قوالب النماذج (Schemas) للمحرر
app.get('/api/project/schemas/:siteId', (req, res) => {
    try {
        const schemaFile = path.join(STORAGE_DIR, req.params.siteId, '_schemas.json');
        if (fs.existsSync(schemaFile)) {
            res.json(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
        } else {
            res.json({ forms: [] });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/project/schemas/:siteId', (req, res) => {
    try {
        const siteDir = path.join(STORAGE_DIR, req.params.siteId);
        if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true });
        fs.writeFileSync(path.join(siteDir, '_schemas.json'), JSON.stringify(req.body), 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sites/all', (req, res) => {
    try {
        const sites = fs.readdirSync(STORAGE_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => {
                const siteDir = path.join(STORAGE_DIR, d.name);
                const pages = fs.readdirSync(siteDir).filter(f => f.endsWith('.html'));
                const stats = fs.statSync(siteDir);
                return {
                    id: d.name,
                    pagesCount: pages.length,
                    updatedAt: stats.mtime
                };
            });
        res.json({ sites });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sites/:siteId', (req, res) => {
    try {
        const siteDir = path.join(STORAGE_DIR, req.params.siteId);
        if (fs.existsSync(siteDir)) {
            fs.rmSync(siteDir, { recursive: true, force: true });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/pages/copy-to-site', (req, res) => {
    try {
        const { sourceSiteId, targetSiteId, pageFile } = req.body;
        const srcPath = path.join(STORAGE_DIR, sourceSiteId, pageFile);
        const destPath = path.join(STORAGE_DIR, targetSiteId, pageFile);

        if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'الصفحة المصدر غير موجودة' });
        fs.copyFileSync(srcPath, destPath);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/pages/:siteId', (req, res) => {
    const { siteId } = req.params;
    const siteDir = path.join(STORAGE_DIR, siteId);
    if (!fs.existsSync(siteDir)) return res.status(404).json({ error: 'الموقع غير موجود' });

    const metaFile = path.join(siteDir, '_pages_meta.json');
    let meta = { homePage: 'index.html', order: [], projectName: '' };
    if (fs.existsSync(metaFile)) {
        try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { }
    }

    const files = fs.readdirSync(siteDir).filter(f => f.endsWith('.html') && !f.startsWith('_'));
    res.json({ pages: files, homePage: meta.homePage || 'index.html', order: meta.order || [], projectName: meta.projectName || '' });
});

app.post('/api/pages/meta', (req, res) => {
    const { siteId, homePage, order, projectName } = req.body;
    const siteDir = path.join(STORAGE_DIR, siteId);
    if (!fs.existsSync(siteDir)) return res.status(404).json({ error: 'الموقع غير موجود' });

    const metaFile = path.join(siteDir, '_pages_meta.json');
    let meta = { homePage: 'index.html', order: [] };
    if (fs.existsSync(metaFile)) {
        try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { }
    }

    if (homePage !== undefined) meta.homePage = homePage;
    if (order !== undefined) meta.order = order;
    if (projectName !== undefined) meta.projectName = projectName;

    fs.writeFileSync(metaFile, JSON.stringify(meta), 'utf8');
    res.json({ success: true });
});

app.get('/api/project/schemas/:siteId', (req, res) => {
    const { siteId } = req.params;
    const filePath = path.join(STORAGE_DIR, siteId, '_form_schemas.json');
    if (fs.existsSync(filePath)) {
        try {
            return res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
        } catch (e) { }
    }
    res.json({ forms: [] });
});

app.post('/api/project/schemas/:siteId', (req, res) => {
    const { siteId } = req.params;
    const { forms } = req.body;
    const siteDir = path.join(STORAGE_DIR, siteId);
    if (!fs.existsSync(siteDir)) return res.status(404).json({ error: 'الموقع غير موجود' });

    const filePath = path.join(siteDir, '_form_schemas.json');
    fs.writeFileSync(filePath, JSON.stringify({ forms }, null, 2), 'utf8');
    res.json({ success: true });
});

app.delete('/api/pages/:siteId/:pageName', (req, res) => {
    try {
        const { siteId, pageName } = req.params;
        const filePath = path.join(STORAGE_DIR, siteId, pageName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/pages/create', async (req, res) => {
    try {
        const { siteId, pageName, pageType, cloneUrl } = req.body;
        const siteDir = path.join(STORAGE_DIR, siteId);
        if (!fs.existsSync(siteDir)) return res.status(404).json({ error: 'الموقع غير موجود' });

        const safePageName = pageName.trim().replace(/\.html$/i, '') + '.html';
        const filePath = path.join(siteDir, safePageName);

        if (pageType === 'clone' && cloneUrl) {
            const tempDir = path.join(STORAGE_DIR, 'temp_' + Date.now());
            const result = await cloneSite(cloneUrl, tempDir);

            if (fs.existsSync(tempDir)) {
                const items = fs.readdirSync(tempDir);
                for (const item of items) {
                    if (item !== 'index.html' && item !== '_source_url.txt') {
                        fs.cpSync(path.join(tempDir, item), path.join(siteDir, item), { recursive: true });
                    }
                }
            }

            let clonedHtml = '';
            if (typeof result === 'string') {
                clonedHtml = result;
            } else if (result && typeof result.html === 'string') {
                clonedHtml = result.html;
            } else if (fs.existsSync(path.join(tempDir, 'index.html'))) {
                clonedHtml = fs.readFileSync(path.join(tempDir, 'index.html'), 'utf8');
            } else if (fs.existsSync(filePath)) {
                clonedHtml = fs.readFileSync(filePath, 'utf8');
            }

            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }

            if (!clonedHtml) {
                throw new Error('تعذر استخراج كود الصفحة المستنسخة');
            }

            fs.writeFileSync(filePath, clonedHtml, 'utf8');
        } else if (pageType === 'dynamic') {
            const dynamicHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${pageName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Cairo', sans-serif; }
    body { background: #f8fafc; color: #1e293b; }
    .wix-section { width: 100%; position: relative; padding: 40px 20px; }
    .container { max-width: 1100px; margin: 0 auto; }
  </style>
</head>
<body>
  <header data-global="true" style="background:#fff; border-bottom:1px solid #e2e8f0; padding:15px 30px; display:flex; justify-content:space-between; align-items:center;">
    <h3 style="color:#2563eb;">شعار المتجر</h3>
    <div>مرحباً: <b data-dynamic-bind="name">{{name}}</b></div>
  </header>
  <section class="wix-section" data-section-name="الطلب" style="min-height: 350px; background: #ffffff;">
    <div class="container">
      <h2 style="font-size: 24px; margin-bottom: 15px;">ملخص الطلب</h2>
      <div style="background: #f1f5f9; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
        <p>المنتج: <strong data-dynamic-bind="item">{{item}}</strong></p>
        <p>المبلغ: <strong data-dynamic-bind="total">{{total}}</strong> ر.س</p>
      </div>
      <button class="btn" data-btn-type="action" data-target-url="/payment" style="padding: 12px 30px; background: #16a34a; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">متابعة الدفع</button>
    </div>
  </section>
  <footer data-global="true" style="background:#0f172a; color:#94a3b8; padding:30px; text-align:center;">
    <p>جميع الحقوق محفوظة &copy; 2026</p>
  </footer>
</body>
</html>`;
            fs.writeFileSync(filePath, dynamicHtml, 'utf8');
        } else {
            const blankHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${pageName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Cairo', sans-serif; }
    body { background: #ffffff; color: #1e293b; }
    .wix-section { width: 100%; position: relative; min-height: 250px; padding: 30px 20px; }
    .container { max-width: 1100px; margin: 0 auto; text-align: center; }
  </style>
</head>
<body>
  <header data-global="true" style="background:#ffffff; border-bottom:1px solid #e2e8f0; padding:15px 30px;">
    <div class="container"><h3>الترويسة العامة للموقع</h3></div>
  </header>
  <section class="wix-section" data-section-name="القسم الرئيسي" style="background:#f8fafc;">
    <div class="container">
      <h1 style="font-size: 28px; margin-bottom: 10px;">قسم جديد</h1>
      <p style="color: #64748b;">يمكنك سحب وإفلات العناصر وتغيير خصائص الزر والنموذج هنا.</p>
    </div>
  </section>
  <footer data-global="true" style="background:#0f172a; color:#94a3b8; padding:25px; text-align:center;">
    <div class="container"><p>التذييل العام للموقع</p></div>
  </footer>
</body>
</html>`;
            fs.writeFileSync(filePath, blankHtml, 'utf8');
        }

        res.json({ success: true, page: safePageName });
    } catch (err) {
        console.error('Create Page Error:', err);
        res.status(500).json({ error: 'فشل إنشاء الصفحة: ' + err.message });
    }
});

app.post('/api/save', (req, res) => {
    let { siteId, pageFile, html } = req.body;

    if (!siteId || !html || html.trim().length < 50) {
        return res.status(400).json({ error: 'بيانات غير مكتملة' });
    }

    let targetFile = (pageFile || 'index.html').split('?')[0];
    if (!targetFile.endsWith('.html')) targetFile += '.html';

    const siteDir = path.join(STORAGE_DIR, siteId);
    const filePath = path.join(siteDir, targetFile);

    if (!fs.existsSync(siteDir)) {
        fs.mkdirSync(siteDir, { recursive: true });
    }

    try {
        const fd = fs.openSync(filePath, 'w');
        fs.writeFileSync(fd, html, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);

        console.log(`\x1b[32m[SAVED OK]\x1b[0m تم الحفظ الفعلي للملف: \x1b[36m${filePath}\x1b[0m بحجم: ${Buffer.byteLength(html)} بايت`);
        res.json({ success: true });
    } catch (err) {
        console.error('خطأ في حفظ الملف:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publish', (req, res) => {
    try {
        const { siteId, html, currentPageFile } = req.body;
        if (!siteId) return res.status(400).json({ error: 'معرف المشروع مفقود' });

        const folderName = siteId;
        const srcDir = path.join(STORAGE_DIR, siteId);
        const targetDir = path.join(PUBLISHED_DIR, folderName);

        if (!fs.existsSync(srcDir)) return res.status(404).json({ error: 'الموقع غير موجود' });

        if (currentPageFile && html) {
            fs.writeFileSync(path.join(srcDir, currentPageFile), html, 'utf8');
        }

        const metaFile = path.join(srcDir, '_pages_meta.json');
        let homePage = 'index.html';
        if (fs.existsSync(metaFile)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
                if (meta.homePage) homePage = meta.homePage;
            } catch (e) { }
        }

        fs.cpSync(srcDir, targetDir, { recursive: true });

        if (homePage !== 'index.html' && fs.existsSync(path.join(targetDir, homePage))) {
            const homeContent = fs.readFileSync(path.join(targetDir, homePage), 'utf8');
            fs.writeFileSync(path.join(targetDir, 'index.html'), homeContent, 'utf8');
        }

        res.json({ success: true, liveUrl: `/live/${folderName}/index.html` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/export/:siteId', (req, res) => {
    const siteId = req.params.siteId;
    const siteDir = path.join(STORAGE_DIR, siteId);
    if (!fs.existsSync(siteDir)) return res.status(404).send('الموقع غير موجود');

    res.attachment(`${siteId}_export.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.directory(siteDir, false);
    archive.finalize();
});

app.get('/:pageName', (req, res, next) => {
    if (req.params.pageName.endsWith('.html')) {
        return res.status(404).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;">يرجى فتح الصفحة من خلال مسار مشروعها المحدد في المحرر.</h2>');
    }
    next();
});

app.get('/api/sites', (req, res) => {
    res.json([]);
});

app.use('/api', async (req, res, next) => {
    const internalAPIs = ['/save', '/publish', '/clone', '/export', '/pages', '/sites', '/project'];
    if (internalAPIs.some(route => req.path.startsWith(route))) {
        return next();
    }

    try {
        const originUrl = 'https://manafith.com.sa' + req.originalUrl;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://manafith.com.sa/',
            'Origin': 'https://manafith.com.sa'
        };
        if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

        const fetchOptions = {
            method: req.method,
            headers: headers,
            signal: AbortSignal.timeout(10000)
        };
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
            fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(originUrl, fetchOptions);
        const contentType = response.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);

        const data = await response.arrayBuffer();
        res.status(response.status).send(Buffer.from(data));
    } catch (e) {
        console.error('API Proxy Error:', e.message);
        next();
    }
});

app.use(['/ar', '/en'], (req, res, next) => {
    const rawPath = req.path;
    const cleanName = path.basename(rawPath).split('?')[0];

    if (rawPath.match(/\.(png|jpg|jpeg|svg|css|js|webp|ico|woff2?)$/i)) {
        return next();
    }

    const referer = req.headers.referer || '';
    const storageMatch = referer.match(/\/storage\/([^\/\?]+)/);
    const liveMatch = referer.match(/\/live\/([^\/\?]+)/);

    if (storageMatch && storageMatch[1]) {
        const target = path.join(STORAGE_DIR, storageMatch[1], cleanName + '.html');
        if (fs.existsSync(target)) return res.sendFile(target);
    }

    if (liveMatch && liveMatch[1]) {
        const target = path.join(PUBLISHED_DIR, liveMatch[1], cleanName + '.html');
        if (fs.existsSync(target)) return res.sendFile(target);
    }

    res.status(404).send('<h2 style="font-family:Cairo,sans-serif;text-align:center;margin-top:50px;">الصفحة المطلوبة غير موجودة في هذا المشروع.</h2>');
});

app.listen(3000, () => {
    console.clear();
    console.log('==================================================');
    console.log('✅ Server restarted successfully! (الخادم يعمل بنجاح)');
    console.log('📁 All APIs & Routes are proxied to manafith.com.sa');
    console.log('🌐 Local URL: http://localhost:3000');
    console.log('==================================================\n');
});
const fs = require('fs');
const cheerio = require('cheerio');
const vm = require('vm');

try {
    const html = fs.readFileSync('published/site_1789715618986/buy.html', 'utf8');
    const $ = cheerio.load(html);
    
    const js = $('#velo-engine-runtime').html();
    console.log("Compiling JS using vm...");
    new vm.Script(js);
    console.log("✅ No syntax errors found!");
} catch(e) {
    console.error("🚨 Syntax Error found!");
    console.error(e.message);
    console.error(e.stack);
}
const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');

const filePath = path.join(__dirname, 'published', 'site_1789715618986', 'buy.html');
const html = fs.readFileSync(filePath, 'utf8');
const $ = cheerio.load(html);

// Find elements with placeholder="10" or placeholder="12345" and print their parent/surrounding HTML
$('input').each((i, el) => {
    const placeholder = $(el).attr('placeholder') || '';
    if (placeholder === '10' || placeholder === '12345' || placeholder.includes('الشاسيه')) {
        console.log(`--- INPUT ${i} (placeholder: "${placeholder}") ---`);
        // Print parent HTML up to 3 levels
        console.log($(el).parent().parent().parent().html().substring(0, 1500));
        console.log('\n=======================================\n');
    }
});

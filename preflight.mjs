import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  'server.js','lib/chat-engine.mjs','schema.sql','package.json','.env.example',
  'views/home.ejs','views/header.ejs','views/footer.ejs','views/shop.ejs','views/product.ejs',
  'views/checkout.ejs','views/order.ejs','views/about.ejs','views/reviews.ejs','views/faq.ejs','views/contact.ejs',
  'views/admin-login.ejs','views/admin.ejs','views/admin-products.ejs','views/admin-orders.ejs','views/admin-content.ejs','views/admin-settings.ejs',
  'public/app.js','public/styles.css','public/assets/logo.jpg','public/assets/hero-fashion.jpg',
  'public/assets/category-1.jpg','public/assets/category-2.jpg','public/assets/category-3.jpg','public/assets/category-4.jpg',
  'public/assets/category-5.jpg','public/assets/category-6.jpg','public/assets/category-7.jpg','public/assets/category-8.jpg',
  'public/assets/demo-product-1.jpg','public/assets/demo-product-2.jpg','public/assets/demo-product-3.jpg','public/assets/demo-product-4.jpg'
];
const missing = requiredFiles.filter(f => !fs.existsSync(path.join(ROOT,f)));
if (missing.length) {
  console.error('\nDEPLOYMENT PREFLIGHT FAILED. Missing required files:');
  for (const f of missing) console.error(` - ${f}`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
if (!pkg.scripts?.start) { console.error('DEPLOYMENT PREFLIGHT FAILED: package.json has no start script.'); process.exit(1); }
console.log(`Deployment preflight passed: ${requiredFiles.length} required files verified.`);

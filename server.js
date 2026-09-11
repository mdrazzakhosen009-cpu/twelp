import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import { createClient } from '@libsql/client';
import { z } from 'zod';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieSession({ name: 'rtex_session', keys: [process.env.SESSION_SECRET || 'dev-only-change-me'], httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }));
app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(process.cwd(), 'public'), { maxAge: '1d' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, message: { error: 'Too many requests. Try again later.' } });
app.use('/api/', limiter);

async function q(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { const r = await q(sql, args); return r.rows[0] || null; }
function rowObj(row) { return row ? Object.fromEntries(Object.entries(row)) : row; }
function parseJson(v, fallback = []) { try { return JSON.parse(v || JSON.stringify(fallback)); } catch { return fallback; } }
function money(n) { return Number(n || 0); }
function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID().slice(0, 8); }
function isAdmin(req) { return req.session?.admin === true || req.session?.admin === 'true'; }
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin authentication required.' });
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set([`${req.protocol}://${req.get('host')}`, `https://${req.get('host')}`, `http://${req.get('host')}`]);
    if (!allowed.has(origin)) return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
}

async function tableExists(name) {
  return !!(await one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]));
}
async function columnExists(table, column) {
  if (!(await tableExists(table))) return false;
  const r = await q(`PRAGMA table_info(${table})`);
  return r.rows.some(x => x.name === column);
}
async function ensureColumn(table, column, definition) {
  if (!(await columnExists(table, column))) await q(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function init() {
  // Create missing tables first, then safely upgrade older Turso databases.
  const schema = fs.readFileSync('./schema.sql', 'utf8');
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    if (!/^CREATE INDEX/i.test(statement)) await q(statement);
  }
  const required = {
    products: [['name',"TEXT DEFAULT ''"],['slug',"TEXT DEFAULT ''"],['category_id','INTEGER'],['description',"TEXT DEFAULT ''"],['price','INTEGER DEFAULT 0'],['compare_price','INTEGER'],['image_url','TEXT'],['gallery_json',"TEXT DEFAULT '[]'"],['featured','INTEGER DEFAULT 0'],['active','INTEGER DEFAULT 1'],['created_at','TEXT DEFAULT CURRENT_TIMESTAMP'],['updated_at','TEXT DEFAULT CURRENT_TIMESTAMP']],
    variants: [['product_id','INTEGER'],['size',"TEXT DEFAULT 'Free Size'"],['color',"TEXT DEFAULT 'Default'"],['stock','INTEGER DEFAULT 0'],['sku','TEXT']],
    reviews: [['name',"TEXT DEFAULT ''"],['product_id','INTEGER'],['phone_model',"TEXT DEFAULT ''"],['rating','INTEGER DEFAULT 5'],['comment',"TEXT DEFAULT ''"],['approved','INTEGER DEFAULT 0'],['created_at','TEXT DEFAULT CURRENT_TIMESTAMP']],
    order_items: [['order_id','INTEGER'],['product_id','INTEGER'],['variant_id','INTEGER'],['product_name',"TEXT DEFAULT ''"],['size','TEXT'],['color','TEXT'],['quantity','INTEGER DEFAULT 1'],['unit_price','INTEGER DEFAULT 0'],['line_total','INTEGER DEFAULT 0']],
    orders: [['order_number',"TEXT DEFAULT ''"],['customer_name',"TEXT DEFAULT ''"],['phone',"TEXT DEFAULT ''"],['address',"TEXT DEFAULT ''"],['area',"TEXT DEFAULT ''"],['note',"TEXT DEFAULT ''"],['subtotal','INTEGER DEFAULT 0'],['delivery_fee','INTEGER DEFAULT 0'],['total','INTEGER DEFAULT 0'],['status',"TEXT DEFAULT 'pending'"],['payment_status',"TEXT DEFAULT 'unpaid'"],['created_at','TEXT DEFAULT CURRENT_TIMESTAMP']]
  };
  for (const [table, cols] of Object.entries(required)) for (const [col, def] of cols) await ensureColumn(table, col, def);

  // Indexes are created only after legacy tables have the columns they need.
  await q('CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_products_active ON products(active)');
  await q('CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
  await q('CREATE INDEX IF NOT EXISTS idx_reviews_product_approved ON reviews(product_id, approved)');

  const defaults = {
    store_name: 'R TEX BD', tagline: "Women’s Three-Piece Collection", phone: '01629380347', whatsapp: '8801629380347', email: '', address: 'Bangladesh', delivery_inside: '80', delivery_outside: '130',
    hero_title: 'Elegant Style For Every Moment', hero_subtitle: 'Premium Three Piece Collection for the Modern You.',
    about: 'R TEX BD is a women’s clothing brand focused exclusively on beautiful three-piece collections.', footer_note: '100% Original Products · Cash on Delivery · Easy Return · 24/7 Support', currency: '৳'
  };
  for (const [key, value] of Object.entries(defaults)) await q('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', [key, value]);
  if (process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

  const categories = [
    ['Cotton Three Piece','cotton-three-piece','/assets/category-1.jpg'],['Silk Three Piece','silk-three-piece','/assets/category-2.jpg'],['Georgette Three Piece','georgette-three-piece','/assets/category-3.jpg'],['Chiffon Three Piece','chiffon-three-piece','/assets/category-4.jpg'],
    ['Lawn Three Piece','lawn-three-piece','/assets/category-5.jpg'],['Embroidered Three Piece','embroidered-three-piece','/assets/category-6.jpg'],['Printed Three Piece','printed-three-piece','/assets/category-7.jpg'],['Party Wear Three Piece','party-wear-three-piece','/assets/category-8.jpg']
  ];
  for (let i=0;i<categories.length;i++) {
    const [name,slug,image]=categories[i];
    await q('INSERT OR IGNORE INTO categories(name,slug,image_url,sort_order,active) VALUES(?,?,?,?,1)',[name,slug,image,i]);
    await q('UPDATE categories SET image_url=COALESCE(image_url,?) WHERE slug=?',[image,slug]);
  }

  // Populate a useful first-run catalog so the store never looks empty.
  const count = Number((await one('SELECT COUNT(*) n FROM products'))?.n || 0);
  if (count === 0) {
    const cats = await q('SELECT id,name FROM categories ORDER BY sort_order,id');
    const catId = Object.fromEntries(cats.rows.map(x=>[x.name,x.id])); const catBySlug = Object.fromEntries(categories.map(c=>[c[1], c[0]]));
    const demo = [
      ['Luxury Cotton Three Piece','cotton-three-piece','Soft premium cotton three-piece with an elegant everyday finish.',2890,3400,'/assets/demo-product-1.jpg',1],
      ['Premium Silk Three Piece','silk-three-piece','Rich silk texture with a polished festive look.',3490,3990,'/assets/demo-product-2.jpg',1],
      ['Embroidered Chiffon Three Piece','chiffon-three-piece','Lightweight chiffon with refined embroidery details.',3190,3550,'/assets/demo-product-3.jpg',1],
      ['Printed Lawn Three Piece','lawn-three-piece','Comfortable printed lawn for stylish daily wear.',2390,2990,'/assets/demo-product-4.jpg',1],
      ['Classic Georgette Three Piece','georgette-three-piece','Flowing georgette fabric with a graceful silhouette.',2990,3390,'/assets/demo-product-3.jpg',0],
      ['Royal Party Three Piece','party-wear-three-piece','Statement party wear with premium detailing.',4290,4890,'/assets/demo-product-2.jpg',1],
      ['Rose Embroidery Three Piece','embroidered-three-piece','Feminine rose embroidery and soft drape.',3390,3890,'/assets/demo-product-1.jpg',1],
      ['Elegant Printed Three Piece','printed-three-piece','Modern print with comfortable all-day styling.',2590,2990,'/assets/demo-product-4.jpg',0]
    ];
    for (const [name,catSlug,desc,price,compare,image,featured] of demo) {
      const slug=slugify(name)+'-'+crypto.randomBytes(2).toString('hex');
      const r=await q('INSERT INTO products(category_id,name,slug,description,price,compare_price,image_url,featured,active) VALUES(?,?,?,?,?,?,?,?,1)',[catId[catBySlug[catSlug]] || null,name,slug,desc,price,compare,image,featured]);
      const id=Number(r.lastInsertRowid);
      for (const [size,color,stock] of [['M','Rose',12],['L','Rose',10],['XL','Rose',8],['M','Black',8],['L','Black',7],['XL','Black',5]]) await q('INSERT INTO variants(product_id,size,color,stock,sku) VALUES(?,?,?,?,?)',[id,size,color,stock,`RTX-${id}-${size}-${color}`]);
    }
  }
  // Repair legacy products that were created before slugs were introduced.
  const legacyProducts = (await q("SELECT id,name,slug FROM products WHERE slug IS NULL OR slug=''")).rows;
  for (const lp of legacyProducts) await q('UPDATE products SET slug=? WHERE id=?',[slugify(lp.name)+'-'+lp.id,lp.id]);

  // Add sample approved reviews once, so the public carousel has real data on first run.
  const reviewCount=Number((await one('SELECT COUNT(*) n FROM reviews'))?.n || 0);
  if(reviewCount===0){
    const ps=(await q('SELECT id,name FROM products ORDER BY id LIMIT 4')).rows;
    const sample=[['Ayesha Rahman','Samsung Galaxy A54',5,'Fabric quality is amazing! Design is exactly as shown. Very happy with my purchase.'],['Sadia Islam','iPhone 14',5,'Stitching is perfect and delivery was on time. Highly recommended!'],['Nusrat Jahan','Xiaomi Redmi Note 12',5,'Best collection and customer service. Will definitely shop again!'],['Farhana Akter','Samsung Galaxy A73',4,'Colors are beautiful and the fabric is so comfortable. Thank you!']];
    for(let i=0;i<sample.length;i++) if(ps[i]) await q('INSERT INTO reviews(product_id,name,phone_model,rating,comment,approved) VALUES(?,?,?,?,?,1)',[ps[i].id,...sample[i]]);
  }
}
async function getSettings() { const r = await q('SELECT key,value FROM settings'); return Object.fromEntries(r.rows.map(x => [x.key, x.value])); }
async function getCategories() { const r = await q('SELECT * FROM categories WHERE active=1 ORDER BY sort_order,id'); return r.rows.map(rowObj); }
async function productById(id) {
  const p = await one('SELECT p.*, c.name category_name, c.slug category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?', [id]);
  if (!p) return null;
  p.gallery = parseJson(p.gallery_json); p.variants = (await q('SELECT * FROM variants WHERE product_id=? ORDER BY id', [id])).rows.map(rowObj); return rowObj(p);
}
async function allProducts({ activeOnly=true, category='', search='', featured=false, sort='newest', limit=100, offset=0 } = {}) {
  const args = []; let where = activeOnly ? 'WHERE p.active=1' : 'WHERE 1=1';
  if (category) { where += ' AND c.slug=?'; args.push(category); }
  if (search) { where += ' AND (p.name LIKE ? OR p.description LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  if (featured) where += ' AND p.featured=1';
  const order = sort==='price_asc' ? 'p.price ASC,p.id DESC' : sort==='price_desc' ? 'p.price DESC,p.id DESC' : 'p.featured DESC,p.created_at DESC';
  const r = await q(`SELECT p.*, c.name category_name, c.slug category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  for (const p of r.rows) { p.gallery = parseJson(p.gallery_json); p.variants = (await q('SELECT * FROM variants WHERE product_id=? ORDER BY id', [p.id])).rows.map(rowObj); }
  return r.rows.map(rowObj);
}

app.use(async (req,res,next)=>{ try { res.locals.settings = await getSettings(); res.locals.categories = await getCategories(); res.locals.admin = isAdmin(req); next(); } catch(e){ next(e); } });

app.get('/', async (req,res,next)=>{ try { const products = await allProducts({limit:12}); const featured = await allProducts({featured:true,limit:8}); const reviews = (await q('SELECT r.*,p.name product_name FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.approved=1 ORDER BY r.created_at DESC LIMIT 20')).rows; res.render('home',{products,featured,reviews}); } catch(e){next(e)} });
app.get('/shop', async (req,res,next)=>{ try { const products = await allProducts({category:req.query.category||'',search:req.query.q||'',sort:req.query.sort||'newest',limit:48}); res.render('shop',{products,query:req.query.q||'',selectedCategory:req.query.category||''}); }catch(e){next(e)} });
app.get('/product/:slug', async (req,res,next)=>{ try { const p=await one('SELECT id FROM products WHERE slug=? AND active=1',[req.params.slug]); if(!p)return res.status(404).render('404'); const product=await productById(p.id); const reviews=(await q('SELECT * FROM reviews WHERE product_id=? AND approved=1 ORDER BY created_at DESC',[product.id])).rows; const related=await allProducts({category:product.category_slug||'',limit:8}); res.render('product',{product,reviews,related:related.filter(x=>x.id!==product.id)}); }catch(e){next(e)} });
app.get('/about', async(req,res,next)=>{try{res.render('about')}catch(e){next(e)}});
app.get('/reviews', async(req,res,next)=>{try{const reviews=(await q('SELECT r.*,p.name product_name FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.approved=1 ORDER BY r.created_at DESC LIMIT 100')).rows;res.render('reviews',{reviews})}catch(e){next(e)}});
app.get('/faq', async(req,res,next)=>{try{res.render('faq')}catch(e){next(e)}});
app.get('/contact', async(req,res,next)=>{try{res.render('contact')}catch(e){next(e)}});
app.get('/checkout', (req,res)=>res.render('checkout'));
app.get('/order/:orderNumber', async(req,res,next)=>{try{const o=await one('SELECT * FROM orders WHERE order_number=?',[req.params.orderNumber]); if(!o)return res.status(404).render('404'); const items=(await q('SELECT * FROM order_items WHERE order_id=?',[o.id])).rows; res.render('order',{order:o,items});}catch(e){next(e)}});
app.get('/admin/login',(req,res)=>{if(isAdmin(req))return res.redirect('/admin');res.render('admin-login')});
app.get('/admin', requireAdminPage, async(req,res,next)=>{try{const stats={products:(await one('SELECT COUNT(*) n FROM products'))?.n||0,orders:(await one('SELECT COUNT(*) n FROM orders'))?.n||0,customers:(await one('SELECT COUNT(DISTINCT phone) n FROM orders'))?.n||0,revenue:(await one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status='paid'"))?.n||0}; const recent=(await q('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10')).rows; res.render('admin',{stats,recent});}catch(e){next(e)}});
function requireAdminPage(req,res,next){ if(!isAdmin(req)) return res.redirect('/admin/login'); next(); }
app.get('/admin/products',requireAdminPage,async(req,res,next)=>{try{res.render('admin-products',{products:await allProducts({activeOnly:false,limit:500})})}catch(e){next(e)}});
app.get('/admin/orders',requireAdminPage,async(req,res,next)=>{try{res.render('admin-orders',{orders:(await q('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500')).rows})}catch(e){next(e)}});
app.get('/admin/content',requireAdminPage,async(req,res,next)=>{try{const reviews=(await q('SELECT r.*,p.name product_name FROM reviews r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC LIMIT 200')).rows;res.render('admin-content',{reviews,products:await allProducts({activeOnly:false,limit:500})})}catch(e){next(e)}});
app.get('/admin/settings',requireAdminPage,async(req,res,next)=>{try{res.render('admin-settings',{settings:await getSettings()})}catch(e){next(e)}});

const storage = multer.diskStorage({ destination: uploadDir, filename: (req,file,cb)=>cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) });
const upload = multer({ storage, limits:{fileSize:5*1024*1024}, fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) });

app.post('/api/admin/login',adminLimiter,async(req,res)=>{
  const parsed=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(200)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Username and password are required.'});
  const username=String(process.env.ADMIN_USERNAME||'admin').trim();
  let hash=process.env.ADMIN_PASSWORD_HASH;
  if(!hash && process.env.ADMIN_PASSWORD) hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
  if(!hash)return res.status(500).json({error:'Admin password is not configured. Add ADMIN_PASSWORD or ADMIN_PASSWORD_HASH in Render Environment Variables.'});
  const valid=await bcrypt.compare(parsed.data.password,hash);
  if(parsed.data.username!==username || !valid)return res.status(401).json({error:'Invalid admin credentials.'});
  req.session = { admin:true, loginAt:Date.now() };
  res.set('Cache-Control','no-store');
  return res.json({ok:true,redirect:'/admin'});
});
app.post('/api/admin/logout',requireAdmin,(req,res)=>{req.session=null;res.json({ok:true,redirect:'/admin/login'})});

app.get('/api/products',async(req,res,next)=>{try{res.json({products:await allProducts({category:req.query.category||'',search:req.query.q||'',sort:req.query.sort||'newest',featured:req.query.featured==='1',limit:Math.min(Number(req.query.limit||48),100),offset:Math.max(Number(req.query.offset||0),0)})})}catch(e){next(e)}});
app.get('/api/products/:id',async(req,res,next)=>{try{const p=await productById(Number(req.params.id));if(!p||!p.active)return res.status(404).json({error:'Product not found'});res.json({product:p})}catch(e){next(e)}});
app.get('/api/categories',async(req,res,next)=>{try{res.json({categories:await getCategories()})}catch(e){next(e)}});
app.get('/api/settings/public',async(req,res,next)=>{try{const s=await getSettings();delete s.admin_password;res.json({settings:s})}catch(e){next(e)}});

app.post('/api/reviews',async(req,res,next)=>{try{const parsed=z.object({productId:z.coerce.number().int().positive(),name:z.string().trim().min(2).max(80),phoneModel:z.string().trim().max(80).optional().default(''),rating:z.coerce.number().int().min(1).max(5),comment:z.string().trim().min(3).max(1000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Please complete the review correctly.'});const p=await one('SELECT id FROM products WHERE id=? AND active=1',[parsed.data.productId]);if(!p)return res.status(404).json({error:'Product not found.'});await q('INSERT INTO reviews(product_id,name,phone_model,rating,comment,approved) VALUES(?,?,?,?,?,0)',[parsed.data.productId,parsed.data.name,parsed.data.phoneModel,parsed.data.rating,parsed.data.comment]);res.json({ok:true,message:'Review submitted for approval.'});}catch(e){next(e)}});

async function createOrderFromPayload(payload){
  const parsed=z.object({customerName:z.string().trim().min(2).max(100),phone:z.string().trim().min(8).max(20),address:z.string().trim().min(5).max(500),area:z.string().trim().max(100).optional().default(''),note:z.string().trim().max(500).optional().default(''),deliveryZone:z.enum(['inside','outside']).default('inside'),items:z.array(z.object({productId:z.coerce.number().int().positive(),variantId:z.coerce.number().int().positive(),quantity:z.coerce.number().int().min(1).max(20)})).min(1).max(30)}).parse(payload);
  let subtotal=0;const resolved=[];
  for(const item of parsed.items){
    const v=await one('SELECT v.*,p.name,p.price,p.active,p.compare_price,p.image_url FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.product_id=? AND p.active=1',[item.variantId,item.productId]);
    if(!v)throw Object.assign(new Error('One of the selected variants is no longer available.'),{status:400});
    if(Number(v.stock)<item.quantity)throw Object.assign(new Error(`Insufficient stock for ${v.name} (${v.size}, ${v.color}).`),{status:409});
    const unit=Number(v.price);subtotal+=unit*item.quantity;resolved.push({...item,v,unit});
  }
  const settings=await getSettings();
  const deliveryFee=parsed.deliveryZone==='outside'?Number(settings.delivery_outside||130):Number(settings.delivery_inside||80);
  const total=subtotal+deliveryFee;
  const orderNumber='RTX-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
  const tx=await db.transaction('write');
  try{
    const r=await tx.execute({sql:'INSERT INTO orders(order_number,customer_name,phone,address,area,note,subtotal,delivery_fee,total,status,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:[orderNumber,parsed.customerName,parsed.phone,parsed.address,parsed.area,parsed.note,subtotal,deliveryFee,total,'pending','unpaid']});
    const orderId=Number(r.lastInsertRowid);
    for(const x of resolved){
      const upd=await tx.execute({sql:'UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?',args:[x.quantity,x.variantId,x.quantity]});
      if(Number(upd.rowsAffected)!==1)throw new Error('STOCK_CONFLICT');
      await tx.execute({sql:'INSERT INTO order_items(order_id,product_id,variant_id,product_name,size,color,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?,?,?)',args:[orderId,x.productId,x.variantId,x.v.name,x.v.size,x.v.color,x.quantity,x.unit,x.unit*x.quantity]});
    }
    await tx.commit();
  }catch(e){await tx.rollback();if(e.message==='STOCK_CONFLICT')throw Object.assign(new Error('Stock changed while placing your order. Please try again.'),{status:409});throw e;}
  return {ok:true,orderNumber,total,redirect:`/order/${orderNumber}`};
}

app.post('/api/orders',async(req,res,next)=>{try{const result=await createOrderFromPayload(req.body);res.json(result)}catch(e){next(e)}});

app.patch('/api/admin/orders/:id',requireAdmin,async(req,res,next)=>{try{const parsed=z.object({status:z.enum(['pending','confirmed','processing','shipped','delivered','cancelled']),paymentStatus:z.enum(['unpaid','paid','failed','refunded']).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid order status.'});const o=await one('SELECT * FROM orders WHERE id=?',[req.params.id]);if(!o)return res.status(404).json({error:'Order not found.'});const payment=parsed.data.paymentStatus||o.payment_status; if(parsed.data.status==='cancelled' && o.status!=='cancelled'){const items=(await q('SELECT variant_id,quantity FROM order_items WHERE order_id=?',[o.id])).rows;for(const it of items){if(it.variant_id) await q('UPDATE variants SET stock=stock+? WHERE id=?',[it.quantity,it.variant_id]);}} await q('UPDATE orders SET status=?,payment_status=? WHERE id=?',[parsed.data.status,payment,req.params.id]);res.json({ok:true});}catch(e){next(e)}});

app.post('/api/admin/categories',requireAdmin,async(req,res,next)=>{try{const p=z.object({name:z.string().trim().min(2).max(80),sortOrder:z.coerce.number().int().optional().default(0)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid category.'});await q('INSERT INTO categories(name,slug,sort_order) VALUES(?,?,?)',[p.data.name,slugify(p.data.name),p.data.sortOrder]);res.json({ok:true});}catch(e){next(e)}});
app.delete('/api/admin/categories/:id',requireAdmin,async(req,res,next)=>{try{await q('UPDATE categories SET active=0 WHERE id=?',[req.params.id]);res.json({ok:true});}catch(e){next(e)}});

app.post('/api/admin/products',requireAdmin,upload.single('image'),async(req,res,next)=>{try{const body={...req.body,featured:req.body.featured==='1'||req.body.featured==='true',active:req.body.active!=='0'};const p=z.object({name:z.string().trim().min(2).max(150),categoryId:z.coerce.number().int().positive(),description:z.string().max(5000).optional().default(''),price:z.coerce.number().int().nonnegative(),comparePrice:z.coerce.number().int().nonnegative().nullable().optional(),featured:z.boolean(),active:z.boolean(),sizes:z.string().optional().default('Free Size'),colors:z.string().optional().default('Default'),stocks:z.string().optional().default('0')}).safeParse(body);if(!p.success)return res.status(400).json({error:'Invalid product fields.'});const image=req.file?`/uploads/${req.file.filename}`:null;if(!image)return res.status(400).json({error:'Product image is required.'});const slug=slugify(p.data.name)+'-'+crypto.randomBytes(2).toString('hex');const r=await q('INSERT INTO products(category_id,name,slug,description,price,compare_price,image_url,featured,active) VALUES(?,?,?,?,?,?,?,?,?)',[p.data.categoryId,p.data.name,slug,p.data.description,p.data.price,p.data.comparePrice||null,image,p.data.featured?1:0,p.data.active?1:0]);const id=Number(r.lastInsertRowid);const sizes=p.data.sizes.split(',').map(x=>x.trim()).filter(Boolean);const colors=p.data.colors.split(',').map(x=>x.trim()).filter(Boolean);const stocks=p.data.stocks.split(',').map(x=>Math.max(0,Number(x.trim())||0));let i=0;for(const size of sizes)for(const color of colors){await q('INSERT INTO variants(product_id,size,color,stock,sku) VALUES(?,?,?,?,?)',[id,size,color,stocks[i]??stocks[0]??0,`RTX-${id}-${i+1}`]);i++;}res.json({ok:true});}catch(e){next(e)}});
app.put('/api/admin/products/:id',requireAdmin,upload.single('image'),async(req,res,next)=>{try{const id=Number(req.params.id);const old=await productById(id);if(!old)return res.status(404).json({error:'Product not found.'});const body={...req.body,featured:req.body.featured==='1'||req.body.featured==='true',active:req.body.active!=='0'};const p=z.object({name:z.string().trim().min(2).max(150),categoryId:z.coerce.number().int().positive(),description:z.string().max(5000).optional().default(''),price:z.coerce.number().int().nonnegative(),comparePrice:z.coerce.number().int().nonnegative().nullable().optional(),featured:z.boolean(),active:z.boolean(),sizes:z.string().optional().default('Free Size'),colors:z.string().optional().default('Default'),stocks:z.string().optional().default('0')}).safeParse(body);if(!p.success)return res.status(400).json({error:'Invalid product fields.'});let image=old.image_url;if(req.file){image=`/uploads/${req.file.filename}`;if(old.image_url?.startsWith('/uploads/')){const oldFile=path.join(process.cwd(),old.image_url);if(fs.existsSync(oldFile))fs.unlinkSync(oldFile);}}await q('UPDATE products SET category_id=?,name=?,description=?,price=?,compare_price=?,image_url=?,featured=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[p.data.categoryId,p.data.name,p.data.description,p.data.price,p.data.comparePrice||null,image,p.data.featured?1:0,p.data.active?1:0,id]);await q('DELETE FROM variants WHERE product_id=?',[id]);const sizes=p.data.sizes.split(',').map(x=>x.trim()).filter(Boolean),colors=p.data.colors.split(',').map(x=>x.trim()).filter(Boolean),stocks=p.data.stocks.split(',').map(x=>Math.max(0,Number(x.trim())||0));let i=0;for(const size of sizes)for(const color of colors){await q('INSERT INTO variants(product_id,size,color,stock,sku) VALUES(?,?,?,?,?)',[id,size,color,stocks[i]??stocks[0]??0,`RTX-${id}-${i+1}`]);i++;}res.json({ok:true});}catch(e){next(e)}});
app.delete('/api/admin/products/:id',requireAdmin,async(req,res,next)=>{try{const p=await productById(Number(req.params.id));if(!p)return res.status(404).json({error:'Product not found.'});await q('UPDATE products SET active=0 WHERE id=?',[p.id]);res.json({ok:true});}catch(e){next(e)}});

app.put('/api/admin/settings',requireAdmin,async(req,res,next)=>{try{const allowed=['store_name','tagline','phone','whatsapp','email','address','delivery_inside','delivery_outside','hero_title','hero_subtitle','about','footer_note'];for(const key of allowed){if(req.body[key]!==undefined)await q('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,String(req.body[key]).slice(0,5000)]);}res.json({ok:true});}catch(e){next(e)}});
app.post('/api/admin/reviews',requireAdmin,async(req,res,next)=>{try{const p=z.object({productId:z.coerce.number().int().positive(),name:z.string().trim().min(2).max(80),phoneModel:z.string().trim().max(80).optional().default(''),rating:z.coerce.number().int().min(1).max(5),comment:z.string().trim().min(3).max(1000),approved:z.coerce.boolean().default(true)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid review details.'});const product=await one('SELECT id FROM products WHERE id=?',[p.data.productId]);if(!product)return res.status(404).json({error:'Product not found.'});await q('INSERT INTO reviews(product_id,name,phone_model,rating,comment,approved) VALUES(?,?,?,?,?,?)',[p.data.productId,p.data.name,p.data.phoneModel,p.data.rating,p.data.comment,p.data.approved?1:0]);res.json({ok:true,message:'Review published.'});}catch(e){next(e)}});
app.patch('/api/admin/reviews/:id',requireAdmin,async(req,res,next)=>{try{const ok=Boolean(req.body.approved);await q('UPDATE reviews SET approved=? WHERE id=?',[ok?1:0,req.params.id]);res.json({ok:true});}catch(e){next(e)}});

async function buildChatContext() {
  const products = await allProducts({activeOnly:true,limit:30});
  const settings = await getSettings();
  return {settings, products: products.map(p=>({id:p.id,name:p.name,price:p.price,compare_price:p.compare_price,category:p.category_name,description:p.description,image_url:p.image_url,variants:p.variants.map(v=>({size:v.size,color:v.color,stock:v.stock}))}))};
}
function normalizeText(value){return String(value||'').toLowerCase().replace(/[।,!?;:()[\]{}]/g,' ').replace(/\s+/g,' ').trim()}
function parseNumber(text){const m=String(text).match(/(?:^|\s)(\d{1,2})(?:\s|$)/);return m?Number(m[1]):null}
function findSize(text){const m=normalizeText(text).match(/\b(3xl|xxxl|2xl|xxl|xl|large|ল|l|medium|ম|m|small|s|sm|free size|free)\b/);if(!m)return null;const v=m[1];return {'large':'L','ল':'L','medium':'M','ম':'M','small':'S','sm':'S','3xl':'3XL','xxxl':'3XL','2xl':'2XL','xxl':'2XL','xl':'XL','free size':'Free Size','free':'Free Size'}[v]||v.toUpperCase()}
function findColor(text,colors=[]){const n=normalizeText(text);const found=colors.find(c=>n.includes(normalizeText(c)));return found||null}
function isYes(text){return /^(yes|y|ok|okay|confirm|confirmed|ঠিক|ঠিক আছে|জি|হ্যাঁ|হ্যা|হ্যাঁজি|নিশ্চিত|করেন|করো|place|order|দেন|দাও|হবে)$/i.test(normalizeText(text)) || /ঠিক আছে|নিশ্চিত|অর্ডার করে দিন|order করে দিন|place order/i.test(text)}
function isNo(text){return /^(no|n|না|বাদ|cancel|ক্যানসেল|থাক)$/i.test(normalizeText(text))}
function productSummary(p){return {id:p.id,name:p.name,slug:p.slug,price:p.price,compare_price:p.compare_price,category:p.category_name,image_url:p.image_url,variants:p.variants}}

async function handleOrderConversation(message,state,products,settings){
  const text=normalizeText(message);let st={stage:'idle',productId:null,variantId:null,quantity:1,customerName:'',phone:'',address:'',area:'',deliveryZone:'inside',...state};
  if(isNo(message)){return {reply:'ঠিক আছে 😊 অর্ডারটা আপাতত বন্ধ রাখলাম। যখন চাইবেন আবার বলবেন—আমি সেখান থেকেই শুরু করব।',orderState:{stage:'idle'}}}
  const chooseProduct=()=>{
    const idMatch=text.match(/(?:product|প্রোডাক্ট|item|পণ্য)\s*(?:#|number|নং|নম্বর)?\s*(\d+)/i);
    let matches=idMatch?products.filter(p=>Number(p.id)===Number(idMatch[1])):products.filter(p=>text.includes(normalizeText(p.name))||normalizeText(p.name).split(' ').some(w=>w.length>3&&text.includes(w)));
    if(!matches.length){const priceMatch=text.match(/(?:under|within|below|কম|মধ্যে|বাজেট)\s*৳?\s*(\d{3,6})/i);if(priceMatch){const max=Number(priceMatch[1]);matches=products.filter(p=>Number(p.price)<=max).sort((a,b)=>a.price-b.price)}}
    return matches.slice(0,6);
  };
  if(st.stage==='idle'||st.stage==='awaiting_product'){
    const matches=chooseProduct();
    if(matches.length===1){const p=matches[0];st.productId=p.id;st.stage='awaiting_variant';const available=p.variants.filter(v=>Number(v.stock)>0);const sizes=[...new Set(available.map(v=>v.size))],colors=[...new Set(available.map(v=>v.color))];return {reply:`অবশ্যই 😊 **${p.name}**-এর অর্ডার নিতে পারি। দাম ৳${Number(p.price).toLocaleString('en-BD')}। আপনার কোন size এবং কোন color লাগবে? Available size: ${sizes.join(', ')}। Color: ${colors.join(', ')}।`,orderState:st,products:[productSummary(p)]}}
    if(matches.length>1)return {reply:'অবশ্যই 😊 এইগুলো আপনার কথার সাথে সবচেয়ে কাছাকাছি। কোনটা নিতে চান? নামটা লিখে দিন, অথবা নিচের “Order this” চাপুন।',orderState:{...st,stage:'awaiting_product'},products:matches.map(productSummary)};
    return {reply:'অবশ্যই 😊 আপনার অর্ডারটা আমি এখানেই নিতে পারি। কোন three-piece-টা নিতে চান? Product-এর নাম বলুন বা “silk three piece” / “pink one” এর মতো করে বলুন।',orderState:{...st,stage:'awaiting_product'}};
  }
  const p=products.find(x=>Number(x.id)===Number(st.productId));
  if(!p)return {reply:'এই product-টা এখন আর catalog-এ পাওয়া যাচ্ছে না। অন্য কোনো product নেবেন?',orderState:{stage:'awaiting_product'}};
  if(st.stage==='awaiting_variant'){
    const available=p.variants.filter(v=>Number(v.stock)>0);const size=findSize(message),color=findColor(message,available.map(v=>v.color));
    let candidates=available.filter(v=>(!size||normalizeText(v.size)===normalizeText(size))&&(!color||normalizeText(v.color)===normalizeText(color)));
    if(!candidates.length)return {reply:`এই combination-টা এখন available নেই। ${p.name}-এর available size/color থেকে কোনটা চান বলুন।`,orderState:st,products:[productSummary(p)]};
    if(candidates.length>1){const sizes=[...new Set(candidates.map(v=>v.size))],colors=[...new Set(candidates.map(v=>v.color))];return {reply:`একটু নিশ্চিত করে দিন 😊 আপনার size ${size||sizes.join('/')} এবং color ${color||colors.join('/')}—কোনটা নেব?`,orderState:st}}
    st.variantId=candidates[0].id;st.stage='awaiting_quantity';st.quantity=1;return {reply:`দারুণ 😊 ${p.name} — ${candidates[0].size}, ${candidates[0].color} সিলেক্ট করেছি। কয়টি লাগবে?`,orderState:st};
  }
  if(st.stage==='awaiting_quantity'){
    const qty=parseNumber(message);if(!qty||qty<1||qty>20)return {reply:'কয়টি লাগবে বলবেন? যেমন 1টি, 2টি।',orderState:st};
    const v=p.variants.find(x=>Number(x.id)===Number(st.variantId));if(!v||Number(v.stock)<qty)return {reply:`এই variant-এ এখন ${v?.stock||0}টি stock আছে। ${v?.stock?`সর্বোচ্চ ${v.stock}টি নিতে পারবেন।`:'অন্য size/color নিতে হবে।'}`,orderState:st};
    st.quantity=qty;st.stage='awaiting_name';return {reply:'ঠিক আছে 👍 এখন আপনার নামটা বলবেন?',orderState:st};
  }
  if(st.stage==='awaiting_name'){if(message.trim().length<2)return {reply:'আপনার পুরো নামটা লিখবেন, please 😊',orderState:st};st.customerName=message.trim().slice(0,100);st.stage='awaiting_phone';return {reply:'ধন্যবাদ। আপনার mobile numberটা দিন—delivery confirmation-এর জন্য লাগবে।',orderState:st};}
  if(st.stage==='awaiting_phone'){const phone=message.replace(/[^0-9+]/g,'');if(phone.length<8)return {reply:'একটা valid mobile number দিন, যেমন 01XXXXXXXXX।',orderState:st};st.phone=phone.slice(0,20);st.stage='awaiting_address';return {reply:'এখন delivery addressটা লিখুন। Area/Thana-সহ দিলে ভালো হয়।',orderState:st};}
  if(st.stage==='awaiting_address'){if(message.trim().length<5)return {reply:'একটু complete address দিন—area/thana এবং বাসা/road থাকলে ভালো হয়।',orderState:st};st.address=message.trim().slice(0,500);st.stage='awaiting_delivery';return {reply:`Delivery কোথায় হবে—**Inside** নাকি **Outside**? Inside ৳${settings.delivery_inside||80}, Outside ৳${settings.delivery_outside||130}.`,orderState:st};}
  if(st.stage==='awaiting_delivery'){
    st.deliveryZone=/outside|বাইরে|বাহির|ঢাকার বাইরে|out/i.test(text)?'outside':'inside';st.stage='confirm';
    const v=p.variants.find(x=>Number(x.id)===Number(st.variantId));const fee=Number(st.deliveryZone==='outside'?settings.delivery_outside||130:settings.delivery_inside||80);const total=Number(p.price)*st.quantity+fee;
    return {reply:`সব ঠিক আছে তো? 😊\n\nProduct: ${p.name}\nSize: ${v.size}\nColor: ${v.color}\nQuantity: ${st.quantity}\nProduct total: ৳${Number(p.price)*st.quantity}\nDelivery: ৳${fee}\nTotal: ৳${total}\nName: ${st.customerName}\nPhone: ${st.phone}\nAddress: ${st.address}\n\nসব ঠিক থাকলে **“হ্যাঁ, অর্ডার করুন”** লিখুন।`,orderState:st};
  }
  if(st.stage==='confirm'){
    if(!isYes(message))return {reply:'অর্ডারটি এখনো confirm করা হয়নি। তথ্যগুলো ঠিক থাকলে “হ্যাঁ, অর্ডার করুন” লিখুন; পরিবর্তন করতে চাইলে কোন তথ্যটা বদলাবেন বলুন।',orderState:st};
    const result=await createOrderFromPayload({customerName:st.customerName,phone:st.phone,address:st.address,area:st.area,note:'Order placed through R TEX BD Assistant',deliveryZone:st.deliveryZone,items:[{productId:st.productId,variantId:st.variantId,quantity:st.quantity}]});
    return {reply:`অর্ডারটি হয়ে গেছে! 🎉 আপনার Order Number **${result.orderNumber}**। মোট ৳${result.total}। এখন এই order numberটি রেখে দিন—এটা দিয়ে পরে status জানতে পারবেন।`,orderState:{stage:'placed'},orderComplete:true,redirect:result.redirect};
  }
  return {reply:'ঠিক আছে 😊 অর্ডার নিতে চাইলে product-এর নাম বলুন।',orderState:{stage:'idle'}};
}

app.post('/api/chat',async(req,res,next)=>{try{
  const message=String(req.body.message||'').trim().slice(0,1200);if(!message)return res.status(400).json({error:'Message required.'});
  const context=await buildChatContext();const products=context.products.map(p=>({...p,slug:p.slug||''}));const matches=await allProducts({search:message,limit:6});
  const state=req.body.orderState&&typeof req.body.orderState==='object'?req.body.orderState:{stage:'idle'};
  const orderNumberMatch=message.match(/RTX-[A-Z0-9-]+/i);
  if(orderNumberMatch && /status|স্ট্যাটাস|কোথায়|কখন|অর্ডার|order|track|tracking/i.test(message)){
    const order=await one('SELECT order_number,customer_name,total,status,payment_status,created_at FROM orders WHERE order_number=?',[orderNumberMatch[0].toUpperCase()]);
    if(!order)return res.json({reply:`এই Order Number-টা database-এ খুঁজে পেলাম না: ${orderNumberMatch[0].toUpperCase()}। নম্বরটা আরেকবার মিলিয়ে পাঠাবেন?`,products:[]});
    const statusText={pending:'অর্ডারটি নেওয়া হয়েছে, এখন confirmation-এর অপেক্ষায় আছে',confirmed:'অর্ডারটি confirm করা হয়েছে',processing:'অর্ডারটি প্রস্তুত করা হচ্ছে',shipped:'অর্ডারটি courier-এ দেওয়া হয়েছে',delivered:'অর্ডারটি delivered হয়েছে',cancelled:'অর্ডারটি cancelled হয়েছে'}[order.status]||order.status;
    return res.json({reply:`জি 😊 আপনার order **${order.order_number}**-এর বর্তমান অবস্থা: ${statusText}। Payment status: ${order.payment_status}। মোট ৳${Number(order.total).toLocaleString('en-BD')}।`,products:[]});
  }
  const orderWords=/order|অর্ডার|কিনবো|কিনতে|buy|place|নেব|দেন|দাও|চাই/i.test(message);
  if(state.stage!=='idle'||orderWords){
    const result=await handleOrderConversation(message,state,products,context.settings);return res.json(result);
  }
  const key=process.env.GEMINI_API_KEY;
  const history=Array.isArray(req.body.history)?req.body.history.slice(-12).map(x=>({role:x?.role==='assistant'?'model':'user',parts:[{text:String(x?.content||'').slice(0,1200)}]})).filter(x=>x.parts[0].text):[];
  if(key){
    const prompt=`You are the warm, practical sales assistant for R TEX BD, a real Bangladesh women's three-piece clothing shop. Talk like a good human shopkeeper: natural Bangla/Banglish/English, polite, short, friendly, attentive, and conversational. Remember context from the chat. Do not sound robotic, repeat the same greeting, or dump menus. Ask one useful follow-up question when needed. Help with product discovery, fabric, style, budget, size, color, stock, delivery, returns, contact and order help. For orders, the coded order flow handles the actual transaction. Never invent catalog facts, price, stock, policy or order status. Use exact store data below.\n\nSTORE DATA:\n${JSON.stringify(context)}\n\nMATCHED PRODUCTS:\n${JSON.stringify(matches.map(productSummary))}\n\nCustomer message: ${message}`;
    const contents=[...history,{role:'user',parts:[{text:prompt}]}];
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL||'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents,generationConfig:{temperature:0.75,maxOutputTokens:500}})});
    if(r.ok){const data=await r.json();const reply=data?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim();if(reply)return res.json({reply,products:matches});}
  }
  const lower=normalizeText(message);const st=context.settings;let reply;
  if(matches.length)reply=`জি 😊 আপনার কথার সাথে মিল আছে এমন ${matches.length}টা collection পেয়েছি। কোনটা পছন্দ হচ্ছে বললে আমি price, size, color আর stock দেখে ঠিক করে বলছি।`;
  else if(/hi|hello|hey|হাই|হ্যালো|আসসালাম|salam/.test(lower))reply='আসসালামু আলাইকুম 😊 R TEX BD-তে স্বাগতম। কী ধরনের three-piece খুঁজছেন—daily wear, party wear, silk, cotton, নাকি আপনার budget অনুযায়ী কিছু?';
  else if(/delivery|ডেলিভারি|চার্জ|charge|কত লাগে/.test(lower))reply=`জি, delivery charge Inside ৳${st.delivery_inside||80} এবং Outside ৳${st.delivery_outside||130}। আপনার কোন area-তে delivery লাগবে?`;
  else if(/size|সাইজ|fit|মাপ/.test(lower))reply='অবশ্যই 😊 কোন product-এর size জানতে চান? Product-এর নাম বললে available size আর stock দেখে বলে দিচ্ছি।';
  else if(/return|exchange|রিটার্ন|এক্সচেঞ্জ/.test(lower))reply='অবশ্যই। Return/Exchange নিয়ে সাহায্য করতে পারি। কী সমস্যা হয়েছে বা কোন order-এর কথা বলছেন?';
  else if(/contact|whatsapp|যোগাযোগ|phone|নাম্বার|number/.test(lower))reply=`জি, R TEX BD support WhatsApp নম্বর ${st.phone||'01629380347'}। চাইলে এখান থেকেই product নিয়ে কথা বলতে পারেন, অথবা WhatsApp-এ সরাসরি message করতে পারেন।`;
  else if(/price|দাম|কত|budget|টাকা|within/.test(lower))reply='অবশ্যই 😊 আপনার budgetটা বলুন—যেমন “৳2500-এর মধ্যে”। আমি সেই range-এর collection খুঁজে সাজেস্ট করব।';
  else reply='জি, বলুন 😊 আমি শুনছি। আপনি product, budget, size, color, stock, delivery বা সরাসরি order—যেটা দরকার সেটাই নিয়ে সাহায্য করছি।';
  res.json({reply,products:matches});
}catch(e){next(e)}});

app.use((req,res)=>res.status(404).render('404'));
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);res.status(Number(err.status)||500).json({error:err.message||'Something went wrong. Please try again.'})});

init().then(()=>app.listen(PORT,()=>console.log(`R TEX BD running on http://localhost:${PORT}`))).catch(e=>{console.error('Startup failed:',e);process.exit(1)});

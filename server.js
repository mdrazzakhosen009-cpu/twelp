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
function isAdmin(req) { return req.session?.admin === true; }
function requireAdmin(req, res, next) { if (!isAdmin(req)) return res.status(401).json({ error: 'Admin authentication required.' }); const origin=req.get('origin'); if(origin && origin!==`${req.protocol}://${req.get('host')}`) return res.status(403).json({error:'Cross-site request blocked.'}); next(); }

async function init() {
  const schema = fs.readFileSync('./schema.sql', 'utf8');
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await q(statement);
  const defaults = {
    store_name: 'R TEX BD', tagline: "Women’s Three-Piece Collection", phone: '01629380347', whatsapp: '8801629380347', email: '', address: 'Bangladesh', delivery_inside: '80', delivery_outside: '130', hero_title: 'Elegant Three-Piece, Made for You', hero_subtitle: 'Premium women’s three-piece collection with style, quality and comfort.', about: 'R TEX BD is a women’s clothing brand focused exclusively on beautiful three-piece collections.', footer_note: 'Style | Quality | Comfort', currency: '৳'
  };
  for (const [key, value] of Object.entries(defaults)) await q('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', [key, value]);
  if (process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const cat = await one('SELECT id FROM categories LIMIT 1');
  if (!cat) {
    const names = ['New Collection', 'Premium Three-Piece', 'Embroidered', 'Everyday Elegance'];
    for (let i = 0; i < names.length; i++) await q('INSERT INTO categories(name,slug,sort_order) VALUES(?,?,?)', [names[i], slugify(names[i]), i]);
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
app.get('/contact', async(req,res,next)=>{try{res.render('contact')}catch(e){next(e)}});
app.get('/checkout', (req,res)=>res.render('checkout'));
app.get('/order/:orderNumber', async(req,res,next)=>{try{const o=await one('SELECT * FROM orders WHERE order_number=?',[req.params.orderNumber]); if(!o)return res.status(404).render('404'); const items=(await q('SELECT * FROM order_items WHERE order_id=?',[o.id])).rows; res.render('order',{order:o,items});}catch(e){next(e)}});
app.get('/admin/login',(req,res)=>{if(isAdmin(req))return res.redirect('/admin');res.render('admin-login')});
app.get('/admin', requireAdminPage, async(req,res,next)=>{try{const stats={products:(await one('SELECT COUNT(*) n FROM products'))?.n||0,orders:(await one('SELECT COUNT(*) n FROM orders'))?.n||0,customers:(await one('SELECT COUNT(DISTINCT phone) n FROM orders'))?.n||0,revenue:(await one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status='paid'"))?.n||0}; const recent=(await q('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10')).rows; res.render('admin',{stats,recent});}catch(e){next(e)}});
function requireAdminPage(req,res,next){ if(!isAdmin(req)) return res.redirect('/admin/login'); next(); }
app.get('/admin/products',requireAdminPage,async(req,res,next)=>{try{res.render('admin-products',{products:await allProducts({activeOnly:false,limit:500})})}catch(e){next(e)}});
app.get('/admin/orders',requireAdminPage,async(req,res,next)=>{try{res.render('admin-orders',{orders:(await q('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500')).rows})}catch(e){next(e)}});
app.get('/admin/content',requireAdminPage,async(req,res,next)=>{try{const reviews=(await q('SELECT r.*,p.name product_name FROM reviews r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC LIMIT 200')).rows;res.render('admin-content',{reviews})}catch(e){next(e)}});
app.get('/admin/settings',requireAdminPage,async(req,res,next)=>{try{res.render('admin-settings',{settings:await getSettings()})}catch(e){next(e)}});

const storage = multer.diskStorage({ destination: uploadDir, filename: (req,file,cb)=>cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) });
const upload = multer({ storage, limits:{fileSize:5*1024*1024}, fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) });

app.post('/api/admin/login',adminLimiter,async(req,res)=>{const parsed=z.object({username:z.string().min(1),password:z.string().min(1)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Username and password are required.'});const username=process.env.ADMIN_USERNAME||'admin',hash=process.env.ADMIN_PASSWORD_HASH;if(!hash)return res.status(500).json({error:'Admin password is not configured on the server.'});const valid=await bcrypt.compare(parsed.data.password,hash);if(parsed.data.username!==username || !valid)return res.status(401).json({error:'Invalid admin credentials.'});req.session.admin=true;return res.json({ok:true,redirect:'/admin'});});
app.post('/api/admin/logout',requireAdmin,(req,res)=>{req.session=null;res.json({ok:true,redirect:'/admin/login'})});

app.get('/api/products',async(req,res,next)=>{try{res.json({products:await allProducts({category:req.query.category||'',search:req.query.q||'',sort:req.query.sort||'newest',featured:req.query.featured==='1',limit:Math.min(Number(req.query.limit||48),100),offset:Math.max(Number(req.query.offset||0),0)})})}catch(e){next(e)}});
app.get('/api/products/:id',async(req,res,next)=>{try{const p=await productById(Number(req.params.id));if(!p||!p.active)return res.status(404).json({error:'Product not found'});res.json({product:p})}catch(e){next(e)}});
app.get('/api/categories',async(req,res,next)=>{try{res.json({categories:await getCategories()})}catch(e){next(e)}});
app.get('/api/settings/public',async(req,res,next)=>{try{const s=await getSettings();delete s.admin_password;res.json({settings:s})}catch(e){next(e)}});

app.post('/api/reviews',async(req,res,next)=>{try{const parsed=z.object({productId:z.coerce.number().int().positive(),name:z.string().trim().min(2).max(80),phoneModel:z.string().trim().max(80).optional().default(''),rating:z.coerce.number().int().min(1).max(5),comment:z.string().trim().min(3).max(1000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Please complete the review correctly.'});const p=await one('SELECT id FROM products WHERE id=? AND active=1',[parsed.data.productId]);if(!p)return res.status(404).json({error:'Product not found.'});await q('INSERT INTO reviews(product_id,name,phone_model,rating,comment,approved) VALUES(?,?,?,?,?,0)',[parsed.data.productId,parsed.data.name,parsed.data.phoneModel,parsed.data.rating,parsed.data.comment]);res.json({ok:true,message:'Review submitted for approval.'});}catch(e){next(e)}});

app.post('/api/orders',async(req,res,next)=>{let cart;try{const parsed=z.object({customerName:z.string().trim().min(2).max(100),phone:z.string().trim().min(8).max(20),address:z.string().trim().min(5).max(500),area:z.string().trim().max(100).optional().default(''),note:z.string().trim().max(500).optional().default(''),deliveryZone:z.enum(['inside','outside']).default('inside'),items:z.array(z.object({productId:z.coerce.number().int().positive(),variantId:z.coerce.number().int().positive(),quantity:z.coerce.number().int().min(1).max(20)})).min(1).max(30)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid checkout information.'});cart=parsed.data;let subtotal=0;const resolved=[];for(const item of cart.items){const v=await one('SELECT v.*,p.name,p.price,p.active,p.compare_price,p.image_url FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.product_id=? AND p.active=1',[item.variantId,item.productId]);if(!v)return res.status(400).json({error:'One of the selected variants is no longer available.'});if(Number(v.stock)<item.quantity)return res.status(409).json({error:`Insufficient stock for ${v.name} (${v.size}, ${v.color}).`});const unit=Number(v.price);subtotal+=unit*item.quantity;resolved.push({...item,v,unit});}
const deliveryFee=cart.deliveryZone==='outside'?Number((await getSettings()).delivery_outside||130):Number((await getSettings()).delivery_inside||80);const total=subtotal+deliveryFee;const orderNumber='RTX-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
const tx=await db.transaction('write');try{const r=await tx.execute({sql:'INSERT INTO orders(order_number,customer_name,phone,address,area,note,subtotal,delivery_fee,total,status,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:[orderNumber,cart.customerName,cart.phone,cart.address,cart.area,cart.note,subtotal,deliveryFee,total,'pending','unpaid']});const orderId=Number(r.lastInsertRowid);for(const x of resolved){const upd=await tx.execute({sql:'UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?',args:[x.quantity,x.variantId,x.quantity]});if(Number(upd.rowsAffected)!==1)throw new Error('STOCK_CONFLICT');await tx.execute({sql:'INSERT INTO order_items(order_id,product_id,variant_id,product_name,size,color,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?,?,?)',args:[orderId,x.productId,x.variantId,x.v.name,x.v.size,x.v.color,x.quantity,x.unit,x.unit*x.quantity]});}await tx.commit();}catch(e){await tx.rollback();if(e.message==='STOCK_CONFLICT')return res.status(409).json({error:'Stock changed while placing your order. Please review your cart and try again.'});throw e;}
res.json({ok:true,orderNumber,total,redirect:`/order/${orderNumber}`});}catch(e){next(e)}});

app.patch('/api/admin/orders/:id',requireAdmin,async(req,res,next)=>{try{const parsed=z.object({status:z.enum(['pending','confirmed','processing','shipped','delivered','cancelled']),paymentStatus:z.enum(['unpaid','paid','failed','refunded']).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid order status.'});const o=await one('SELECT * FROM orders WHERE id=?',[req.params.id]);if(!o)return res.status(404).json({error:'Order not found.'});const payment=parsed.data.paymentStatus||o.payment_status; if(parsed.data.status==='cancelled' && o.status!=='cancelled'){const items=(await q('SELECT variant_id,quantity FROM order_items WHERE order_id=?',[o.id])).rows;for(const it of items){if(it.variant_id) await q('UPDATE variants SET stock=stock+? WHERE id=?',[it.quantity,it.variant_id]);}} await q('UPDATE orders SET status=?,payment_status=? WHERE id=?',[parsed.data.status,payment,req.params.id]);res.json({ok:true});}catch(e){next(e)}});

app.post('/api/admin/categories',requireAdmin,async(req,res,next)=>{try{const p=z.object({name:z.string().trim().min(2).max(80),sortOrder:z.coerce.number().int().optional().default(0)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid category.'});await q('INSERT INTO categories(name,slug,sort_order) VALUES(?,?,?)',[p.data.name,slugify(p.data.name),p.data.sortOrder]);res.json({ok:true});}catch(e){next(e)}});
app.delete('/api/admin/categories/:id',requireAdmin,async(req,res,next)=>{try{await q('UPDATE categories SET active=0 WHERE id=?',[req.params.id]);res.json({ok:true});}catch(e){next(e)}});

app.post('/api/admin/products',requireAdmin,upload.single('image'),async(req,res,next)=>{try{const body={...req.body,featured:req.body.featured==='1'||req.body.featured==='true',active:req.body.active!=='0'};const p=z.object({name:z.string().trim().min(2).max(150),categoryId:z.coerce.number().int().positive(),description:z.string().max(5000).optional().default(''),price:z.coerce.number().int().nonnegative(),comparePrice:z.coerce.number().int().nonnegative().nullable().optional(),featured:z.boolean(),active:z.boolean(),sizes:z.string().optional().default('Free Size'),colors:z.string().optional().default('Default'),stocks:z.string().optional().default('0')}).safeParse(body);if(!p.success)return res.status(400).json({error:'Invalid product fields.'});const image=req.file?`/uploads/${req.file.filename}`:null;if(!image)return res.status(400).json({error:'Product image is required.'});const slug=slugify(p.data.name)+'-'+crypto.randomBytes(2).toString('hex');const r=await q('INSERT INTO products(category_id,name,slug,description,price,compare_price,image_url,featured,active) VALUES(?,?,?,?,?,?,?,?,?)',[p.data.categoryId,p.data.name,slug,p.data.description,p.data.price,p.data.comparePrice||null,image,p.data.featured?1:0,p.data.active?1:0]);const id=Number(r.lastInsertRowid);const sizes=p.data.sizes.split(',').map(x=>x.trim()).filter(Boolean);const colors=p.data.colors.split(',').map(x=>x.trim()).filter(Boolean);const stocks=p.data.stocks.split(',').map(x=>Math.max(0,Number(x.trim())||0));let i=0;for(const size of sizes)for(const color of colors){await q('INSERT INTO variants(product_id,size,color,stock,sku) VALUES(?,?,?,?,?)',[id,size,color,stocks[i]??stocks[0]??0,`RTX-${id}-${i+1}`]);i++;}res.json({ok:true});}catch(e){next(e)}});
app.put('/api/admin/products/:id',requireAdmin,upload.single('image'),async(req,res,next)=>{try{const id=Number(req.params.id);const old=await productById(id);if(!old)return res.status(404).json({error:'Product not found.'});const body={...req.body,featured:req.body.featured==='1'||req.body.featured==='true',active:req.body.active!=='0'};const p=z.object({name:z.string().trim().min(2).max(150),categoryId:z.coerce.number().int().positive(),description:z.string().max(5000).optional().default(''),price:z.coerce.number().int().nonnegative(),comparePrice:z.coerce.number().int().nonnegative().nullable().optional(),featured:z.boolean(),active:z.boolean(),sizes:z.string().optional().default('Free Size'),colors:z.string().optional().default('Default'),stocks:z.string().optional().default('0')}).safeParse(body);if(!p.success)return res.status(400).json({error:'Invalid product fields.'});let image=old.image_url;if(req.file){image=`/uploads/${req.file.filename}`;if(old.image_url?.startsWith('/uploads/')){const oldFile=path.join(process.cwd(),old.image_url);if(fs.existsSync(oldFile))fs.unlinkSync(oldFile);}}await q('UPDATE products SET category_id=?,name=?,description=?,price=?,compare_price=?,image_url=?,featured=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[p.data.categoryId,p.data.name,p.data.description,p.data.price,p.data.comparePrice||null,image,p.data.featured?1:0,p.data.active?1:0,id]);await q('DELETE FROM variants WHERE product_id=?',[id]);const sizes=p.data.sizes.split(',').map(x=>x.trim()).filter(Boolean),colors=p.data.colors.split(',').map(x=>x.trim()).filter(Boolean),stocks=p.data.stocks.split(',').map(x=>Math.max(0,Number(x.trim())||0));let i=0;for(const size of sizes)for(const color of colors){await q('INSERT INTO variants(product_id,size,color,stock,sku) VALUES(?,?,?,?,?)',[id,size,color,stocks[i]??stocks[0]??0,`RTX-${id}-${i+1}`]);i++;}res.json({ok:true});}catch(e){next(e)}});
app.delete('/api/admin/products/:id',requireAdmin,async(req,res,next)=>{try{const p=await productById(Number(req.params.id));if(!p)return res.status(404).json({error:'Product not found.'});await q('UPDATE products SET active=0 WHERE id=?',[p.id]);res.json({ok:true});}catch(e){next(e)}});

app.put('/api/admin/settings',requireAdmin,async(req,res,next)=>{try{const allowed=['store_name','tagline','phone','whatsapp','email','address','delivery_inside','delivery_outside','hero_title','hero_subtitle','about','footer_note'];for(const key of allowed){if(req.body[key]!==undefined)await q('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,String(req.body[key]).slice(0,5000)]);}res.json({ok:true});}catch(e){next(e)}});
app.patch('/api/admin/reviews/:id',requireAdmin,async(req,res,next)=>{try{const ok=Boolean(req.body.approved);await q('UPDATE reviews SET approved=? WHERE id=?',[ok?1:0,req.params.id]);res.json({ok:true});}catch(e){next(e)}});

app.post('/api/chat',async(req,res,next)=>{try{const message=String(req.body.message||'').trim().slice(0,1000);if(!message)return res.status(400).json({error:'Message required.'});const products=await allProducts({search:message,limit:5});const lower=message.toLowerCase();let reply='';if(products.length){reply=`I found ${products.length} matching collection item${products.length>1?'s':''}. You can open the products below to see sizes, colors, stock and price.`;}else if(/delivery|ডেলিভারি|delivery charge/.test(lower)){const s=await getSettings();reply=`Delivery charge is ৳${s.delivery_inside} inside the main delivery area and ৳${s.delivery_outside} outside. The exact charge is shown at checkout.`;}else if(/contact|whatsapp|phone|যোগাযোগ/.test(lower)){const s=await getSettings();reply=`You can contact R TEX BD on WhatsApp at ${s.phone}. Tap the WhatsApp button in the header to start a chat.`;}else if(/size|সাইজ/.test(lower)){reply='Product pages show every available size and color. Select your preferred variant before adding it to the cart.';}else if(/order|অর্ডার/.test(lower)){reply='Choose a product, select size and color, add it to cart, then complete your name, phone and delivery address at checkout. You will receive an order number immediately.';}else{reply='Welcome to R TEX BD. I can help you find three-piece collections, sizes, colors, delivery information and ordering steps. Try asking for a product name, size, delivery or order help.';}res.json({reply,products});}catch(e){next(e)}});

app.use((req,res)=>res.status(404).render('404'));
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);res.status(500).json({error:'Something went wrong. Please try again.'})});

init().then(()=>app.listen(PORT,()=>console.log(`R TEX BD running on http://localhost:${PORT}`))).catch(e=>{console.error('Startup failed:',e);process.exit(1)});

const express = require('express');
const { exec, transaction } = require('../db');
const { safeInt, safeMoney, cleanText, normalizePhone, orderCode, parseJson } = require('../lib/utils');

const router = express.Router();

async function getSettings() {
  const r = await exec('SELECT key,value FROM settings');
  return Object.fromEntries(r.rows.map(x=>[x.key,x.value]));
}

router.get('/store', async (_req,res,next)=>{
  try {
    const [settings, sections, categories, services, faqs, testimonials, reviews, socials] = await Promise.all([
      exec('SELECT key,value FROM settings'),
      exec('SELECT * FROM landing_sections WHERE enabled=1 ORDER BY sort_order,id'),
      exec('SELECT * FROM categories WHERE active=1 ORDER BY sort_order,name'),
      exec('SELECT * FROM services WHERE enabled=1 ORDER BY sort_order,id'),
      exec('SELECT * FROM faqs WHERE enabled=1 ORDER BY sort_order,id'),
      exec('SELECT * FROM testimonials WHERE enabled=1 ORDER BY sort_order,id'),
      exec('SELECT * FROM reviews WHERE enabled=1 ORDER BY sort_order,id'),
      exec('SELECT * FROM social_links WHERE enabled=1 ORDER BY sort_order,id')
    ]);
    const outSections = sections.rows.map(s=>({...s, content:parseJson(s.content_json,{})}));
    res.json({settings:Object.fromEntries(settings.rows.map(x=>[x.key,x.value])),sections:outSections,categories:categories.rows,services:services.rows,faqs:faqs.rows,testimonials:testimonials.rows,reviews:reviews.rows,socials:socials.rows});
  } catch(e){ next(e); }
});

router.get('/categories', async (_req,res,next)=>{ try { const r=await exec('SELECT * FROM categories WHERE active=1 ORDER BY sort_order,name'); res.json(r.rows); } catch(e){next(e);} });

router.get('/products', async (req,res,next)=>{
  try {
    const where=['p.active=1']; const args=[];
    if(req.query.category){ where.push('c.slug=?'); args.push(String(req.query.category)); }
    if(req.query.search){ const q=`%${String(req.query.search).toLowerCase()}%`; where.push('(LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.sku) LIKE ?)'); args.push(q,q,q); }
    if(req.query.featured==='1') where.push('p.featured=1');
    if(req.query.availability==='in') where.push('p.stock>0');
    if(req.query.min_price!=='') { const n=Number(req.query.min_price); if(Number.isFinite(n)) { where.push('COALESCE(p.sale_price,p.price)>=?'); args.push(n); } }
    if(req.query.max_price!=='') { const n=Number(req.query.max_price); if(Number.isFinite(n)) { where.push('COALESCE(p.sale_price,p.price)<=?'); args.push(n); } }
    const sortMap={new:'p.created_at DESC',price_asc:'COALESCE(p.sale_price,p.price) ASC',price_desc:'COALESCE(p.sale_price,p.price) DESC',name:'LOWER(p.name) ASC',featured:'p.featured DESC,p.sort_order ASC,p.created_at DESC'};
    const order=sortMap[req.query.sort]||'p.featured DESC,p.sort_order ASC,p.created_at DESC';
    const r=await exec(`SELECT p.*,c.name category_name,c.slug category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 120`,args);
    res.json(r.rows.map(p=>({...p,gallery:parseJson(p.gallery_json,[]),variants:parseJson(p.variants_json,[])})));
  } catch(e){next(e);}
});

router.get('/products/:slug', async (req,res,next)=>{
  try{
    const r=await exec(`SELECT p.*,c.name category_name,c.slug category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=? AND p.active=1`,[req.params.slug]);
    if(!r.rows[0]) return res.status(404).json({error:'Product not found'});
    const p=r.rows[0]; const related=await exec('SELECT * FROM products WHERE active=1 AND category_id IS ? AND id<>? ORDER BY featured DESC,sort_order ASC,created_at DESC LIMIT 4',[p.category_id,p.id]);
    res.json({...p,gallery:parseJson(p.gallery_json,[]),variants:parseJson(p.variants_json,[]),related:related.rows});
  }catch(e){next(e);}
});

router.get('/orders/:code', async (req,res,next)=>{
  try{
    const r=await exec(`SELECT o.order_code,o.subtotal,o.delivery_fee,o.total,o.payment_method,o.payment_status,o.order_status,o.created_at,c.name,c.phone,c.email,c.address,c.city FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.order_code=?`,[req.params.code]);
    if(!r.rows[0]) return res.status(404).json({error:'Order not found'});
    const items=await exec('SELECT product_name,sku,unit_price,quantity,line_total FROM order_items WHERE order_id=(SELECT id FROM orders WHERE order_code=?)',[req.params.code]);
    res.json({...r.rows[0],items:items.rows});
  }catch(e){next(e);}
});

router.post('/orders', async (req,res,next)=>{
  try{
    const {customer,items,payment_method='cod',payment_sender='',transaction_id='',notes=''}=req.body||{};
    if(!customer?.name||!customer?.phone||!customer?.address||!Array.isArray(items)||!items.length) return res.status(400).json({error:'Name, phone, address and at least one item are required.'});
    const settings=await getSettings();
    const allowed=[];
    if(settings.cod_enabled==='1') allowed.push('cod');
    if(settings.bkash_enabled==='1') allowed.push('bkash');
    if(settings.nagad_enabled==='1') allowed.push('nagad');
    if(settings.rocket_enabled==='1') allowed.push('rocket');
    if(!allowed.includes(payment_method)) return res.status(400).json({error:'This payment method is currently unavailable.'});
    if(payment_method!=='cod' && (!normalizePhone(payment_sender)||!String(transaction_id).trim())) return res.status(400).json({error:'Sender number and transaction ID are required for manual payment.'});

    const cleanItems=[]; const seen=new Set();
    for(const item of items.slice(0,50)){
      const id=safeInt(item.product_id); const qty=Math.max(1,Math.min(20,safeInt(item.quantity,0)));
      if(id<1||qty<1||seen.has(id)) continue; seen.add(id);
      const p=await exec('SELECT id,name,sku,price,sale_price,stock,active,image_url FROM products WHERE id=?',[id]);
      if(!p.rows[0]||!p.rows[0].active) return res.status(400).json({error:'A product in your cart is no longer available.'});
      if(Number(p.rows[0].stock)<qty) return res.status(400).json({error:`Not enough stock for ${p.rows[0].name}.`});
      const price=Number(p.rows[0].sale_price ?? p.rows[0].price); cleanItems.push({...p.rows[0],quantity:qty,unit_price:price,line_total:price*qty});
    }
    if(!cleanItems.length) return res.status(400).json({error:'Your cart is empty.'});
    const subtotal=cleanItems.reduce((a,b)=>a+b.line_total,0); const delivery=safeMoney(settings.delivery_fee,80); const total=subtotal+delivery; const code=orderCode();
    const result=await transaction(async tx=>{
      const existing=await tx.execute('SELECT id FROM customers WHERE phone=?',[normalizePhone(customer.phone)]); let customerId;
      if(existing.rows[0]){
        customerId=Number(existing.rows[0].id);
        await tx.execute('UPDATE customers SET name=?,email=?,address=?,city=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[cleanText(customer.name,120),cleanText(customer.email,160),cleanText(customer.address,500),cleanText(customer.city,100),customerId]);
      } else {
        const c=await tx.execute('INSERT INTO customers(name,phone,email,address,city) VALUES(?,?,?,?,?)',[cleanText(customer.name,120),normalizePhone(customer.phone),cleanText(customer.email,160),cleanText(customer.address,500),cleanText(customer.city,100)]); customerId=Number(c.lastInsertRowid);
      }
      const o=await tx.execute('INSERT INTO orders(order_code,customer_id,subtotal,delivery_fee,total,payment_method,payment_sender,transaction_id,payment_status,order_status,notes,items_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[code,customerId,subtotal,delivery,total,payment_method,payment_method==='cod'?'':normalizePhone(payment_sender),payment_method==='cod'?'':cleanText(transaction_id,120),'pending','pending',cleanText(notes,1000),JSON.stringify(cleanItems)]);
      const orderId=Number(o.lastInsertRowid);
      for(const p of cleanItems){
        const updated=await tx.execute('UPDATE products SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND active=1 AND stock>=?',[p.quantity,p.id,p.quantity]);
        if(Number(updated.rowsAffected)!==1) throw Object.assign(new Error('Stock changed'),{code:'STOCK'});
        await tx.execute('INSERT INTO order_items(order_id,product_id,product_name,sku,unit_price,quantity,line_total) VALUES(?,?,?,?,?,?,?)',[orderId,p.id,p.name,p.sku||'',p.unit_price,p.quantity,p.line_total]);
      }
      return {orderId};
    });
    res.status(201).json({success:true,order_code:code,total,payment_status:'pending'});
  }catch(e){ if(e.code==='STOCK') return res.status(409).json({error:'Stock changed while placing the order. Please review your cart and try again.'}); next(e); }
});

router.post('/leads', async (req,res,next)=>{
  try{
    const b=req.body||{}; if(!String(b.message||'').trim() && !String(b.phone||'').trim() && !String(b.email||'').trim()) return res.status(400).json({error:'Please provide a message or contact detail.'});
    await exec('INSERT INTO leads(name,phone,email,interest,message) VALUES(?,?,?,?,?)',[cleanText(b.name,120),normalizePhone(b.phone),cleanText(b.email,160),cleanText(b.interest,160),cleanText(b.message,2000)]);
    res.status(201).json({success:true});
  }catch(e){next(e);}
});

module.exports=router;

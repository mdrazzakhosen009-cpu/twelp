const CHAT = {
  greeting: [/^(hi|hello|hey|yo|salam|assalam|assalamu|হাই|হ্যালো|আসসালাম|সালাম)([!,. ]|$)/i],
  thanks: [/thank/i,/ধন্যবাদ/i,/thanks/i,/thx/i],
  bye: [/bye/i,/good night/i,/বিদায়/i,/আল্লাহ হাফেজ/i],
  help: [/help|সাহায্য|কি কি|what can you do|কী করতে পার/i],
  recommendation: [/recommend|suggest|সাজেস্ট|রেকমেন্ড|ভালোটা|best|কোনটা নেব|কোনটা ভালো|দেখাও|দেখান|চাই/i],
  delivery: [/delivery|ডেলিভারি|courier|কুরিয়ার|shipping|শিপিং|charge|চার্জ|কত লাগে|কত টাকা.*ডেলিভারি/i],
  deliveryTime: [/কতদিন|কয়দিন|কত দিন|দিন লাগে|সময় লাগে|delivery.*time|কবে.*পাব/i],
  orderHow: [/how.*(order|buy)|order.*(কর|koro|korbo)|buy|কিভাবে.*(অর্ডার|কিনব|কিনবো|কিনতে)|অর্ডার.*কিভাবে/i],
  track: [/track|tracking|স্ট্যাটাস|status|কোথায়.*অর্ডার|order.*কোথায়|আমার.*অর্ডার/i],
  cancel: [/cancel|বাতিল|অর্ডার.*cancel|cancel.*order/i],
  return: [/return|exchange|রিটার্ন|এক্সচেঞ্জ|বদল|ফেরত/i],
  payment: [/payment|পেমেন্ট|cash on delivery|cod|ক্যাশ অন|বিকাশ|নগদ|কার্ড|card/i],
  contact: [/contact|যোগাযোগ|whatsapp|হোয়াটসঅ্যাপ|phone number|নাম্বার|নম্বর|support|সাপোর্ট/i],
  address: [/address|ঠিকানা|কোথায়|লোকেশন|location/i],
  hours: [/সময়|hours|কখন খোলা|open|support.*time/i],
  size: [/size|সাইজ|মাপ|fit|ফিট|বড়|ছোট/i],
  color: [/color|colour|কালার|রং|রঙ/i],
  stock: [/stock|স্টক|available|অ্যাভেইলেবল|আছে কি|আছে|শেষ হয়ে/i],
  price: [/price|দাম|কত|টাকা|৳|tk|taka|budget|বাজেট|under|within|মধ্যে/i],
  product: [/product|products|পণ্য|collection|কলেকশন|three.?piece|থ্রি.?পিস|dress|ড্রেস|fabric|কাপড়|কটন|cotton|silk|chiffon|lawn|georgette|embroidered|printed|party/i],
  store: [/about|কে তোমরা|তোমাদের|store|shop|দোকান|R TEX|rtex/i],
  human: [/মানুষের সাথে|human|agent|ম্যানেজার|কাস্টমার কেয়ার|customer care|representative|মানুষের সাথে কথা/i]
};
const COLORS = [
  ['black',['black','কালো','কালা']],['white',['white','সাদা']],['red',['red','লাল']],['pink',['pink','গোলাপি','পিংক']],
  ['rose',['rose','রোজ']],['blue',['blue','নীল']],['green',['green','সবুজ']],['maroon',['maroon','মেরুন']],
  ['purple',['purple','বেগুনি']],['beige',['beige']],['cream',['cream','ক্রিম']],['yellow',['yellow','হলুদ']],['navy',['navy','নেভি']],['wine',['wine','ওয়াইন','ওয়াইন']]
];
const SIZES = ['xs','s','m','l','xl','xxl','2xl','3xl','free size','ফ্রি সাইজ'];
const SYNONYMS = new Map([
  ['three piece','three piece'],['3 piece','three piece'],['3pcs','three piece'],['থ্রিপিস','three piece'],['থ্রি পিস','three piece'],
  ['কটন','cotton'],['সিল্ক','silk'],['জর্জেট','georgette'],['শিফন','chiffon'],['লন','lawn'],['এমব্রয়ডারি','embroidered'],['এম্ব্রয়ডারি','embroidered'],['প্রিন্টেড','printed'],['পার্টি','party'],
  ['কালা','black'],['কালো','black'],['লাল','red'],['গোলাপি','pink'],['পিংক','pink'],['সাদা','white'],['নীল','blue'],['সবুজ','green'],['মেরুন','maroon'],['বেগুনি','purple']
]);
function chatNorm(v='') {
  let t=String(v).toLowerCase().replace(/[০-৯]/g,d=>'০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/[৳,]/g,'').replace(/\s+/g,' ').trim();
  for(const [a,b] of SYNONYMS) t=t.replaceAll(a,b);
  return t;
}
function chatIntent(text) {
  const score={};
  for(const [name,patterns] of Object.entries(CHAT)) score[name]=patterns.reduce((n,p)=>n+(p.test(text)?1:0),0);
  const ranked=Object.entries(score).sort((a,b)=>b[1]-a[1]);
  return ranked[0]?.[1]>0?ranked[0][0]:'unknown';
}
function extractBudget(text) {
  const t=chatNorm(text);
  const nums=[...t.matchAll(/(?:under|within|below|max|maximum|budget|বাজেট|মধ্যে|এর মধ্যে|নিচে|সর্বোচ্চ)\s*(?:tk|taka|টাকা)?\s*(\d{3,6})/gi),...t.matchAll(/(?:৳|tk|taka|টাকা)\s*(\d{3,6})/gi),...t.matchAll(/(\d{3,6})\s*(?:tk|taka|টাকা|৳)/gi)];
  return nums.length?Number(nums[0][1]):null;
}
function extractSize(text) {
  const t=chatNorm(text);
  for(const x of SIZES){ const re=new RegExp('(^|\\s)'+x.replace(/ /g,'\\s+')+'($|\\s|,|\\.|\\?)','i'); if(re.test(t)) return x; }
  return null;
}
function extractColor(text) { const t=chatNorm(text); for(const [key,words] of COLORS) if(words.some(w=>t.includes(w))) return key; return null; }
function words(v) { return chatNorm(v).split(/[^a-z0-9\u0980-\u09ff]+/).filter(x=>x.length>1); }
function productScore(p,text,budget,size,color) {
  const t=chatNorm(text), name=chatNorm(p.name), desc=chatNorm(p.description), cat=chatNorm(p.category_name||''); let score=0;
  for(const w of words(t)){if(name.includes(w))score+=10;if(cat.includes(w))score+=7;if(desc.includes(w))score+=3;}
  if(budget){if(Number(p.price)<=budget)score+=9;else score-=Math.min(10,Math.ceil((Number(p.price)-budget)/400));}
  if(size&&p.variants.some(v=>chatNorm(v.size)===size&&Number(v.stock)>0))score+=8;
  if(color&&p.variants.some(v=>chatNorm(v.color).includes(color)&&Number(v.stock)>0))score+=8;
  if(p.featured)score+=2; return score;
}
function rankProducts(products,text,{budget=null,size=null,color=null,limit=6}={}) {
  const scored=products.map(p=>({...p,_score:productScore(p,text,budget,size,color)}));
  const useful=scored.filter(p=>p._score>0);
  return useful.sort((a,b)=>b._score-a._score||a.price-b.price).slice(0,limit);
}
function stockFor(p,{size=null,color=null}={}) { const vs=p.variants.filter(v=>(!size||chatNorm(v.size)===size)&&(!color||chatNorm(v.color).includes(color))); return {variants:vs,total:vs.reduce((n,v)=>n+Number(v.stock||0),0)}; }
function moneyBDT(n){return `৳${Number(n||0).toLocaleString('en-BD')}`;}
function availableSizes(p){return [...new Set(p.variants.filter(v=>Number(v.stock)>0).map(v=>v.size).filter(Boolean))];}
function availableColors(p){return [...new Set(p.variants.filter(v=>Number(v.stock)>0).map(v=>v.color).filter(Boolean))];}
function productSummary(p,{size=null,color=null}={}) {
  const st=stockFor(p,{size,color}), sizes=availableSizes(p), colors=availableColors(p);
  return `${p.name} — ${moneyBDT(p.price)}${p.compare_price>p.price?` (আগে ${moneyBDT(p.compare_price)})`:''}. ${st.total?'এখন available':'এই selection-এ stock নেই'}. Size: ${sizes.join(', ')||'নেই'}; Color: ${colors.join(', ')||'নেই'}.`;
}
function findReferencedProduct(products,message,history) {
  const corpus=[message,...history.slice(-8).map(x=>String(x?.content||''))].join(' '), t=chatNorm(corpus);
  let best=null,bestScore=0;
  for(const p of products){let s=0;for(const w of words(p.name))if(t.includes(w))s+=2;if(t.includes(chatNorm(p.name)))s+=10;if(s>bestScore){bestScore=s;best=p;}}
  return bestScore>0?best:null;
}
function conversationState(history=[],products=[]) {
  const recent=history.slice(-10).map(x=>String(x?.content||'')).join(' ');
  const ref=findReferencedProduct(products,'',history);
  return {budget:extractBudget(recent),size:extractSize(recent),color:extractColor(recent),product:ref};
}
function humanReply(text){
  return String(text).replace(/\n{3,}/g,'\n\n').trim();
}
export function answerFromCatalog(context,message,history=[]) {
  const text=chatNorm(message),intent=chatIntent(text),products=context.products,s=context.settings,state=conversationState(history,products);
  const budget=extractBudget(text)??state.budget,size=extractSize(text)??state.size,color=extractColor(text)??state.color;
  const referenced=state.product;
  let matches=rankProducts(products,message,{budget,size,color});
  if(!matches.length&&referenced)matches=[referenced];
  const first=matches[0];

  if(intent==='greeting') return {reply:'হ্যালো! 👋 R TEX BD-তে আপনাকে স্বাগতম। কী ধরনের three-piece খুঁজছেন? Fabric, budget, size বা color—যেটা জানেন সেটাই বলুন, আমি সেখান থেকে help করছি।',products:[]};
  if(intent==='thanks') return {reply:'আপনাকেও ধন্যবাদ 😊 ভালো লাগলে নিশ্চিন্তে বলুন—আরেকটু budget/size/color দিলে আমি আরও ভালোভাবে মিলিয়ে দিতে পারি।',products:[]};
  if(intent==='bye') return {reply:'আল্লাহ হাফেজ 🌸 R TEX BD-তে আবার আসবেন। ভালো থাকবেন!',products:[]};
  if(intent==='help') return {reply:'অবশ্যই। আমি product খুঁজে দিতে, budget অনুযায়ী সাজেস্ট করতে, size/color/stock জানতে, delivery charge/time বলতে, order করার নিয়ম বুঝাতে এবং order status দেখতে সাহায্য করতে পারি।',products:[]};
  if(intent==='human') return {reply:`অবশ্যই। সরাসরি support-এর জন্য WhatsApp করুন ${s.phone} নম্বরে। চাইলে এখানেও আপনার সমস্যাটা লিখুন—আমি যতটা পারি এখনই help করছি।`,products:[]};
  if(intent==='delivery') return {reply:`Delivery charge বর্তমানে Inside Bangladesh ${moneyBDT(s.delivery_inside||80)} এবং Outside ${moneyBDT(s.delivery_outside||130)}। Checkout-এ আপনার zone select করলে charge automatically যোগ হবে।`,products:[]};
  if(intent==='deliveryTime') return {reply:'Delivery time এলাকা ও courier-এর ওপর নির্ভর করে। আপনার area/জেলা বললে support-এর জন্য আরও নির্দিষ্টভাবে guide করতে পারি।',products:[]};
  if(intent==='payment') return {reply:'বর্তমানে checkout-এ Cash on Delivery available। Order place করার সময় প্রয়োজনীয় customer ও delivery information দিন; final payment/order details checkout-এই দেখাবে।',products:[]};
  if(intent==='orderHow') return {reply:'অবশ্যই 😊 Product পছন্দ করুন → size/color select করুন → Add to Cart → Checkout → নাম, ফোন ও ঠিকানা দিন → Place Order। Order সফল হলে একটি RTX order number পাবেন।',products:matches.slice(0,3)};
  if(intent==='return') return {reply:'Return/Exchange-এর ক্ষেত্রে order number এবং সমস্যাটা লিখুন। আমি available store policy অনুযায়ী পরের step বুঝিয়ে দেব।',products:[]};
  if(intent==='contact') return {reply:`R TEX BD support WhatsApp: ${s.phone}। Header-এর WhatsApp button দিয়েও সরাসরি message করতে পারবেন।`,products:[]};
  if(intent==='address') return {reply:`Store contact/address: ${s.address||'Bangladesh'}। আরও নির্দিষ্ট location দরকার হলে WhatsApp support-এ message করতে পারেন।`,products:[]};
  if(intent==='hours') return {reply:`Support hours: ${s.support_hours||'Contact support for current availability'}.`,products:[]};
  if(intent==='track'||intent==='cancel') return {reply:'Order numberটা লিখুন—যেমন RTX-XXXX-XXXX। আমি database থেকে current status check করতে পারব।',products:[]};
  if(intent==='store') return {reply:`${s.store_name||'R TEX BD'} হলো ${s.tagline||'Women’s Three-Piece Collection'}-কেন্দ্রিক online store। Product selection থেকে ordering ও delivery information পর্যন্ত আমি help করতে পারি।`,products:[]};

  if(referenced&&(intent==='size'||intent==='color'||intent==='stock')){
    const sizes=availableSizes(referenced),colors=availableColors(referenced),st=stockFor(referenced,{size,color});
    if(intent==='size')return {reply:`হ্যাঁ, ${referenced.name}-এর available size হলো ${sizes.join(', ')||'এই মুহূর্তে কোনো size available নেই'}। ${color?`${color} color-এর জন্যও আমি stock filter করেছি।`:''}`,products:[referenced]};
    if(intent==='color')return {reply:`${referenced.name}-এর available color: ${colors.join(', ')||'এই মুহূর্তে কোনো color available নেই'}। কোন colorটা চান বললে stock-ও মিলিয়ে দেব।`,products:[referenced]};
    return {reply:`${referenced.name}${size?` (${size.toUpperCase()})`:''}${color?` ${color}`:''}-এর ${st.total?'stock available আছে':'এই selection-এ stock নেই'}। চাইলে আমি অন্য available option-ও দেখাতে পারি।`,products:[referenced]};
  }
  if((intent==='recommendation'||intent==='price'||intent==='product'||intent==='size'||intent==='color'||intent==='stock'||first)&&matches.length){
    const list=matches.slice(0,4),lines=list.map((p,i)=>`${i+1}. ${productSummary(p,{size,color})}`);
    let lead=budget?`আপনার ${moneyBDT(budget)} budget-এর মধ্যে `:'আপনার কথার ভিত্তিতে ';
    if(size)lead+=`${size.toUpperCase()} size-এর `;if(color)lead+=`${color} color-এর `;
    return {reply:humanReply(`${lead}কাছাকাছি এইগুলো পেলাম:\n${lines.join('\n')}\n\nএর মধ্যে কোন styleটা ভালো লাগছে বলুন—আমি সেটার size, color আর stock দেখে next step বলে দিচ্ছি।`),products:list};
  }
  if((intent==='size'||intent==='color'||intent==='stock')&&!referenced)return {reply:'অবশ্যই—কোন product-এর কথা বলছেন? নামটা লিখুন, যেমন “Premium Silk Three Piece-এর L size আছে?” তাহলে নির্দিষ্ট করে live stock দেখব।',products:[]};
  if(budget&&!matches.length)return {reply:`আপনার ${moneyBDT(budget)} budget বুঝেছি। এই মুহূর্তে exact match পাইনি। চাইলে budget একটু বাড়িয়ে দিতে পারেন, অথবা cotton/lawn/georgette-এর মতো fabric preference বলুন—তাহলে closest option খুঁজে দেব।`,products:[]};
  return {reply:'আপনার কথাটা পুরোপুরি match করতে পারিনি। আপনি চাইলে এভাবে বলুন—“৳3000-এর মধ্যে pink three-piece দেখাও”, “এইটার L size আছে?”, বা “আমার order RTX-… কোথায়?”—আমি সেখান থেকে handle করব।',products:[]};
}


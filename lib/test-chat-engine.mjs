import { answerFromCatalog } from '../lib/chat-engine.mjs';
const context={
  settings:{store_name:'R TEX BD',tagline:'Women’s Three-Piece Collection',phone:'01629380347',whatsapp:'8801629380347',delivery_inside:'80',delivery_outside:'130',address:'Bangladesh'},
  products:[
    {id:1,name:'Premium Silk Three Piece',slug:'premium-silk',description:'Rich silk texture for festive wear.',price:3490,compare_price:3990,featured:1,category_name:'Silk Three Piece',variants:[{size:'M',color:'Rose',stock:10},{size:'L',color:'Rose',stock:8},{size:'XL',color:'Black',stock:4}]},
    {id:2,name:'Luxury Cotton Three Piece',slug:'luxury-cotton',description:'Soft cotton for everyday wear.',price:2890,compare_price:3400,featured:1,category_name:'Cotton Three Piece',variants:[{size:'M',color:'Black',stock:9},{size:'L',color:'Rose',stock:6}]}
  ]
};
const cases=[
  ['hello','greeting'],['৳3000 এর মধ্যে pink three piece দেখাও','recommendation'],['Premium Silk Three Piece-এর L size আছে?','size'],['delivery charge কত?','delivery'],['how do I order','orderHow'],['thanks','thanks']
];
for(const [message,label] of cases){const r=answerFromCatalog(context,message,[]);if(!r?.reply)throw new Error(`No reply for ${label}`);console.log(label,'OK ->',r.reply.split('\n')[0]);}
const follow=answerFromCatalog(context,'এইটার L size আছে?', [{role:'user',content:'Premium Silk Three Piece চাই'}]);
if(!follow.reply.includes('available size')) throw new Error('Follow-up product context failed');
console.log('follow-up context OK');

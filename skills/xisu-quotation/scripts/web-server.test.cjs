'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createServer,variants,calculate}=require('./web-server.cjs');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/parameters.reference.json'),'utf8'));
const sample=JSON.parse(fs.readFileSync(path.join(__dirname,'order.sample.json'),'utf8'));
const {quote}=require('./quote.cjs');
(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const opts=await fetch(origin+'/api/options');assert.equal(opts.status,200);const catalog=(await opts.json()).variants;assert.equal(catalog.length,28);
  assert.ok(!JSON.stringify(catalog).includes('price_per_kg'));
  const v=(material,color)=>catalog.find(x=>x.material===material&&x.color===color).variantId;
  const base={variantId:v('PET透明','透明'),length:7.2,width:7.7,height:3.6,quantity:240000,dimensionUnit:'cm',moldType:'male',shape:'rectangle',thicknessMm:.8};
  const req=async(payload, headers={})=>fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
  let res=await req(base);assert.equal(res.status,200);let out=await res.json();assert.equal(out.untaxedUnitPrice,.1305);assert.equal(out.referenceUnitPrice,.141);assert.equal(out.total,33840);assert.equal(out.thicknessSource,'measured');assert.equal(out.referenceUnitPrice,quote(sample,config).taxed_unit);
  assert.deepEqual(Object.keys(out).sort(), ['referenceUnitPrice','untaxedUnitPrice','total','quantity','currency','taxIncluded','thicknessSource','reference','notes','exclusions'].sort());
  const mm={...base,length:72,width:77,height:36,dimensionUnit:'mm'};assert.deepEqual(await (await req(mm)).json(),out);
  const guessed=await(await req({...base,thicknessMm:undefined})).json();assert.equal(guessed.thicknessSource,'height_estimate');assert.match(guessed.notes.join(''),/高度/);
  const byWeight=await(await req({...base,thicknessMm:undefined,weightG:11.2,length:20,width:10,height:2,quantity:10000})).json();assert.equal(byWeight.thicknessSource,'weight_estimate');
  for(const color of ['白色','黑色','彩色']){res=await req({...base,variantId:v('PET植绒',color),thicknessMm:.4});assert.equal(res.status,200);const r=await res.json();assert.equal(r.thicknessSource,'measured');assert.ok(r.referenceUnitPrice>0);assert.deepEqual(Object.keys(r).sort(),Object.keys(out).sort());}
  res=await req({...base,variantId:v('PET植绒','白色'),thicknessMm:undefined,weightG:15});assert.equal(res.status,422);
  res=await req({...base,variantId:v('植布','白色'),length:35,width:15,height:1,quantity:10000,moldType:'female',thicknessMm:undefined});out=await res.json();assert.equal(out.referenceUnitPrice,1.5213);assert.equal(out.thicknessSource,'not_required');
  for(const payload of [{...base,quantity:0},{...base,quantity:1.5},{...base,thicknessMm:-1},{...base,variantId:'unknown'},{...base,shape:'invalid'},{...base,price:0},{...base,length:'Infinity'}])assert.ok((await req(payload)).status>=400);
  assert.equal((await req(base,{Origin:'https://attacker.invalid'})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const r=require('node:http').request(origin+'/api/options',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode)});r.on('error',reject);r.end()});assert.equal(wrongHost,403);
  for(const p of ['/scripts/quote.cjs','/assets/parameters.reference.json','/%2e%2e%2fscripts%2fquote.cjs','/server.cjs'])assert.equal((await fetch(origin+p)).status,404);
  assert.equal((await fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(9000)})).status,413);
  const original=config.materials.find(x=>x.material==='PET透明'&&x.color==='透明').price_per_kg;
  const changed=structuredClone(config);changed.materials.find(x=>x.material==='PET透明'&&x.color==='透明').price_per_kg=original+1;
  const outfile=path.join(os.tmpdir(),'xisu-config-'+process.pid+'-'+Date.now()+'.json');fs.writeFileSync(outfile,JSON.stringify(changed));
  const custom=createServer({configPath:outfile});await new Promise(resolve=>custom.listen(0,'127.0.0.1',resolve));
  try{res=await fetch('http://127.0.0.1:'+custom.address().port+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base)});assert.equal(res.status,200);const result=await res.json();assert.ok(result.referenceUnitPrice>.141);}finally{await new Promise(resolve=>custom.close(resolve));fs.unlinkSync(outfile);}
  assert.equal(calculate(base,config).referenceUnitPrice,.141);assert.equal(variants(config).length,28);
  console.log('PASS local quote HTTP: 28 materials, PET, all flocked colors, cloth, height/weight, matching CLI, external origin/host, private paths, invalid input, custom configuration');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createServer,variants,calculate}=require('./web-server.cjs');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/parameters.reference.json'),'utf8'));
const sample=JSON.parse(fs.readFileSync(path.join(__dirname,'order.sample.json'),'utf8'));
const {quote}=require('./quote.cjs');
const PASSWORD='test-only-gate';
async function login(origin){
 const res=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:PASSWORD})});
 assert.equal(res.status,200);
 return res.headers.get('set-cookie').split(';')[0];
}
(async()=>{
 const server=createServer({password:PASSWORD});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const gate=await fetch(origin+'/');assert.equal(gate.status,200);const gateHtml=await gate.text();assert.match(gateHtml,/内部口令/);assert.doesNotMatch(gateHtml,/id="variant"/);
  assert.equal((await fetch(origin+'/api/options')).status,401);
  assert.equal((await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})})).status,401);
  const cookie=await login(origin);
  const opts=await fetch(origin+'/api/options',{headers:{Cookie:cookie}});assert.equal(opts.status,200);const catalog=(await opts.json()).variants;assert.equal(catalog.length,28);
  assert.ok(!JSON.stringify(catalog).includes('price_per_kg'));
  const v=(material,color)=>catalog.find(x=>x.material===material&&x.color===color).variantId;
  const base={variantId:v('PET透明','透明'),length:7.2,width:7.7,height:3.6,quantity:240000,dimensionUnit:'cm',moldType:'male',shape:'rectangle',thicknessMm:.8};
  const req=async(payload, headers={})=>fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(payload)});
  let res=await req(base);assert.equal(res.status,200);let out=await res.json();assert.equal(out.untaxedUnitPrice,.1305);assert.equal(out.referenceUnitPrice,.1436);assert.equal(out.total,34464);assert.equal(out.thicknessSource,'measured');assert.equal(out.thicknessMm,.8);assert.equal(out.referenceUnitPrice,quote(sample,config).taxed_unit);
  assert.deepEqual(Object.keys(out).sort(), ['referenceUnitPrice','untaxedUnitPrice','total','untaxedTotal','quotedTotal','quantity','currency','taxIncluded','thicknessSource','thicknessMm','reviewLabel','assumptions','moldType','moldDefaulted','layout','perSheet','perPiece','reference','notes','exclusions'].sort());
  assert.equal(out.reviewLabel,null);assert.equal(out.layout.theoreticalCavities,out.layout.adoptedCavities);assert.ok(out.perSheet.processingCost>0);assert.equal(out.perPiece.taxedUnit,out.referenceUnitPrice);
  const mm={...base,length:72,width:77,height:36,dimensionUnit:'mm'};assert.deepEqual(await (await req(mm)).json(),out);
  const guessed=await(await req({...base,thicknessMm:undefined})).json();assert.equal(guessed.thicknessSource,'height_estimate');assert.equal(guessed.thicknessMm,.35);assert.equal(guessed.reviewLabel,'初步报价、待复核');assert.match(guessed.notes.join(''),/高度/);
  const petWhite=await(await req({...base,variantId:v('PET','白色'),length:17.5,width:7.5,height:4,quantity:10000,thicknessMm:.4})).json();assert.equal(petWhite.referenceUnitPrice,.2184);assert.equal(petWhite.untaxedUnitPrice,.1985);assert.equal(petWhite.total,2184);assert.equal(petWhite.layout.adoptedCavities,30);assert.equal(petWhite.layout.orientation,'原方向');assert.equal(petWhite.perSheet.processingCost,1.4);assert.equal(petWhite.perSheet.smallOrderFee,500);
  const byWeight=await(await req({...base,thicknessMm:undefined,weightG:11.2,length:20,width:10,height:2,quantity:10000})).json();assert.equal(byWeight.thicknessSource,'weight_estimate');assert.equal(byWeight.thicknessMm,.4);
  for(const color of ['白色','黑色','彩色']){res=await req({...base,variantId:v('PET植绒',color),thicknessMm:.4});assert.equal(res.status,200);const r=await res.json();assert.equal(r.thicknessSource,'measured');assert.ok(r.referenceUnitPrice>0);const m=config.materials.find(x=>x.material==='PET植绒'&&x.color===color);assert.equal(r.flockPricePerKg,m.price_per_kg);assert.equal(r.flockDensity,m.density_g_cm3);}
  res=await req({...base,variantId:v('PET植绒','白色'),thicknessMm:undefined,weightG:15});assert.equal(res.status,422);
  res=await req({...base,variantId:v('植布','白色'),length:35,width:15,height:1,quantity:10000,moldType:'female',thicknessMm:undefined});out=await res.json();assert.equal(out.referenceUnitPrice,1.5495);assert.equal(out.thicknessSource,'not_required');assert.equal(out.thicknessMm,null);
  for(const payload of [{...base,quantity:0},{...base,quantity:1.5},{...base,thicknessMm:-1},{...base,variantId:'unknown'},{...base,shape:'invalid'},{...base,price:0},{...base,cavityCount:10},{...base,length:'Infinity'}])assert.ok((await req(payload)).status>=400);
  assert.equal((await req(base,{Origin:'https://attacker.invalid'})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const r=require('node:http').request(origin+'/api/options',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode)});r.on('error',reject);r.end()});assert.equal(wrongHost,403);
  for(const p of ['/scripts/quote.cjs','/assets/parameters.reference.json','/%2e%2e%2fscripts%2fquote.cjs','/server.cjs']){assert.equal((await fetch(origin+p)).status,401);assert.equal((await fetch(origin+p,{headers:{Cookie:cookie}})).status,404);}
  assert.equal((await fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,401);
  assert.equal((await fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'text/plain',Cookie:cookie},body:'{}'})).status,415);
  assert.equal((await fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{'})).status,400);
  assert.equal((await fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'x'.repeat(9000)})).status,413);
  const original=config.materials.find(x=>x.material==='PET透明'&&x.color==='透明').price_per_kg;
  const changed=structuredClone(config);changed.materials.find(x=>x.material==='PET透明'&&x.color==='透明').price_per_kg=original+1;
  const outfile=path.join(os.tmpdir(),'xisu-config-'+process.pid+'-'+Date.now()+'.json');fs.writeFileSync(outfile,JSON.stringify(changed));
  const custom=createServer({configPath:outfile,password:PASSWORD});await new Promise(resolve=>custom.listen(0,'127.0.0.1',resolve));
  try{const customOrigin='http://127.0.0.1:'+custom.address().port;const customCookie=await login(customOrigin);res=await fetch(customOrigin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json',Cookie:customCookie},body:JSON.stringify(base)});assert.equal(res.status,200);const result=await res.json();assert.ok(result.referenceUnitPrice>.1436);}finally{await new Promise(resolve=>custom.close(resolve));fs.unlinkSync(outfile);}
  const locked=createServer({password:''});await new Promise(resolve=>locked.listen(0,'127.0.0.1',resolve));
  try{assert.equal((await fetch('http://127.0.0.1:'+locked.address().port+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,503);}finally{await new Promise(resolve=>locked.close(resolve));}
  assert.equal((await calculate(base,config)).referenceUnitPrice,.1436);assert.equal(variants(config).length,28);
  console.log('PASS local quote HTTP: 28 materials, PET, all flocked colors, cloth, height/weight, matching CLI, external origin/host, private paths, invalid input, custom configuration');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});

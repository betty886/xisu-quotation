'use strict';
// Mock-only integration test. Values are synthetic and do not represent factory parameters.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {quote,quoteWithFlockWeight}=require('./quote.cjs');
const {resolveThickness}=require('./flock-thickness-client.cjs');
const {createServer,variants}=require('./web-server.cjs');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/parameters.reference.json'),'utf8'));
const start=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const stop=s=>{s.closeAllConnections();return new Promise(r=>s.close(r));};
(async()=>{
 const seen=[];let fail=false;
 const mock=http.createServer((req,res)=>{let raw='';req.on('data',x=>raw+=x);req.on('end',()=>{seen.push(JSON.parse(raw));res.setHeader('Content-Type','application/json');if(fail){res.writeHead(503);return res.end('{}');}res.end(JSON.stringify({thicknessMm:seen.at(-1).weightBasis==='finished'?.34:.56}));});});await start(mock);
 const endpoint=`http://127.0.0.1:${mock.address().port}/api/flock-thickness`;
 const server=createServer({resolveThickness:input=>resolveThickness(input,endpoint)});await start(server);
 const origin=`http://127.0.0.1:${server.address().port}`;
 const variantId=variants(config).find(v=>v.material==='PET植绒'&&v.color==='白色').variantId;
 const input={variantId,shape:'rectangle',length:20,width:10,height:2,dimensionUnit:'cm',quantity:10000,moldType:'male',weightG:15};
 const order={material:'PET植绒',color:'白色',shape:'rectangle',length_cm:20,width_cm:10,height_cm:2,quantity:10000,mold_type:'male',weight_g:15};
 const post=data=>fetch(origin+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const fixture=path.join(os.tmpdir(),`xisu-flock-test-${process.pid}.json`);
 try{
  for(const basis of ['finished','substrate']){
   const thickness=basis==='finished'?.34:.56;
   const res=await post({...input,weightBasis:basis});assert.equal(res.status,200);const out=await res.json();
   const expected=quote({...order,measured_thickness_mm:thickness},config);
   assert.equal(out.thicknessSource,'weight_estimate');assert.equal(out.thicknessMm,thickness);assert.equal(out.referenceUnitPrice,expected.taxed_unit);assert.equal(out.untaxedUnitPrice,expected.untaxed_unit);
   assert.equal(seen.at(-1).weightBasis,basis);assert.deepEqual(Object.keys(seen.at(-1)).sort(),['material','color','shape','length','width','dimensionUnit','weightG','weightBasis'].sort());
   fs.writeFileSync(fixture,JSON.stringify({...order,weight_basis:basis}));
   const result=await promisify(execFile)(process.execPath,[path.join(__dirname,'quote.cjs'),fixture],{env:{...process.env,XISU_FLOCK_THICKNESS_URL:endpoint}});
   const cli=JSON.parse(result.stdout);assert.equal(cli.status,'pending_review');assert.equal(cli.calculation.thicknessMm,thickness);assert.equal(cli.taxed_unit,expected.taxed_unit);
  }
  const count=seen.length;await quoteWithFlockWeight({...order,measured_thickness_mm:.6},config,{resolveThickness:()=>{throw Error('unexpected network');}});assert.equal(seen.length,count);
  const missing=await post(input);assert.equal(missing.status,422);assert.match((await missing.json()).error.message,/称重阶段/);
  fail=true;const broken=await post({...input,weightBasis:'finished'});assert.equal(broken.status,422);assert.match((await broken.json()).error.message,/不可用/);
  await assert.rejects(quoteWithFlockWeight({...order,weight_basis:'finished'},config,{resolveThickness:input=>resolveThickness(input,endpoint)}),/不可用/);
  const normal=await post({...input,variantId:variants(config).find(v=>v.material==='PET透明').variantId});assert.equal(normal.status,200);
  console.log('PASS 植绒两种克重口径、HTTP与CLI、调用字段、服务故障阻断、实测厚度与普通材料');
 }finally{if(fs.existsSync(fixture))fs.unlinkSync(fixture);await stop(server);await stop(mock);}
})().catch(e=>{console.error(e);process.exitCode=1;});

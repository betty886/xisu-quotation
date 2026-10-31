'use strict';
const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const {quote,quoteWithFlockWeight}=require('./quote.cjs');const config=require('../assets/parameters.reference.json');
const order={material:'PET植绒',color:'白色',shape:'rectangle',length_cm:20,width_cm:10,height_cm:2,quantity:10000,mold_type:'male'};
const flock=config.materials.find(m=>m.material==='PET植绒'&&m.color==='白色');
(async()=>{
 const originalFetch=global.fetch;global.fetch=()=>{throw Error('network forbidden')};
 try{
  for(const t of [.2,.4,.8]){const x=await quoteWithFlockWeight({...order,measured_thickness_mm:t},config);assert.equal(x.calculation.materialPrice,flock.price_per_kg);assert.equal(x.calculation.density,flock.density_g_cm3);assert.equal(x.calculation.thicknessMm,t);}
  const finished=await quoteWithFlockWeight({...order,weight_g:15,weight_basis:'finished'},config);assert.equal(finished.status,'pending_review');assert.ok(Math.abs(finished.calculation.thicknessMm-150/(200*flock.density_g_cm3))<1e-12);assert.equal(finished.calculation.thicknessSource,'flock_finished_equivalent');assert.match(finished.assumptions.join(''),/不是裸基材厚度/);
  const substrate=quote({...order,weight_g:15,weight_basis:'substrate'},config);assert.ok(Math.abs(substrate.calculation.thicknessMm-150/(200*1.4))<1e-12);assert.equal(substrate.calculation.thicknessSource,'flock_substrate_estimate');
  const custom=structuredClone(config),m=custom.materials.find(x=>x.material==='PET植绒'&&x.color==='白色');m.price_per_kg=123;m.density_g_cm3=1.6;const customOut=quote({...order,weight_g:15,weight_basis:'finished'},custom);assert.equal(customOut.calculation.materialPrice,123);assert.equal(customOut.calculation.density,1.6);assert.ok(Math.abs(customOut.calculation.thicknessMm-150/(200*1.6))<1e-12);
  const circle=quote({...order,shape:'circle',length_cm:20,width_cm:undefined,weight_g:15,weight_basis:'finished'},config);assert.ok(Math.abs(circle.calculation.thicknessMm-150/(Math.PI*100*flock.density_g_cm3))<1e-12);
  assert.throws(()=>quote({...order,weight_g:15},config),/称重阶段|确认克重/);assert.throws(()=>quote({...order,weight_g:0,weight_basis:'finished'},config),/正数/);
  const height=quote(order,config);assert.equal(height.calculation.thicknessSource,'heightReference');
  const cli=spawnSync(process.execPath,['-e',`global.fetch=()=>{throw Error('network forbidden')};const {quoteWithFlockWeight}=require('./scripts/quote.cjs');const c=require('./assets/parameters.reference.json');quoteWithFlockWeight(${JSON.stringify({...order,weight_g:15,weight_basis:'finished'})},c).then(x=>{if(x.status!=='pending_review'||x.calculation.thicknessSource!=='flock_finished_equivalent')process.exit(2);}).catch(()=>process.exit(1))`],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);
  console.log('PASS 植绒固定参考参数、两种克重口径、形状、自定义配置、CLI及离线核算');
 }finally{global.fetch=originalFetch;}
})().catch(e=>{console.error(e);process.exitCode=1});

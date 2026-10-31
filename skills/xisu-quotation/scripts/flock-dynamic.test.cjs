'use strict';
// Synthetic response values only.
const assert=require('node:assert/strict');const {quote,quoteWithFlockWeight}=require('./quote.cjs');const config=require('../assets/parameters.reference.json');
const order={material:'PET植绒',color:'白色',shape:'rectangle',length_cm:20,width_cm:10,height_cm:2,quantity:10000,mold_type:'male'};
(async()=>{
 let calls=[];const opts={resolveThickness:async x=>{calls.push(['weight',x]);return .49404761904761907;},resolveParameters:async x=>{calls.push(['params',x]);return {pricePerKg:x.thicknessMm<.4?8:9,density:x.thicknessMm<.4?1.5:1.6};}};
 const measured=await quoteWithFlockWeight({...order,measured_thickness_mm:.4},config,opts);assert.equal(measured.calculation.materialPrice,9);assert.equal(measured.calculation.density,1.6);assert.equal(calls.at(-1)[1].thicknessMm,.4);
 const estimated=await quoteWithFlockWeight({...order,weight_g:15,weight_basis:'finished'},config,opts);assert.equal(estimated.calculation.thicknessMm,.49404761904761907);assert.equal(calls.at(-1)[1].thicknessMm,.49404761904761907);assert.equal(estimated.calculation.thicknessSource,'equivalent');assert.match(estimated.assumptions.join(''),/反推/);
 const height=await quoteWithFlockWeight(order,config,opts);assert.equal(height.calculation.thicknessMm,.2);assert.equal(height.calculation.thicknessSource,'heightReference');assert.equal(calls.at(-1)[1].thicknessMm,.2);assert.match(height.assumptions.join(''),/高度估算/);
 const custom=structuredClone(config), entry=custom.materials.find(m=>m.material===order.material&&m.color===order.color);entry.price_per_kg=123;entry.density_g_cm3=12;const k=await quoteWithFlockWeight({...order,measured_thickness_mm:.4},custom,opts);assert.equal(k.calculation.materialPrice,9);assert.equal(k.calculation.density,1.6);
 assert.throws(()=>quote({...order,measured_thickness_mm:.4},config),/异步/);
 await assert.rejects(quoteWithFlockWeight({...order,measured_thickness_mm:.4},config,{resolveParameters:async()=>{throw Error('服务不可用');}}),/服务不可用/);
 await assert.rejects(quoteWithFlockWeight({...order,measured_thickness_mm:.4},config,{resolveParameters:async()=>({pricePerKg:0,density:1.5})}),/无效/);
 let network=false;await quoteWithFlockWeight({...order,material:'PET透明',color:'透明',measured_thickness_mm:.4},config,{resolveParameters:()=>{network=true;throw Error('unexpected');}});assert.equal(network,false);
 console.log('PASS 植绒实测、精确克重、按高度、同步入口阻断、参数覆盖、服务故障与普通材料');
})().catch(e=>{console.error(e);process.exitCode=1});

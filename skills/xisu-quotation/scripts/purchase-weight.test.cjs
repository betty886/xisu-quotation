'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {quote}=require('./quote.cjs');
const config=require('../assets/parameters.reference.json');

const order={material:'PET',color:'彩色',length_cm:20,width_cm:10,height_cm:2,quantity:10000,mold_type:'female',measured_thickness_mm:.4};

test('the six colored materials use the correct purchase prices at both boundaries',()=>{
  const rates=[
    ['PET',[8.20,7.80,7.80,7.20]],
    ['普通PVC',[9.50,9.00,9.00,8.50]],
    ['PS',[10.50,10.00,10.00,9.50]],
    ['PET植绒',[11.43,11.03,11.03,10.43]],
    ['PVC植绒',[12.60,12.10,12.10,11.60]],
    ['PS植绒',[13.18,12.68,12.68,12.18]],
  ];
  for (const [material,expected] of rates) {
    const reference=config.materials.find(entry=>entry.material===material&&entry.color===order.color);
    const weights=[499.99,500,999.99,1000];
    for (const [index,weight] of weights.entries()) {
      const {calculation}=quote({...order,material,purchase_weight_kg:weight},config);
      assert.equal(calculation.procurement.weightSource,'actual');
      assert.equal(calculation.procurement.weightKg,weight);
      assert.equal(Number(calculation.materialPrice.toFixed(2)),expected[index],`${material} at ${weight} kg`);
      assert.equal(calculation.materialPrice,calculation.procurement.pricePerKg);
      assert.equal(calculation.density,reference.density_g_cm3);
      assert.ok(Math.abs(calculation.sheetMaterialCost-calculation.sheetAreaM2*.4*calculation.density*calculation.materialPrice)<1e-10);
      if (weight===1000) assert.equal(calculation.materialPrice,reference.price_per_kg);
    }
  }
});

test('empty weight uses the full production sheets after sizing the layout and still applies to both prices',()=>{
  const withRejects={...order,defect_rate:.02};
  const estimated=quote(withRejects,config);
  const calculation=estimated.calculation;
  const chosen=calculation.procurement;
  assert.equal(chosen.weightSource,'estimated');
  assert.ok(calculation.productionSheets>calculation.theoreticalSheets);
  assert.equal(chosen.weightKg,calculation.sheetAreaM2*.4*1.4*calculation.productionSheets);
  assert.equal(chosen.pricePerKg,8.2);
  assert.equal(estimated.review_label,'初步报价、待复核');

  const measured=quote({...withRejects,purchase_weight_kg:chosen.weightKg},config);
  const largeBatch=quote({...withRejects,purchase_weight_kg:1000},config);
  assert.equal(measured.untaxed_unit,estimated.untaxed_unit);
  assert.equal(measured.taxed_unit,estimated.taxed_unit);
  assert.ok(estimated.untaxed_unit>largeBatch.untaxed_unit);
  assert.ok(estimated.taxed_unit>largeBatch.taxed_unit);
});

test('black and white retain their existing prices and invalid weight is rejected for tiered colors',()=>{
  for (const material of ['PET','普通PVC','PS','PET植绒','PVC植绒','PS植绒']) {
    for (const color of ['白色','黑色']) {
      const oldPrice=config.materials.find(entry=>entry.material===material&&entry.color===color).price_per_kg;
      const {calculation}=quote({...order,material,color,purchase_weight_kg:10},config);
      assert.equal(calculation.procurement,undefined);
      assert.equal(calculation.materialPrice,oldPrice);
    }
  }
  for (const weight of [0,-1,false,[500],'invalid']) {
    assert.throws(()=>quote({...order,purchase_weight_kg:weight},config),/采购重量/);
  }
});

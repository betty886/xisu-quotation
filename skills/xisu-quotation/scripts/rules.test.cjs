'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {quote, heightEstimate} = require('./quote.cjs');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/parameters.reference.json'), 'utf8'));

const priceOf = (material, color) => {
  const row = config.materials.find(item => item.material === material && item.color === color);
  assert.ok(row, `${material}/${color} 不在参数表中`);
  return row;
};
const machineForColumns = columns => {
  const next = structuredClone(config);
  const pitch = 11;
  next.machine = {...next.machine, max_length_cm: 4 + pitch * columns, max_width_cm: 4 + pitch};
  return next;
};
const square = (columns, extra = {}) => quote({
  shape: 'rectangle', length_cm: 10, width_cm: 10, height_cm: 1, mold_type: 'female',
  material: 'PET', color: '白色', quantity: columns * 1000, measured_thickness_mm: 0.5, tax_included: true, ...extra
}, machineForColumns(columns));

const surcharges = [[10, 0], [11, 0.2], [25, 0.2], [26, 0.4], [36, 0.4], [37, 0.9], [50, 0.9], [51, 1.1], [70, 1.1], [71, 1.4], [100, 1.4]];
const bases = [
  ['普通PVC', '白色', 1.2],
  ['PS', '白色', 1],
  ['PS', '黑色', 1],
  ['PET', '白色', 1],
  ['PET', '黑色', 1],
  ['PP', '白色', 1],
  ['PP', '彩色', 1],
  ['PET透明', '透明', 0.6],
  ['PET植绒', '白色', 1.5],
  ['PVC植绒', '黑色', 1.5],
  ['PS植绒', '彩色', 1.5],
  ['触感PET', '黑色', 1.5],
  ['镀金PET', '彩色', 1.5]
];
for (const [material, color, base] of bases) {
  for (const [cavities, surcharge] of surcharges) {
    const result = square(cavities, {material, color, quantity: cavities * 100});
    assert.equal(result.status, 'pending_review', `${material} ${cavities} 穴应可报价`);
    assert.equal(result.calculation.adoptedCavities, cavities);
    assert.equal(result.calculation.sheetProcessingCost, Math.round((base + surcharge) * 1e10) / 1e10, `${material} ${cavities} 穴加工费`);
  }
  const first = square(1, {material, color, quantity: 100});
  assert.equal(first.calculation.adoptedCavities, 1);
  assert.equal(first.calculation.sheetProcessingCost, base);
}
const blockedTier = square(101, {quantity: 101});
assert.equal(blockedTier.status, 'blocked');
assert.match(blockedTier.errors.join(''), /加工费/);

const pvc30 = square(26, {material: '普通PVC', color: '白色'});
const pet30 = square(26, {material: 'PET', color: '白色'});
const ps30 = square(26, {material: 'PS', color: '白色'});
const pp30 = square(26, {material: 'PP', color: '白色'});
assert.ok(Math.abs(pvc30.calculation.sheetProcessingCost - pet30.calculation.sheetProcessingCost - 0.2) < 1e-9);
assert.equal(pet30.calculation.sheetProcessingCost, ps30.calculation.sheetProcessingCost);
assert.equal(pet30.calculation.sheetProcessingCost, pp30.calculation.sheetProcessingCost);
assert.equal(square(100, {material: 'PET植绒', color: '白色'}).calculation.sheetProcessingCost, 2.9);
assert.equal(square(10, {material: 'PET透明', color: '透明'}).calculation.sheetProcessingCost, 0.6);

for (const [quantity, fee] of [[4990, 500], [4999, 500], [5000, 300], [9990, 300], [9999, 300], [10000, 0]]) {
  const result = square(10, {quantity});
  assert.equal(result.calculation.smallOrderCount, quantity / 10);
  assert.equal(result.calculation.smallOrderFee, fee, `${quantity / 10} 张小单费`);
}
const withDefect = square(10, {quantity: 5000, defect_rate: 0.1});
assert.equal(withDefect.calculation.smallOrderCount, 500);
assert.ok(Math.abs(withDefect.calculation.theoreticalSheets - 500 / 0.9) < 1e-9);
assert.equal(withDefect.calculation.smallOrderFee, 300);

const whitePet = {
  shape: 'rectangle', length_cm: 17.5, width_cm: 7.5, height_cm: 4, mold_type: 'male',
  material: 'PET', color: '白色', quantity: 10000, measured_thickness_mm: 0.4, tax_included: true
};
const pet = quote(whitePet, config);
assert.equal(pet.status, 'pending_review');
assert.equal(pet.review_label, null);
assert.equal(pet.calculation.layout.orientation, '原方向');
assert.equal(pet.calculation.layout.cavities, 30);
assert.deepEqual(pet.calculation.alternatives.map(item => item.cavities), [30, 30]);
assert.ok(pet.calculation.alternatives[0].areaCm2 < pet.calculation.alternatives[1].areaCm2);
assert.deepEqual([pet.calculation.layout.sheetLengthCm, pet.calculation.layout.sheetWidthCm], [111.5, 73]);
assert.ok(pet.calculation.layout.sheetLengthCm <= 126 && pet.calculation.layout.sheetWidthCm <= 76);
assert.equal(pet.calculation.layout.edgeCm, 4);
assert.equal(pet.calculation.sheetProcessingCost, 1.4);
assert.equal(pet.calculation.smallOrderFee, 500);
assert.equal(pet.calculation.materialPrice, 6.7);
assert.equal(pet.calculation.density, 1.4);
assert.equal(config.minimum_margin_rate, 0);
assert.equal(pet.calculation.targetMargin, 0);
assert.equal(pet.calculation.minMargin, 0);
assert.equal(pet.calculation.materialTaxFactor, 1.08);
assert.equal(pet.calculation.taxFactor, 1.08);
assert.equal(pet.untaxed_unit, 0.1985);
assert.equal(pet.taxed_unit, 0.2144);
assert.equal(pet.untaxed_total, 1985);
assert.equal(pet.taxed_total, 2144);
assert.equal(pet.taxed_total, Math.round(pet.taxed_unit * whitePet.quantity * 100) / 100);
assert.equal(pet.untaxed_total, Math.round(pet.untaxed_unit * whitePet.quantity * 100) / 100);
const rawUntaxed = pet.calculation.pricedCostTotal / whitePet.quantity;
const rawTaxed = rawUntaxed * 1.08;
assert.ok(pet.untaxed_unit >= rawUntaxed);
assert.ok(pet.taxed_unit >= rawTaxed);
assert.ok(pet.untaxed_unit - rawUntaxed < 0.0001);
assert.equal(Math.round(pet.taxed_total * 100), pet.taxed_total * 100);

const untaxed = quote({...whitePet, tax_included: false}, config);
assert.equal(untaxed.calculation.taxFactor, 1);
assert.equal(untaxed.calculation.materialTaxFactor, 1.08);
assert.equal(untaxed.untaxed_unit, 0.1985);
assert.equal(untaxed.taxed_unit, 0.2144);
assert.equal(untaxed.selected, '未税');

let roundedUp = null;
for (let step = 1; step <= 4000 && !roundedUp; step++) {
  const candidate = quote({...whitePet, measured_thickness_mm: 0.2 + step / 10000}, config);
  const raw = candidate.calculation.pricedCostTotal / whitePet.quantity;
  const frac = raw * 10000 - Math.floor(raw * 10000 + 1e-8);
  if (frac > 1e-4 && frac < 0.5) roundedUp = {unit: candidate.untaxed_unit, raw};
}
assert.ok(roundedUp, '应找到一个需要向上而不是四舍五入的单价');
assert.equal(roundedUp.unit, Math.ceil(roundedUp.raw * 10000 - 1e-8) / 10000);
assert.notEqual(roundedUp.unit, Math.round(roundedUp.raw * 10000) / 10000);

const rotated = quote({
  shape: 'rectangle', length_cm: 20, width_cm: 8, height_cm: 2, mold_type: 'male',
  material: 'PET', color: '白色', quantity: 10000, measured_thickness_mm: 0.4, tax_included: true
}, config);
assert.equal(rotated.calculation.layout.orientation, '旋转90°');
assert.equal(rotated.calculation.layout.cavities, 36);
assert.ok(rotated.calculation.alternatives.some(item => item.orientation === '原方向' && item.cavities === 35));

const low = quote({...whitePet, height_cm: 1, mold_type: 'female', length_cm: 20, width_cm: 10}, config);
const high = quote({...whitePet, height_cm: 8, mold_type: 'female', length_cm: 20, width_cm: 10}, config);
assert.equal(low.calculation.layoutAllowanceCm, 1);
assert.equal(low.calculation.layoutAllowanceSource, 'bleed');
assert.deepEqual([low.calculation.layout.occupiedLengthCm, low.calculation.layout.occupiedWidthCm].sort((a, b) => a - b), [11, 21]);
assert.equal(low.calculation.layout.cavities, high.calculation.layout.cavities);
assert.equal(low.calculation.layout.sheetLengthCm, high.calculation.layout.sheetLengthCm);
assert.equal(low.calculation.layout.sheetWidthCm, high.calculation.layout.sheetWidthCm);
const maleLow = quote({...whitePet, height_cm: 1, mold_type: 'male', length_cm: 20, width_cm: 10}, config);
const maleHigh = quote({...whitePet, height_cm: 8, mold_type: 'male', length_cm: 20, width_cm: 10}, config);
assert.equal(maleLow.calculation.layoutAllowanceSource, 'height');
assert.equal(maleLow.calculation.layoutAllowanceCm, 1);
assert.equal(maleHigh.calculation.layoutAllowanceCm, 8);
assert.deepEqual([maleHigh.calculation.layout.occupiedLengthCm, maleHigh.calculation.layout.occupiedWidthCm].sort((a, b) => a - b), [18, 28]);
assert.notEqual(maleLow.calculation.layout.cavities, maleHigh.calculation.layout.cavities);

assert.equal(heightEstimate('PET', 10.75), 1.1);
assert.equal(heightEstimate('PET', 4.4), 0.45);
assert.equal(heightEstimate('PP', 4.5), 0.6);
assert.equal(heightEstimate('PS', 4.5), 0.55);
const estimated = quote({...whitePet, measured_thickness_mm: null, weight_g: null, height_cm: 10.75}, config);
assert.equal(estimated.calculation.thicknessMm, 1.1);
assert.equal(estimated.review_label, '初步报价、待复核');
assert.match(estimated.assumptions.join(''), /初步报价、待复核/);
assert.match(estimated.assumptions.join(''), /高度/);
const exactHeight = quote({...whitePet, measured_thickness_mm: null, weight_g: null}, config);
assert.equal(exactHeight.calculation.thicknessMm, 0.4);
assert.equal(exactHeight.review_label, '初步报价、待复核');

const weighed = quote({...whitePet, length_cm: 20, width_cm: 10, height_cm: 2, measured_thickness_mm: null, weight_g: 15}, config);
const equivalent = 15 * 10 / (200 * 1.4);
assert.ok(Math.abs(weighed.calculation.thicknessMm - equivalent) < 1e-12);
assert.notEqual(weighed.calculation.thicknessMm, 0.55);
assert.notEqual(weighed.calculation.thicknessMm, 0.5);
assert.equal(weighed.review_label, '初步报价、待复核');
const measuredWins = quote({...whitePet, measured_thickness_mm: 0.47, weight_g: 999}, config);
assert.equal(measuredWins.calculation.thicknessMm, 0.47);
assert.equal(measuredWins.calculation.thicknessSource, 'measured');
assert.equal(measuredWins.review_label, null);

for (const bad of [0, -0.1, false, true, 'abc', Infinity, NaN, '0']) {
  assert.throws(() => quote({...whitePet, measured_thickness_mm: bad, weight_g: null}, config), /正数/, `无效厚度 ${bad} 不能当成缺失`);
}
for (const bad of [0, -1, false, true, 'abc', Infinity, NaN]) {
  assert.throws(() => quote({...whitePet, measured_thickness_mm: null, weight_g: bad}, config), /正数/, `无效克重 ${bad} 不能改走高度估算`);
}
for (const bad of ['foo', false, 0, '阳模', 'MALE', true]) {
  assert.throws(() => quote({...whitePet, mold_type: bad}, config), /模具/, `无效模具 ${bad} 不能改成阳模`);
}
for (const missingMold of [null, undefined, '']) {
  const assumed = quote({...whitePet, mold_type: missingMold}, config);
  assert.equal(assumed.calculation.moldType, 'male');
  assert.equal(assumed.mold_defaulted, true);
  assert.equal(assumed.review_label, '初步报价、待复核');
}
const customBleed = quote({...whitePet, mold_type: 'female', length_cm: 20, width_cm: 10, height_cm: 1, total_bleed_cm: 2}, config);
assert.equal(customBleed.review_label, '初步报价、待复核');
assert.equal(customBleed.status, 'pending_review');
assert.match(customBleed.assumptions.join(''), /出血/);
assert.equal(customBleed.calculation.layoutAllowanceCm, 2);
assert.equal(customBleed.calculation.layoutAllowanceSource, 'bleed');
assert.deepEqual([customBleed.calculation.layout.occupiedLengthCm, customBleed.calculation.layout.occupiedWidthCm].sort((a, b) => a - b), [12, 22]);
const defaultBleed = quote({...whitePet, mold_type: 'female', length_cm: 20, width_cm: 10, height_cm: 1}, config);
assert.equal(defaultBleed.calculation.layoutAllowanceCm, 1);
assert.equal(defaultBleed.review_label, null);
const blankBleed = quote({...whitePet, mold_type: 'female', length_cm: 20, width_cm: 10, height_cm: 1, total_bleed_cm: ''}, config);
assert.equal(blankBleed.calculation.layoutAllowanceCm, 1);
assert.equal(blankBleed.review_label, null);
for (const bad of [0, '0', -1, false, true, 'abc', Infinity, NaN]) {
  assert.throws(() => quote({...whitePet, mold_type: 'female', length_cm: 20, width_cm: 10, height_cm: 1, total_bleed_cm: bad}, config), /正数/, `阴模出血 ${bad} 必须拒绝，不能当成默认 1 cm`);
}
for (const ignored of [2, 0, -1, 'abc']) {
  const maleWithBleed = quote({...whitePet, total_bleed_cm: ignored}, config);
  assert.equal(maleWithBleed.review_label, null, `阳模应忽略出血 ${ignored}，不标待复核`);
  assert.equal(maleWithBleed.calculation.layoutAllowanceSource, 'height');
  assert.equal(maleWithBleed.calculation.layoutAllowanceCm, whitePet.height_cm);
  assert.equal(maleWithBleed.calculation.layout.sheetLengthCm, pet.calculation.layout.sheetLengthCm);
  assert.equal(maleWithBleed.calculation.layout.sheetWidthCm, pet.calculation.layout.sheetWidthCm);
  assert.equal(maleWithBleed.taxed_unit, pet.taxed_unit);
  assert.equal(maleWithBleed.untaxed_unit, pet.untaxed_unit);
}

const flock = priceOf('PET植绒', '白色');
const bare = priceOf('PET', '白色');
const flockOrder = {material: 'PET植绒', color: '白色', shape: 'rectangle', length_cm: 20, width_cm: 10, height_cm: 2, quantity: 10000, mold_type: 'male'};
const flockMeasured = quote({...flockOrder, measured_thickness_mm: 0.4}, config);
assert.equal(flockMeasured.calculation.thicknessMm, 0.4);
assert.equal(flockMeasured.calculation.materialPrice, flock.price_per_kg);
assert.equal(flockMeasured.calculation.density, flock.density_g_cm3);
assert.equal(flockMeasured.review_label, '初步报价、待复核');
const substrate = quote({...flockOrder, weight_g: 15, weight_basis: 'substrate'}, config);
const finished = quote({...flockOrder, weight_g: 15, weight_basis: 'finished'}, config);
assert.ok(Math.abs(substrate.calculation.thicknessMm - 150 / (200 * bare.density_g_cm3)) < 1e-12);
assert.ok(Math.abs(finished.calculation.thicknessMm - 150 / (200 * flock.density_g_cm3)) < 1e-12);
assert.ok(finished.calculation.thicknessMm < substrate.calculation.thicknessMm);
assert.equal(substrate.calculation.materialPrice, flock.price_per_kg);
assert.equal(finished.calculation.materialPrice, flock.price_per_kg);
assert.notEqual(substrate.calculation.density, bare.density_g_cm3);
assert.equal(finished.calculation.density, flock.density_g_cm3);
assert.equal(substrate.review_label, '初步报价、待复核');
assert.equal(finished.review_label, '初步报价、待复核');
assert.throws(() => quote({...flockOrder, weight_g: 15}, config), /称重阶段|确认克重/);
assert.throws(() => quote({...flockOrder, color: '紫色', measured_thickness_mm: 0.4}, config), /材料与颜色/);
assert.throws(() => quote({...whitePet, material: '不存在的材料'}, config), /材料与颜色/);
const missingDensity = structuredClone(config);
delete missingDensity.materials.find(item => item.material === 'PET' && item.color === '白色').density_g_cm3;
assert.throws(() => quote(whitePet, missingDensity), /比重/);
const missingPrice = structuredClone(config);
delete missingPrice.materials.find(item => item.material === 'PET' && item.color === '白色').price_per_kg;
assert.throws(() => quote(whitePet, missingPrice), /单价/);

for (const missingMold of [undefined, null, '']) {
  const cloth = quote({material: '植布', color: '白色', length_cm: 35, width_cm: 15, height_cm: 3, quantity: 10000, mold_type: missingMold}, config);
  assert.equal(cloth.calculation.moldType, 'female', '植布缺模具应默认阴模');
  assert.equal(cloth.mold_defaulted, true);
  assert.equal(cloth.review_label, '初步报价、待复核');
  assert.match(cloth.assumptions.join(''), /阴模/);
  assert.equal(cloth.calculation.layoutAllowanceSource, 'bleed');
  assert.equal(cloth.calculation.layoutAllowanceCm, 1);
  assert.equal(cloth.calculation.alternatives.length, 1);
  assert.equal(cloth.calculation.layout.occupiedLengthCm, 36);
  assert.equal(cloth.calculation.layout.occupiedWidthCm, 16);
  assert.equal(cloth.calculation.sheetProcessingCost, 3);
  assert.ok(cloth.calculation.layout.sheetLengthCm <= 110 && cloth.calculation.layout.sheetWidthCm <= 70);
}
const clothShort = quote({material: '植布', color: '白色', length_cm: 35, width_cm: 15, height_cm: 1, quantity: 10000}, config);
assert.equal(clothShort.calculation.moldType, 'female');
assert.equal(clothShort.calculation.layout.occupiedLengthCm, 36);
assert.equal(clothShort.calculation.layout.occupiedWidthCm, 16);
assert.equal(clothShort.calculation.layout.cavities, 8);
const clothMale = quote({material: '植布', color: '白色', length_cm: 35, width_cm: 15, height_cm: 3, quantity: 10000, mold_type: 'male'}, config);
assert.equal(clothMale.calculation.moldType, 'male');
assert.equal(clothMale.review_label, null);
assert.equal(clothMale.calculation.layout.occupiedLengthCm, 38);
assert.equal(clothMale.calculation.layout.occupiedWidthCm, 18);
assert.equal(clothMale.calculation.sheetProcessingCost, 3);

for (const [material, color] of [['触感PET', '黑色'], ['触感PET', '彩色'], ['镀金PET', '彩色']]) {
  const row = priceOf(material, color);
  assert.equal(row.processing_base_per_sheet, 1.5, `${material} ${color} 的基础加工费应配置为 1.50`);
  const fromConfig = square(1, {material, color, quantity: 100});
  assert.equal(fromConfig.calculation.baseSheetProcessingCost, row.processing_base_per_sheet);
  assert.equal(fromConfig.calculation.sheetProcessingCost, row.processing_base_per_sheet);
  const custom = structuredClone(config);
  custom.materials.find(item => item.material === material && item.color === color).processing_base_per_sheet = 2.25;
  custom.machine = {...custom.machine, max_length_cm: 15, max_width_cm: 15};
  const changed = quote({shape: 'rectangle', length_cm: 10, width_cm: 10, height_cm: 1, mold_type: 'female', material, color, quantity: 100, measured_thickness_mm: 0.5, tax_included: true}, custom);
  assert.equal(changed.calculation.sheetProcessingCost, 2.25, `${material} ${color} 应读取配置中的加工费，而不是写死 1.50`);
  assert.notEqual(changed.calculation.sheetProcessingCost, 1.5);
}

console.log('PASS 含税系数、加工费档位、排版、小单、取整、估厚、植绒、无效输入与白 PET 回归');

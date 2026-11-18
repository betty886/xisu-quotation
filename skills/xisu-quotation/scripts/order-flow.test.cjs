'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {quote} = require('./quote.cjs');
const flow = require('./order-flow.cjs');
const config = require('../assets/parameters.reference.json');

const template = path.join(__dirname, '../templates/delivery-note-anonymized.xlsx');
const exampleDir = path.join(__dirname, '../examples/fictional-e2e');
const confirmed = {length_cm: 20, width_cm: 10, height_cm: 2, sheet_length_cm: 90, sheet_width_cm: 60, cavities: 6};
const baseSpec = {material: 'PET', color: '白色', quantity: 1000, mold_type: 'male', measured_thickness_mm: 0.4, shape: 'rectangle', tax_included: true};

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'xisu-order-')); }
function countingQuote() {
  const state = {calls: 0};
  state.quote = (order, parameters) => { state.calls += 1; return quote(order, parameters); };
  return state;
}
function readyOrder(extra = {}) {
  const order = flow.createOrder({order_no: extra.order_no || 'DEMO-UNIT-1', customer_name: extra.customer_name || '', product_name: extra.product_name || '示例吸塑产品', spec: extra.spec || baseSpec});
  flow.confirmLayout(order, extra.confirmed || confirmed);
  return order;
}
function py(args) {
  const result = spawnSync('python3', [path.join(__dirname, 'delivery_note.py'), ...args], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function inspect(file) { return JSON.parse(py(['--inspect', file])); }
function pdfText(file) {
  const result = spawnSync('pdftotext', ['-layout', file, '-'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function pdfInfo(file) {
  const result = spawnSync('pdfinfo', [file], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function visibleText(file) {
  if (file.endsWith('.pdf')) return pdfText(file) + '\n' + pdfInfo(file);
  if (file.endsWith('.xlsx')) {
    const read = name => spawnSync('unzip', ['-p', file, name], {encoding: 'utf8'}).stdout;
    return [read('xl/worksheets/sheet1.xml'), read('xl/workbook.xml'), read('docProps/core.xml')].join('\n');
  }
  return fs.readFileSync(file, 'utf8');
}
function assertNoLeak(file, forbidden) {
  const text = visibleText(file);
  for (const token of forbidden) assert.equal(text.includes(token), false, `${path.basename(file)} 含有内部字段 ${token}`);
  assert.equal(text.includes('state="hidden"'), false);
}

const natural = quote({...baseSpec, length_cm: 20, width_cm: 10, height_cm: 2}, config);
const overridden = quote({...baseSpec, length_cm: 20, width_cm: 10, height_cm: 2, confirmed_sheet_length_cm: 90, confirmed_sheet_width_cm: 60, confirmed_cavities: 6}, config);
assert.equal(overridden.status, 'pending_review');
assert.equal(overridden.calculation.cavitySource, 'confirmed');
assert.equal(overridden.calculation.adoptedCavities, 6);
assert.equal(overridden.calculation.layout.orientation, '已确认排模');
assert.deepEqual([overridden.calculation.layout.sheetLengthCm, overridden.calculation.layout.sheetWidthCm], [90, 60]);
assert.equal(overridden.calculation.alternatives.length, 1);
assert.equal(overridden.calculation.alternatives.some(item => item.orientation === '旋转90°'), false);
assert.notEqual(overridden.calculation.adoptedCavities, natural.calculation.adoptedCavities);
assert.equal(natural.calculation.cavitySource, 'layout');
assert.notEqual(overridden.taxed_unit, natural.taxed_unit);
assert.throws(() => quote({...baseSpec, length_cm: 20, width_cm: 10, height_cm: 2, confirmed_cavities: 6}, config), /同时提供/);
assert.throws(() => quote({...baseSpec, length_cm: 20, width_cm: 10, height_cm: 2, confirmed_sheet_length_cm: 90, confirmed_sheet_width_cm: 60, confirmed_cavities: 0}, config), /正整数|正数/);
const tooBig = quote({...baseSpec, length_cm: 20, width_cm: 10, height_cm: 2, confirmed_sheet_length_cm: 200, confirmed_sheet_width_cm: 60, confirmed_cavities: 4}, config);
assert.equal(tooBig.status, 'blocked');
assert.equal(tooBig.taxed_unit, undefined);

assert.equal(py(['--uppercase', '1100']), '人民币（大写）：壹仟壹佰元整');
assert.equal(py(['--uppercase', '1000.05']), '人民币（大写）：壹仟元零伍分');
assert.equal(py(['--uppercase', '1010']), '人民币（大写）：壹仟零壹拾元整');

const counter = countingQuote();
let order = flow.createOrder({order_no: 'DEMO-GATE-1', spec: baseSpec});
flow.ingestRecognition(order, {unclear: true, fields: {}});
flow.calculateQuote(order, config, counter);
assert.equal(counter.calls, 0);
assert.equal(order.quote.status, 'blocked');
flow.ingestRecognition(order, {fields: {length: {value: 20, unit: 'cm'}, width: {value: 10, unit: 'mm'}, height: {value: 2, unit: 'cm'}, sheet_length: {value: 90, unit: 'cm'}, sheet_width: {value: 60, unit: 'cm'}, cavities: {value: 6, unit: '穴'}}});
flow.calculateQuote(order, config, counter);
assert.equal(counter.calls, 0);
assert.match(order.quote.errors.join(''), /单位冲突/);
flow.ingestRecognition(order, null);
flow.calculateQuote(order, config, counter);
assert.equal(counter.calls, 0);
assert.match(order.quote.errors.join(''), /为空/);
flow.ingestRecognition(order, {fields: {length: {value: 20, unit: ''}, width: {value: 10, unit: 'cm'}, height: {value: 2, unit: 'cm'}, sheet_length: {value: 90, unit: 'cm'}, sheet_width: {value: 60, unit: 'cm'}, cavities: {value: 6, unit: '穴'}}});
flow.calculateQuote(order, config, counter);
assert.equal(counter.calls, 0);
assert.match(order.quote.errors.join(''), /缺少单位/);
assert.throws(() => flow.confirmLayout(order, {...confirmed, units: {length: 'cm', width: 'mm'}}), /单位冲突/);
assert.equal(counter.calls, 0);
assert.throws(() => flow.confirmLayout(order, {length_cm: 20, width_cm: 10, height_cm: 2, sheet_length_cm: 90, sheet_width_cm: 60}), /穴数/);

const store = tmp();
const first = flow.createOrder({order_no: 'DEMO-A', customer_name: '示例客户甲', spec: baseSpec});
flow.saveOrder(store, first);
const second = flow.createOrder({order_no: 'DEMO-B', spec: baseSpec});
assert.equal(second.customer_name, '');
assert.equal(JSON.stringify(second).includes('示例客户甲'), false);

order = readyOrder({order_no: 'DEMO-QUOTE-1', customer_name: ''});
flow.calculateQuote(order, config, counter);
assert.equal(counter.calls, 1);
assert.equal(order.quote.status, 'pending_review');
assert.equal(order.quote.summary.cavities, 6);
assert.equal(order.quote.summary.cavity_source, 'confirmed');
assert.equal(order.quote.summary.pricing_sheets, 1000 / 6);
assert.equal(order.quote.summary.production_sheets, 167);
assert.equal(order.quote.summary.small_order_sheets, 1000 / 6);
assert.equal(order.quote.summary.defect_rate, 0);
assert.equal(order.quote.summary.waste_note, '未计损耗');
assert.equal(order.quote.selling_price.taxed_unit, overridden.taxed_unit);
const formal = flow.confirmFormalQuote(order, config);
assert.equal(formal.ok, false);
assert.match(formal.reasons.join(''), /尚未核准/);
assert.equal(order.formal_quote, null);
assert.equal(order.quote.status, 'pending_review');
assert.equal(order.shipments.length, 0);

const approved = structuredClone(config);
approved.is_demo = false;
approved.materials.find(row => row.material === 'PET' && row.color === '白色').price_confirmed = true;
const formalOrder = readyOrder({order_no: 'DEMO-FORMAL-1'});
flow.calculateQuote(formalOrder, approved);
const accepted = flow.confirmFormalQuote(formalOrder, approved);
assert.equal(accepted.ok, true, accepted.reasons.join(''));
assert.equal(formalOrder.formal_quote.status, 'confirmed');
assert.equal(formalOrder.formal_quote.version, 1);
assert.equal(formalOrder.quote.status, 'pending_review');
assert.equal(formalOrder.shipments.length, 0);
const demo = structuredClone(approved);
demo.is_demo = true;
assert.equal(flow.confirmFormalQuote(formalOrder, demo).ok, false);
const assumed = readyOrder({order_no: 'DEMO-ASSUME-1', spec: {...baseSpec, mold_type: undefined}});
flow.calculateQuote(assumed, approved);
assert.equal(flow.confirmFormalQuote(assumed, approved).ok, false);
const estimated = readyOrder({order_no: 'DEMO-HEIGHT-1', spec: {...baseSpec, measured_thickness_mm: undefined}});
flow.calculateQuote(estimated, approved);
assert.equal(estimated.quote.assumptions.some(item => item.includes('高度')), true);
assert.equal(flow.confirmFormalQuote(estimated, approved).ok, false);
const invalid = readyOrder({order_no: 'DEMO-BAD-1', spec: {...baseSpec, measured_thickness_mm: 'abc'}});
flow.calculateQuote(invalid, config);
assert.equal(invalid.quote.status, 'blocked');
assert.match(invalid.quote.errors.join(''), /正数/);
assert.equal(invalid.quote.summary, null);

const priced = structuredClone(config);
const pricedRow = priced.materials.find(row => row.material === 'PET' && row.color === '白色');
pricedRow.price_per_kg = 12.345;
pricedRow.density_g_cm3 = 1.234;
const leakOrder = readyOrder({order_no: 'DEMO-LEAK-1', customer_name: ''});
flow.calculateQuote(leakOrder, priced);
const leakDir = tmp();
flow.recordShipment(leakOrder, {quantity: 400, date: '2026-03-03'});
flow.renderDelivery(leakOrder, 1, leakDir);
const leakFiles = fs.readdirSync(leakDir).map(name => path.join(leakDir, name));
assert.equal(leakFiles.length, 2);
const forbidden = ['12.345', '1.234', '毛利', '成本', '加工费', '比重', 'price_per_kg', 'density_g_cm3', 'materialPrice'];
for (const file of leakFiles) assertNoLeak(file, forbidden);
const view = JSON.stringify(flow.customerView(leakOrder, leakOrder.shipments[0]));
for (const token of forbidden) assert.equal(view.includes(token), false);
assert.equal(flow.operatorView(leakOrder).sheets.production_sheets, 167);
assert.equal(JSON.stringify(flow.operatorView(leakOrder)).includes('12.345'), false);
const blankNote = inspect(leakFiles.find(file => file.endsWith('.xlsx')));
assert.equal(blankNote.A4, '客户名称：');
assert.equal(blankNote.C9, '模具费');
assert.equal(blankNote.Z9, null);
assert.equal(visibleText(leakFiles.find(file => file.endsWith('.xlsx'))).includes('示例客户'), false);

const e2eDir = tmp();
const e2e = flow.createOrder({order_no: 'DEMO-E2E-001', customer_name: '示例客户', product_name: '示例吸塑产品', spec: baseSpec});
const e2eQuote = countingQuote();
flow.ingestRecognition(e2e, {unclear: true, fields: {height: {value: null, unit: null}}});
flow.calculateQuote(e2e, config, e2eQuote);
assert.equal(e2eQuote.calls, 0);
flow.confirmLayout(e2e, confirmed);
flow.calculateQuote(e2e, config, e2eQuote);
assert.equal(e2eQuote.calls, 1);
assert.equal(flow.confirmFormalQuote(e2e, config).ok, false);
assert.equal(e2e.formal_quote, null);
assert.equal(e2e.shipments.length, 0);
flow.recordShipment(e2e, {quantity: 400, date: '2026-03-03', mold_fee: 100});
assert.equal(flow.remainder(e2e), 600);
flow.renderDelivery(e2e, 1, e2eDir);
flow.recordShipment(e2e, {quantity: 600, date: '2026-03-18'});
assert.equal(flow.remainder(e2e), 0);
assert.throws(() => flow.recordShipment(e2e, {quantity: 1, date: '2026-03-19'}), /余量/);
flow.renderDelivery(e2e, 2, e2eDir);
assert.equal(e2e.shipments.every(item => item.delivery_confirmed === false), true);
const firstBook = inspect(path.join(e2eDir, 'DEMO-E2E-001-v1-ship1.xlsx'));
const secondBook = inspect(path.join(e2eDir, 'DEMO-E2E-001-v1-ship2.xlsx'));
assert.equal(firstBook.R8, 400);
assert.equal(secondBook.R8, 600);
assert.equal(firstBook.X5, '送货日期：2026-03-03');
assert.equal(secondBook.X5, '送货日期：2026-03-18');
assert.equal(firstBook.A4, '客户名称：示例客户');
assert.equal(firstBook.X4, '单号：DEMO-E2E-001');
assert.equal(firstBook.C8, '示例吸塑产品');
assert.equal(firstBook.C9, '模具费');
assert.equal(firstBook.Z9, 100);
assert.equal(secondBook.Z9, null);
assert.equal(firstBook.Z8, '=ROUND(R8*V8,2)');
assert.equal(firstBook.Z14, '=SUM(Z8:Z13)');
assert.equal(firstBook.merges, 71);
assert.equal(firstBook.images, 0);
assert.deepEqual(firstBook.sheets, [['送货单', 'visible']]);
assert.equal(firstBook.font, 'Noto Sans CJK SC');
assert.equal(firstBook.xml_fit, true);
assert.equal(firstBook.xml_landscape, true);
assert.equal(firstBook.xml_cols, true);
assert.equal(firstBook.xml_print_area, true);
assert.equal(firstBook.A17, '送货单位/经手人（盖章/签字）：');
assert.match(firstBook.A15, /^人民币（大写）：/);
const firstPdf = pdfText(path.join(e2eDir, 'DEMO-E2E-001-v1-ship1.pdf'));
const firstInfo = pdfInfo(path.join(e2eDir, 'DEMO-E2E-001-v1-ship1.pdf'));
assert.match(firstInfo, /Pages:\s+1/);
assert.match(firstInfo, /841\.89 x 595\.3/);
assert.match(firstPdf, /示例塑料制品有限公司/);
assert.match(firstPdf, /示例客户/);
assert.match(firstPdf, /400个/);
assert.doesNotMatch(firstPdf, /1000个/);
assert.equal(firstPdf.includes(firstBook.A15.replace('人民币（大写）：', '')), true);
for (const file of fs.readdirSync(e2eDir)) assertNoLeak(path.join(e2eDir, file), ['6.7', '毛利', '成本', '加工费', '比重', 'price_per_kg', '/home/', 'private/']);

const exported = e2e.exports.map(item => item.status);
flow.updateSpec(e2e, {quantity: 1200}, config, e2eQuote);
assert.equal(e2e.version, 2);
assert.equal(e2eQuote.calls, 2);
assert.equal(e2e.shipments.length, 2);
assert.equal(flow.remainder(e2e), 200);
assert.equal(e2e.quote.version, 2);
assert.equal(e2e.quote.expired, false);
assert.equal(e2e.quote.summary.cavities, 6);
assert.equal(e2e.quote.summary.pricing_sheets, 1200 / 6);
assert.equal(e2e.quote_history.length, 1);
assert.equal(e2e.quote_history[0].expired, true);
assert.equal(e2e.quote_history[0].version, 1);
assert.deepEqual(e2e.exports.map(item => item.status), ['expired', 'expired']);
assert.deepEqual(exported, ['current', 'current']);
assert.equal(e2e.formal_quote, null);
flow.updateSpec(e2e, {cavities: 4}, config, e2eQuote);
assert.equal(e2e.version, 3);
assert.equal(e2e.quote.summary.cavities, 4);
assert.equal(e2e.quote.summary.cavity_source, 'confirmed');
assert.notEqual(e2e.quote.summary.cavities, natural.calculation.adoptedCavities);

const direct = tmp();
const directPayload = {customer_name: '', order_no: '', ship_date: '2026-01-02', lines: [{name: '示例吸塑产品', quantity: 1000, unit_price: '1.00'}], mold_fee: null};
fs.writeFileSync(path.join(direct, 'payload.json'), JSON.stringify(directPayload));
const directXlsx = path.join(direct, 'blank.xlsx');
py(['--template', template, '--input', path.join(direct, 'payload.json'), '--xlsx', directXlsx]);
const directBook = inspect(directXlsx);
assert.equal(directBook.A4, '客户名称：');
assert.equal(directBook.X4, '单号：');
assert.equal(directBook.C9, '模具费');
assert.equal(directBook.Z9, null);
assert.equal(directBook.A15, '人民币（大写）：壹仟元整');

const bumpCalls = countingQuote();
const bump = readyOrder({order_no: 'DEMO-BUMP-1'});
flow.calculateQuote(bump, approved, bumpCalls);
assert.equal(flow.confirmFormalQuote(bump, approved).ok, true);
bump.exports.push({id: 1, shipment_id: 1, version: 1, status: 'current'});
assert.equal(bumpCalls.calls, 1);
flow.confirmLayout(bump, confirmed, approved, bumpCalls);
assert.equal(bump.version, 1);
assert.equal(bumpCalls.calls, 1);
flow.confirmLayout(bump, {...confirmed, cavities: 4}, approved, bumpCalls);
assert.equal(bump.version, 2);
assert.equal(bumpCalls.calls, 2);
assert.equal(bump.formal_quote, null);
assert.equal(bump.exports[0].status, 'expired');
assert.equal(bump.exports[0].expired_by_version, 2);
assert.equal(bump.quote.expired, false);
assert.equal(bump.quote.version, 2);
assert.equal(bump.quote.summary.cavities, 4);
assert.equal(bump.quote.summary.cavity_source, 'confirmed');
assert.equal(bump.quote_history[0].version, 1);
assert.equal(bump.quote_history[0].expired, true);
const callsAfterLayout = bumpCalls.calls;
flow.ingestRecognition(bump, {unclear: true, fields: {}}, approved, bumpCalls);
assert.equal(bumpCalls.calls, callsAfterLayout);
assert.equal(bump.version, 3);
assert.equal(bump.layout.status, 'pending_confirmation');
assert.equal(bump.layout.confirmed, null);
assert.equal(bump.quote.status, 'expired');
assert.equal(bump.formal_quote, null);
flow.confirmLayout(bump, {...confirmed, cavities: 5}, approved, bumpCalls);
assert.equal(bump.version, 3);
assert.equal(bumpCalls.calls, callsAfterLayout + 1);
assert.equal(bump.quote.expired, false);
assert.equal(bump.quote.summary.cavities, 5);
const fresh = flow.createOrder({order_no: 'DEMO-FRESH-1', spec: baseSpec});
flow.ingestRecognition(fresh, {unclear: true, fields: {}});
assert.equal(fresh.version, 1);
assert.equal(fresh.quote, null);

const cliDir = tmp();
const cliOrder = readyOrder({order_no: 'DEMO-CLI-VER'});
flow.calculateQuote(cliOrder, config);
flow.saveOrder(cliDir, cliOrder);
const layoutFile = path.join(cliDir, 'layout.json');
const patchFile = path.join(cliDir, 'patch.json');
const recognitionFile = path.join(cliDir, 'recognition.json');
fs.writeFileSync(layoutFile, JSON.stringify({...confirmed, cavities: 8}));
fs.writeFileSync(patchFile, JSON.stringify({quantity: 800}));
fs.writeFileSync(recognitionFile, JSON.stringify({unclear: true, fields: {}}));
const parameterFile = path.join(__dirname, '../assets/parameters.reference.json');
function cli(args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'order-flow.cjs'), ...args], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
cli(['confirm-layout', '--dir', cliDir, '--order-no', 'DEMO-CLI-VER', '--file', layoutFile, '--config', parameterFile]);
let stored = flow.loadOrder(cliDir, 'DEMO-CLI-VER');
assert.equal(stored.version, 2);
assert.equal(stored.layout.confirmed.cavities, 8);
assert.equal(stored.quote.version, 2);
assert.equal(stored.quote.expired, false);
assert.equal(stored.quote.summary.cavities, 8);
assert.equal(stored.formal_quote, null);
cli(['update-spec', '--dir', cliDir, '--order-no', 'DEMO-CLI-VER', '--file', patchFile, '--config', parameterFile]);
stored = flow.loadOrder(cliDir, 'DEMO-CLI-VER');
assert.equal(stored.version, 3);
assert.equal(stored.spec.quantity, 800);
assert.equal(stored.quote.summary.pricing_sheets, 800 / 8);
assert.equal(stored.quote.summary.production_sheets, 100);
cli(['recognize', '--dir', cliDir, '--order-no', 'DEMO-CLI-VER', '--file', recognitionFile, '--config', parameterFile]);
stored = flow.loadOrder(cliDir, 'DEMO-CLI-VER');
assert.equal(stored.version, 4);
assert.equal(stored.layout.status, 'pending_confirmation');
assert.equal(stored.quote.expired, true);
assert.equal(stored.formal_quote, null);

const strayName = 'DEMO-ROOT-SHOULD-NOT-EXIST';
const stray = path.join(path.resolve(__dirname, '../../..'), `${strayName}.json`);
assert.throws(() => flow.saveOrder(path.resolve(__dirname, '../../..'), flow.createOrder({order_no: strayName, spec: baseSpec})), /仓库根目录/);
assert.equal(fs.existsSync(stray), false);
assert.throws(() => flow.saveOrder(path.join(__dirname, '..'), flow.createOrder({order_no: 'DEMO-SKILL-DIR', spec: baseSpec})), /已忽略/);

flow.recordShipment(bump, {quantity: 100, date: '2026-04-01'});
const outside = tmp();
const officialTemplate = path.join(outside, 'formal.xlsx');
fs.copyFileSync(template, officialTemplate);
const edited = spawnSync('python3', ['-c', 'import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); wb.active["A1"]="仓库外供货方"; wb.save(sys.argv[1])', officialTemplate], {encoding: 'utf8'});
assert.equal(edited.status, 0, edited.stderr);
const sampleOut = tmp();
const officialOut = tmp();
assert.throws(() => flow.renderDelivery(bump, 1, officialOut, {profile: 'official', template}), /仓库外/);
flow.renderDelivery(bump, 1, sampleOut);
flow.renderDelivery(bump, 1, officialOut, {profile: 'official', template: officialTemplate});
const sampleBook = inspect(fs.readdirSync(sampleOut).find(name => name.endsWith('.xlsx')) && path.join(sampleOut, fs.readdirSync(sampleOut).find(name => name.endsWith('.xlsx'))));
const officialXlsx = path.join(officialOut, fs.readdirSync(officialOut).find(name => name.endsWith('.xlsx')));
const officialPdf = path.join(officialOut, fs.readdirSync(officialOut).find(name => name.endsWith('.pdf')));
const officialBook = inspect(officialXlsx);
assert.equal(sampleBook.A1, '示例塑料制品有限公司');
assert.equal(officialBook.A1, '仓库外供货方');
const sampleCore = spawnSync('unzip', ['-p', path.join(sampleOut, fs.readdirSync(sampleOut).find(name => name.endsWith('.xlsx'))), 'docProps/core.xml'], {encoding: 'utf8'}).stdout;
const officialCore = spawnSync('unzip', ['-p', officialXlsx, 'docProps/core.xml'], {encoding: 'utf8'}).stdout;
assert.match(sampleCore, /示例送货单/);
assert.equal(officialCore.includes('示例送货单'), false);
assert.equal(officialCore.includes('虚构送货单'), false);
assert.match(pdfInfo(officialPdf), /Title:\s+送货单/);
assert.doesNotMatch(pdfInfo(officialPdf), /示例送货单|虚构送货单/);
assert.equal(officialBook.sheets[0][0], '送货单');
assert.equal(officialBook.xml_print_area, true);

if (process.env.UPDATE_E2E === '1') {
  fs.rmSync(exampleDir, {recursive: true, force: true});
  fs.mkdirSync(exampleDir, {recursive: true});
  for (const name of ['DEMO-E2E-001-v1-ship1.xlsx', 'DEMO-E2E-001-v1-ship1.pdf', 'DEMO-E2E-001-v1-ship2.xlsx', 'DEMO-E2E-001-v1-ship2.pdf']) {
    fs.copyFileSync(path.join(e2eDir, name), path.join(exampleDir, name.replace('DEMO-E2E-001-v1-', 'delivery-batch-').replace('ship1', '1').replace('ship2', '2')));
  }
  fs.writeFileSync(path.join(exampleDir, 'summary.json'), JSON.stringify({
    document: 'customer',
    order_no: 'DEMO-E2E-001',
    version_rule: flow.VERSION_RULE,
    customer_name: '示例客户',
    product_name: '示例吸塑产品',
    quote_status: 'pending_review',
    formal_quote: null,
    sheets: {pricing_sheets: 1000 / 6, production_sheets: 167, small_order_sheets: 1000 / 6, defect_rate: 0, waste_note: '未计损耗', cavities: 6, sheet_length_cm: 90, sheet_width_cm: 60},
    shipments: [{quantity: 400, date: '2026-03-03'}, {quantity: 600, date: '2026-03-18'}],
    remainder_after_two_batches: 0,
    notice: '虚构样例。报价确认不等于出货。读图只做待确认，不调用视觉服务。整张数展示排产整张数，不另设损耗。'
  }, null, 2));
}
if (fs.existsSync(path.join(exampleDir, 'summary.json'))) {
  const summary = fs.readFileSync(path.join(exampleDir, 'summary.json'), 'utf8');
  assert.match(summary, /订单编号由使用人必填/);
  assert.equal(summary.includes('price_per_kg'), false);
  const policy = fs.readFileSync(path.join(__dirname, '../references/order-flow.md'), 'utf8');
  assert.match(policy, /未正式确认的报价仍可开送货单/);
  assert.match(policy, /正式范本留在仓库外/);
  for (const name of ['delivery-batch-1.xlsx', 'delivery-batch-1.pdf', 'delivery-batch-2.xlsx', 'delivery-batch-2.pdf']) {
    assertNoLeak(path.join(exampleDir, name), ['毛利', '成本', '加工费', '比重', 'price_per_kg', '6.7']);
  }
}

console.log('PASS 订单流转：待确认闸门、排模覆盖、正式报价、分批出货、送货单与过期重算');

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {quote: quoteWithEngine} = require('./quote.cjs');

const VERSION_RULE = '订单编号由使用人必填。尺寸、穴数、片材尺寸、材料、颜色、数量、厚度或克重、模具变更时版本加一。旧计算和旧导出标为过期；排模仍完整时重算，并保留来源版本。';
const LAYOUT_FIELDS = ['length_cm', 'width_cm', 'height_cm', 'sheet_length_cm', 'sheet_width_cm', 'cavities'];
const WATCHED = [...LAYOUT_FIELDS, 'material', 'color', 'quantity', 'measured_thickness_mm', 'weight_g', 'weight_basis', 'mold_type', 'defect_rate'];
const LENGTH_FIELDS = ['length', 'width', 'height', 'sheet_length', 'sheet_width'];
const RECOGNITION_FIELDS = [...LENGTH_FIELDS, 'cavities'];
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TEMPLATE = path.join(__dirname, '../templates/delivery-note-anonymized.xlsx');

function fail(message) {
  const error = new Error(message);
  error.code = 'order_flow';
  throw error;
}
function blank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}
function text(value) {
  return blank(value) ? '' : String(value).trim();
}
function same(left, right) {
  if (typeof left === 'number' || typeof right === 'number') return Number(left) === Number(right);
  return left === right;
}
function clone(value) {
  return value == null ? value : structuredClone(value);
}
function sellingString(value) {
  return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
function positiveInteger(value, label) {
  if (typeof value === 'boolean' || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) fail(`${label}须为正整数。`);
  return Number(value);
}
function nonNegative(value, label) {
  if (typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) < 0) fail(`${label}须为有效非负数。`);
  return Number(value);
}
function positive(value, label) {
  if (typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) <= 0) fail(`${label}须为有效正数。`);
  return Number(value);
}

function createOrder(input = {}) {
  const orderNo = text(input.order_no);
  if (!orderNo || orderNo.includes('/') || orderNo.includes('\\') || orderNo.includes('..')) fail('请填写订单编号。');
  const order = {
    order_no: orderNo,
    version: 1,
    version_rule: VERSION_RULE,
    customer_name: text(input.customer_name),
    customer_phone: text(input.customer_phone),
    customer_address: text(input.customer_address),
    contact: text(input.contact),
    supplier_name: text(input.supplier_name),
    supplier_address: text(input.supplier_address),
    supplier_phone: text(input.supplier_phone),
    product_name: text(input.product_name),
    spec_text: text(input.spec_text),
    spec: {
      shape: input.spec?.shape || 'rectangle',
      material: input.spec?.material,
      color: input.spec?.color,
      quantity: input.spec?.quantity,
      mold_type: input.spec?.mold_type,
      measured_thickness_mm: input.spec?.measured_thickness_mm,
      weight_g: input.spec?.weight_g,
      weight_basis: input.spec?.weight_basis,
      defect_rate: input.spec?.defect_rate,
      tax_included: input.spec?.tax_included !== false
    },
    layout: {status: 'pending_confirmation', source: null, confirmed: null, issues: ['尺寸、单位、穴数和片材尺寸尚未确认。']},
    recognition: null,
    quote: null,
    quote_history: [],
    formal_quote: null,
    shipments: [],
    exports: []
  };
  return order;
}

function recognitionIssues(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ['识别结果为空，不能猜测尺寸。'];
  if (payload.unclear === true) return ['识别结果标明图不清，不能猜测尺寸。'];
  const fields = payload.fields;
  if (!fields || typeof fields !== 'object') return ['识别结果为空，不能猜测尺寸。'];
  const issues = [];
  const unclear = new Set(Array.isArray(payload.unclear) ? payload.unclear : []);
  const units = [];
  for (const name of RECOGNITION_FIELDS) {
    const field = fields[name];
    if (unclear.has(name) || !field || typeof field !== 'object') {
      issues.push(`${name} 未识别，不能猜测。`);
      continue;
    }
    if (blank(field.unit)) issues.push(`${name} 缺少单位。`);
    if (blank(field.value)) issues.push(`${name} 没有读出数值。`);
    if (LENGTH_FIELDS.includes(name) && !blank(field.unit)) units.push(String(field.unit).trim().toLowerCase());
  }
  const distinct = [...new Set(units)];
  if (distinct.length > 1) issues.push('单位冲突：同一张图的长度单位不一致，不能自动换算。');
  if (distinct.some(unit => !['cm', 'mm'].includes(unit))) issues.push('存在无法识别的长度单位。');
  return issues;
}

function ingestRecognition(order, payload, config, deps = {}) {
  const issues = recognitionIssues(payload);
  const hadConfirmed = order.layout?.status === 'confirmed' && order.layout.confirmed;
  order.recognition = {status: 'pending_confirmation', payload: clone(payload), issues};
  order.layout = {status: 'pending_confirmation', source: 'recognition', confirmed: null, issues};
  if (hadConfirmed) return invalidateForSpecChange(order, config, deps, false);
  order.quote = null;
  return order;
}

function validateConfirmed(input) {
  if (!input || typeof input !== 'object') return '确认排模的数据无效。';
  if (input.units && typeof input.units === 'object') {
    const values = Object.values(input.units).map(unit => String(unit).trim().toLowerCase());
    if (values.some(unit => unit !== 'cm')) return '单位冲突：确认值必须已经是厘米，不能混用单位。';
  }
  try {
    positive(input.length_cm, '长度');
    positive(input.width_cm, '宽度');
    nonNegative(input.height_cm, '高度');
    positive(input.sheet_length_cm, '片材长度');
    positive(input.sheet_width_cm, '片材宽度');
    positiveInteger(input.cavities, '穴数');
  } catch (error) {
    return error.message;
  }
  return '';
}

function confirmedNumbers(input) {
  return {
    length_cm: Number(input.length_cm),
    width_cm: Number(input.width_cm),
    height_cm: Number(input.height_cm),
    sheet_length_cm: Number(input.sheet_length_cm),
    sheet_width_cm: Number(input.sheet_width_cm),
    cavities: Number(input.cavities)
  };
}
function confirmLayout(order, input, config, deps = {}) {
  const issue = validateConfirmed(input);
  if (issue) fail(issue);
  const next = confirmedNumbers(input);
  const previous = order.layout?.status === 'confirmed' ? order.layout.confirmed : null;
  const changed = previous && LAYOUT_FIELDS.some(key => !same(previous[key], next[key]));
  const resumeExpired = !previous && order.quote && order.quote.expired;
  order.layout = {
    status: 'confirmed',
    source: order.recognition ? 'recognition_confirmed' : 'manual',
    confirmed: next,
    issues: []
  };
  if (changed) {
    if (!config) fail('变更已确认排模时必须提供报价参数以便重算。');
    return invalidateForSpecChange(order, config, deps, true);
  }
  if (resumeExpired) {
    if (!config) fail('重新确认排模时必须提供报价参数以便重算。');
    return calculateQuote(order, config, deps);
  }
  return order;
}

function quotePayload(order) {
  const layout = order.layout.confirmed;
  const spec = order.spec;
  return {
    shape: spec.shape || 'rectangle',
    length_cm: layout.length_cm,
    width_cm: layout.width_cm,
    height_cm: layout.height_cm,
    ...(blank(spec.mold_type) ? {} : {mold_type: spec.mold_type}),
    material: spec.material,
    color: spec.color,
    quantity: spec.quantity,
    ...(blank(spec.measured_thickness_mm) ? {} : {measured_thickness_mm: spec.measured_thickness_mm}),
    ...(blank(spec.weight_g) ? {} : {weight_g: spec.weight_g}),
    ...(blank(spec.weight_basis) ? {} : {weight_basis: spec.weight_basis}),
    ...(blank(spec.defect_rate) ? {} : {defect_rate: spec.defect_rate}),
    tax_included: spec.tax_included !== false,
    confirmed_sheet_length_cm: layout.sheet_length_cm,
    confirmed_sheet_width_cm: layout.sheet_width_cm,
    confirmed_cavities: layout.cavities
  };
}

function gateErrors(order) {
  const errors = [];
  if (order.layout?.status !== 'confirmed' || !order.layout.confirmed) {
    errors.push(...(order.layout?.issues?.length ? order.layout.issues : ['尺寸、单位、穴数和片材尺寸尚未确认。']));
  }
  if (blank(order.spec?.material) || blank(order.spec?.color)) errors.push('材料和颜色尚未确认。');
  if (!Number.isSafeInteger(Number(order.spec?.quantity)) || Number(order.spec.quantity) <= 0) errors.push('订单数量尚未确认。');
  return errors;
}

function sheetSummary(order, result) {
  const calc = result.calculation;
  const defect = blank(order.spec.defect_rate) ? 0 : Number(order.spec.defect_rate);
  return {
    pricing_sheets: calc.theoreticalSheets,
    production_sheets: calc.productionSheets,
    small_order_sheets: calc.smallOrderCount,
    defect_rate: defect,
    waste_note: defect === 0 ? '未计损耗' : '只按订单填写的不良率计入连续计价张数一次，未另设损耗。',
    cavity_source: calc.cavitySource,
    cavities: calc.adoptedCavities,
    sheet_length_cm: calc.layout.sheetLengthCm,
    sheet_width_cm: calc.layout.sheetWidthCm
  };
}

function calculateQuote(order, config, deps = {}) {
  const errors = gateErrors(order);
  if (errors.length) {
    order.quote = {status: 'blocked', version: order.version, expired: false, errors, summary: null, selling_price: null};
    return order;
  }
  const quote = deps.quote || quoteWithEngine;
  let result;
  try {
    result = quote(quotePayload(order), config);
  } catch (error) {
    order.quote = {status: 'blocked', version: order.version, expired: false, errors: [error.message], summary: null, selling_price: null};
    return order;
  }
  if (!result || result.status === 'blocked') {
    order.quote = {status: 'blocked', version: order.version, expired: false, errors: result?.errors || ['报价被阻断。'], summary: null, selling_price: null, result};
    return order;
  }
  order.quote = {
    status: result.status,
    version: order.version,
    expired: false,
    source: {engine: 'quote.cjs', version: order.version, layout: 'confirmed'},
    errors: [],
    summary: sheetSummary(order, result),
    selling_price: {
      untaxed_unit: result.untaxed_unit,
      taxed_unit: result.taxed_unit,
      untaxed_total: result.untaxed_total,
      taxed_total: result.taxed_total,
      tax_included: order.spec.tax_included !== false
    },
    assumptions: result.assumptions || [],
    review_label: result.review_label || null,
    mold_defaulted: Boolean(result.mold_defaulted),
    result
  };
  return order;
}

function priceRowConfirmed(config, order) {
  if (order.spec.material === '植布') return config?.cloth?.price_confirmed === true;
  const rows = (config?.materials || []).filter(row => row.material === order.spec.material && row.color === order.spec.color);
  return rows.length === 1 && rows[0].price_confirmed === true;
}

function formalBlockers(order, config) {
  const reasons = [];
  if (!order.quote || order.quote.status !== 'pending_review' || order.quote.expired) reasons.push('没有可确认的当版报价。');
  if (config?.is_demo === true) reasons.push('教学或演示参数不能成为正式报价。');
  if (!priceRowConfirmed(config, order)) reasons.push('材料价格尚未核准，不能成为正式报价。');
  if (order.quote?.mold_defaulted) reasons.push('模具仍是初步假设。');
  if (order.quote?.review_label || (order.quote?.assumptions || []).length) reasons.push('报价仍有待复核假设。');
  const source = order.quote?.result?.calculation?.thicknessSource;
  if (source && !['measured', 'area'].includes(source)) reasons.push('厚度不是实测值。');
  if (order.quote?.result?.calculation?.cavitySource && order.quote.result.calculation.cavitySource !== 'confirmed') reasons.push('排模尚未确认。');
  return reasons;
}

function confirmFormalQuote(order, config) {
  const reasons = formalBlockers(order, config);
  if (reasons.length) return {order, ok: false, reasons};
  order.formal_quote = {status: 'confirmed', version: order.version, order_no: order.order_no, at: new Date().toISOString()};
  return {order, ok: true, reasons: []};
}

function remainder(order) {
  const shipped = order.shipments.reduce((sum, item) => sum + item.quantity, 0);
  return Number(order.spec.quantity) - shipped;
}

function recordShipment(order, input) {
  const quantity = positiveInteger(input?.quantity, '本次出货数量');
  const date = text(input?.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('出货日期须为 YYYY-MM-DD。');
  const left = remainder(order);
  if (quantity > left) fail(`本次出货数量超过余量 ${left}。`);
  let moldFee = null;
  if (!blank(input.mold_fee) && Number(input.mold_fee) !== 0) moldFee = positive(input.mold_fee, '模具费');
  order.shipments.push({
    id: order.shipments.length + 1,
    quantity,
    date,
    mold_fee: moldFee,
    version: order.version,
    delivery_confirmed: false
  });
  return order;
}

function currentFlat(order) {
  return {...order.spec, ...(order.layout.confirmed || {})};
}

function expireCurrent(order, nextVersion) {
  if (order.quote) {
    order.quote_history.push(clone({...order.quote, expired: true, expired_by_version: nextVersion, result: undefined}));
    order.quote.expired = true;
  }
  for (const item of order.exports) {
    item.status = 'expired';
    item.expired_by_version = nextVersion;
  }
  order.formal_quote = null;
}

function invalidateForSpecChange(order, config, deps = {}, recalculate = false) {
  const nextVersion = order.version + 1;
  expireCurrent(order, nextVersion);
  order.version = nextVersion;
  if (recalculate && order.layout?.status === 'confirmed' && order.layout.confirmed && gateErrors(order).length === 0) {
    return calculateQuote(order, config, deps);
  }
  order.quote = {status: 'expired', version: order.version, expired: true, errors: ['规格已变更，旧报价已过期。'], summary: null, selling_price: null};
  return order;
}
function updateSpec(order, patch, config, deps = {}) {
  const current = currentFlat(order);
  const changed = WATCHED.filter(key => Object.prototype.hasOwnProperty.call(patch, key) && !same(current[key], patch[key]));
  if (!changed.length) return order;
  const nextLayout = {...(order.layout.confirmed || {})};
  for (const key of LAYOUT_FIELDS) if (key in patch) nextLayout[key] = patch[key];
  if (LAYOUT_FIELDS.some(key => changed.includes(key))) {
    const issue = validateConfirmed(nextLayout);
    if (issue) order.layout = {status: 'pending_confirmation', source: order.layout.source, confirmed: null, issues: [issue]};
    else order.layout = {status: 'confirmed', source: 'manual', confirmed: confirmedNumbers(nextLayout), issues: []};
  }
  for (const key of WATCHED) if (key in patch && !LAYOUT_FIELDS.includes(key)) order.spec[key] = patch[key];
  if ('product_name' in patch) order.product_name = text(patch.product_name);
  if ('spec_text' in patch) order.spec_text = text(patch.spec_text);
  const canRecalc = order.layout?.status === 'confirmed' && gateErrors(order).length === 0;
  return invalidateForSpecChange(order, config, deps, canRecalc);
}

function sellingUnit(order) {
  if (!order.quote || order.quote.expired || order.quote.status !== 'pending_review' || !order.quote.selling_price) fail('没有当版报价，不能把过期或缺失的单价写进送货单。');
  const price = order.quote.selling_price;
  return price.tax_included ? price.taxed_unit : price.untaxed_unit;
}

function deliveryPayload(order, shipment) {
  return {
    supplier_name: order.supplier_name || undefined,
    supplier_address: order.supplier_address || undefined,
    supplier_phone: order.supplier_phone || undefined,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_address: order.customer_address,
    contact: order.contact,
    order_no: order.order_no,
    ship_date: shipment.date,
    lines: [{
      name: order.product_name,
      spec: order.spec_text,
      pieces: '',
      quantity: shipment.quantity,
      unit_price: sellingString(sellingUnit(order)),
      note: ''
    }],
    mold_fee: shipment.mold_fee
  };
}

function repoRelative(target) {
  const relative = path.relative(REPO_ROOT, path.resolve(target));
  if (relative === '') return '';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}
function runDelivery(payload, xlsx, pdf, options = {}) {
  const profile = options.profile === 'official' ? 'official' : 'anonymized';
  const template = options.template || (profile === 'official' ? process.env.XISU_OFFICIAL_DELIVERY_TEMPLATE : TEMPLATE);
  if (!template) fail('请指定送货单范本。正式范本用仓库外路径，公开样例用脱敏范本。');
  if (profile === 'official' && repoRelative(template) !== null) fail('正式送货单范本必须放在仓库外。');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-payload-'));
  const input = path.join(directory, 'payload.json');
  fs.writeFileSync(input, JSON.stringify(payload));
  const completed = spawnSync('python3', [
    path.join(__dirname, 'delivery_note.py'),
    '--profile', profile,
    '--template', template,
    '--input', input,
    '--xlsx', xlsx,
    ...(pdf ? ['--pdf', pdf] : [])
  ], {encoding: 'utf8'});
  fs.rmSync(directory, {recursive: true, force: true});
  if (completed.status !== 0) fail(completed.stderr || '送货单生成失败。');
  return JSON.parse(completed.stdout);
}

function renderDelivery(order, shipmentId, outDir, options = {}) {
  const shipment = order.shipments.find(item => item.id === shipmentId);
  if (!shipment) fail('找不到这次出货记录。');
  fs.mkdirSync(outDir, {recursive: true});
  const stem = `${order.order_no}-v${order.version}-ship${shipment.id}`;
  const xlsx = path.join(outDir, `${stem}.xlsx`);
  const pdf = path.join(outDir, `${stem}.pdf`);
  const written = runDelivery(deliveryPayload(order, shipment), xlsx, pdf, options);
  order.exports.push({
    id: order.exports.length + 1,
    shipment_id: shipment.id,
    version: order.version,
    status: 'current',
    profile: options.profile === 'official' ? 'official' : 'anonymized',
    xlsx, pdf,
    uppercase: written.uppercase,
    total: written.total
  });
  return order;
}

function customerView(order, shipment = null) {
  return {
    document: 'customer',
    order_no: order.order_no,
    version: order.version,
    version_rule: order.version_rule,
    customer_name: order.customer_name,
    product_name: order.product_name,
    shipment: shipment ? {quantity: shipment.quantity, date: shipment.date, remainder: remainder(order)} : null,
    selling_unit_price: order.quote?.selling_price || null,
    formal_quote: order.formal_quote?.status || null
  };
}

function operatorView(order) {
  return {
    order_no: order.order_no,
    version: order.version,
    version_rule: order.version_rule,
    customer_name: order.customer_name,
    layout_status: order.layout.status,
    layout_issues: order.layout.issues,
    quote_status: order.quote?.status || null,
    formal_quote: order.formal_quote?.status || null,
    sheets: order.quote?.summary || null,
    selling_unit_price: order.quote?.selling_price || null,
    shipments: order.shipments.map(item => ({id: item.id, quantity: item.quantity, date: item.date, delivery_confirmed: item.delivery_confirmed})),
    remainder: Number.isFinite(Number(order.spec.quantity)) ? remainder(order) : null,
    exports: order.exports.map(item => ({id: item.id, shipment_id: item.shipment_id, version: item.version, status: item.status}))
  };
}

function orderFile(dir, orderNo) {
  return path.join(dir, `${orderNo}.json`);
}
function assertStore(dir) {
  const relative = repoRelative(dir);
  if (relative === '') fail('不能把订单写到仓库根目录。');
  if (relative !== null && !['private', 'quotes', 'outputs'].includes(relative.split(path.sep)[0])) {
    fail('运行时订单只能写在仓库外，或仓库内已忽略的 private、quotes、outputs。');
  }
}
function saveOrder(dir, order) {
  assertStore(dir);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(orderFile(dir, order.order_no), JSON.stringify(order, null, 2));
  return order;
}
function loadOrder(dir, orderNo) {
  return JSON.parse(fs.readFileSync(orderFile(dir, orderNo), 'utf8'));
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return args[index + 1] || '';
}
function loadParameterConfig(args) {
  return JSON.parse(fs.readFileSync(readOption(args, '--config') || path.join(__dirname, '../assets/parameters.reference.json'), 'utf8'));
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const dir = path.resolve(readOption(args, '--dir') || path.join(REPO_ROOT, 'private/orders'));
  const orderNo = readOption(args, '--order-no');
  if (command === 'init') {
    const order = createOrder({order_no: orderNo, customer_name: readOption(args, '--customer'), product_name: readOption(args, '--product')});
    saveOrder(dir, order);
    console.log(JSON.stringify(operatorView(order), null, 2));
    return;
  }
  if (!orderNo) fail('请用 --order-no 指定订单编号。');
  const order = loadOrder(dir, orderNo);
  if (command === 'recognize') {
    ingestRecognition(order, JSON.parse(fs.readFileSync(readOption(args, '--file'), 'utf8')), loadParameterConfig(args));
  } else if (command === 'confirm-layout') {
    confirmLayout(order, JSON.parse(fs.readFileSync(readOption(args, '--file'), 'utf8')), loadParameterConfig(args));
  } else if (command === 'update-spec') {
    updateSpec(order, JSON.parse(fs.readFileSync(readOption(args, '--file'), 'utf8')), loadParameterConfig(args));
  } else if (command === 'quote') {
    calculateQuote(order, loadParameterConfig(args));
  } else if (command === 'confirm-formal') {
    const config = loadParameterConfig(args);
    const result = confirmFormalQuote(order, config);
    saveOrder(dir, order);
    console.log(JSON.stringify({ok: result.ok, reasons: result.reasons, view: operatorView(order)}, null, 2));
    if (!result.ok) process.exitCode = 2;
    return;
  } else if (command === 'ship') {
    recordShipment(order, {quantity: Number(readOption(args, '--qty')), date: readOption(args, '--date'), mold_fee: readOption(args, '--mold-fee')});
  } else if (command === 'deliver') {
    const profile = readOption(args, '--profile') || 'anonymized';
    const template = readOption(args, '--template');
    renderDelivery(order, Number(readOption(args, '--shipment')), path.resolve(readOption(args, '--out') || path.join(REPO_ROOT, 'private/outputs')), {
      profile,
      ...(template ? {template} : {})
    });
  } else if (command === 'show') {
    console.log(JSON.stringify(operatorView(order), null, 2));
    return;
  } else {
    fail('命令应为 init、recognize、confirm-layout、update-spec、quote、confirm-formal、ship、deliver 或 show。');
  }
  saveOrder(dir, order);
  console.log(JSON.stringify(operatorView(order), null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({status: 'blocked', errors: [error.message]}));
    process.exitCode = 2;
  }
}

module.exports = {
  VERSION_RULE, createOrder, ingestRecognition, confirmLayout, calculateQuote, confirmFormalQuote,
  recordShipment, updateSpec, renderDelivery, customerView, operatorView, remainder, saveOrder, loadOrder,
  deliveryPayload, recognitionIssues
};

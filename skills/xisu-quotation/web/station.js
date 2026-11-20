'use strict';

const form = document.getElementById('station-form');
const message = document.getElementById('station-message');
const untaxed = document.getElementById('station-untaxed');
const taxed = document.getElementById('station-taxed');
const untaxedTotal = document.getElementById('station-untaxed-total');
const total = document.getElementById('station-total');
const heading = document.getElementById('station-quote-heading');
const layoutResult = document.getElementById('station-layout-result');
const layoutStatus = document.getElementById('station-layout-status');
const formError = document.getElementById('station-form-error');
const results = document.getElementById('station-results');
const costDetails = document.getElementById('station-cost-details');
const profitSection = document.getElementById('station-profit');
const copyActions = document.getElementById('station-copy-actions');
const copyStatus = document.getElementById('station-copy-status');
const formatAmount = new Intl.NumberFormat('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2});
const formatDimension = new Intl.NumberFormat('zh-CN', {maximumFractionDigits:3, useGrouping:false});
const money = value => '¥ ' + formatAmount.format(value);
let revision = 0;
let currentQuote = null;

function addFields(id, specs) {
  const root = document.getElementById(id);
  for (const [name, caption, group, placeholder] of specs) {
    const label = document.createElement('label');
    label.className = 'field';
    if (group) label.dataset.group = group;
    const input = document.createElement('input');
    input.name = name;
    input.inputMode = ['quantity', 'cavities', 'boxCapacity'].includes(name) ? 'numeric' : 'decimal';
    input.autocomplete = 'off';
    if (placeholder) input.placeholder = placeholder;
    label.append(caption, input);
    root.append(label);
  }
}
addFields('station-production', [
  ['cavities', '每模件数', 'cavities'],
  ['sheetLengthMm', '拉片长（mm）', 'actual'], ['sheetWidthMm', '拉片宽（mm）', 'actual'],
  ['thicknessMm', '原片厚度（mm）', 'sheet'], ['density', '原片比重（g/cm³）', 'sheet'],
  ['pieceWeight', '成品单件克重（g）', 'weight'], ['yieldPercent', '成品率（%）', 'yield'],
  ['pieceAreaCm2', '单件裁切投影面积（cm²）', 'projection'],
]);
addFields('station-capacity', [
  ['quantity', '订单数量（件）'], ['cycleSeconds', '生产节拍（秒/模）'], ['shiftHours', '每班有效工时（小时）'],
]);
addFields('station-layout-size', [
  ['productLengthMm', '单件外部长（mm）'], ['productWidthMm', '单件外部宽（mm）'],
  ['gapMm', '产品间净距（mm）'], ['edgeMm', '模具每边留量（mm）'],
]);
addFields('station-layout-options', [
  ['layoutAlongLength', '模具长向件数', 'layoutManual'], ['layoutAlongWidth', '模具宽向件数', 'layoutManual'],
  ['preferredMoldLengthMm', '自定模具长度上限（mm）', 'layoutCustom'],
]);
addFields('station-costs', [
  ['materialPrice', '原料价（元/kg）'], ['scrapPrice', '废料回收价（元/kg）', null, '无收入填 0'],
  ['shiftCost', '生产费用（元/班）'], ['taxPercent', '税点（%）', null, '未税填 0'],
  ['sellingPrice', '客户含税单价（元/件）', null, '选填，用于核算利润'],
]);
const shiftBillingField = form.elements.shiftBilling.closest('label');
shiftBillingField.parentElement.append(shiftBillingField);
addFields('station-extra', [
  ['loadingCost', '整单装运费（元）', null, '留空未计'],
  ['boxCapacity', '每箱件数'], ['boxPrice', '纸箱价（元/箱）'],
  ['moldCost', '整单模具费（元）'], ['otherCost', '整单其他费用（元）'],
  ['targetProfit', '整单目标加价（元）', null, '留空计算保本价'],
]);

function clearQuote(text) {
  currentQuote = null;
  heading.textContent = '整单报价';
  untaxed.textContent = '—';
  taxed.textContent = '—';
  untaxedTotal.textContent = '¥ —';
  total.textContent = '¥ —';
  message.textContent = text;
  costDetails.hidden = true;
  profitSection.hidden = true;
  copyActions.hidden = true;
  copyStatus.textContent = '';
}

function updateFields() {
  const source = form.elements.sourceMode.value;
  const sheet = source !== 'weight';
  const layout = source === 'layout';
  const autoLayout = layout && form.elements.layoutMethod.value === 'auto';
  const basis = form.elements.yieldBasis.value;
  const visible = { sheet, layout, actual: sheet && !layout, cavities: !layout,
    layoutManual: layout && form.elements.layoutMethod.value === 'manual',
    layoutAuto: autoLayout,
    layoutCustom: autoLayout && form.elements.layoutSize.value === 'custom',
    weight: !sheet || basis === 'measured', yield: !sheet || basis === 'provided', projection: sheet && basis === 'projection' };
  for (const group of form.querySelectorAll('[data-group]')) group.hidden = !visible[group.dataset.group];
  for (const field of form.querySelectorAll('input, select')) {
    field.disabled = !!field.closest('[hidden]');
  }
}

function orderInputs() {
  const order = Object.fromEntries(new FormData(form));
  order.mode = order.sourceMode === 'weight' ? 'weight' : 'sheet';
  if (order.mode === 'sheet') order.sheetSource = order.sourceMode;
  delete order.sourceMode;
  if (order.sheetSource === 'layout') {
    for (const name of ['maxMoldLengthMm', 'maxMoldWidthMm']) {
      const field = form.elements[name];
      if (!field.validity.valid) {
        field.closest('details').open = true;
        field.reportValidity();
        throw new Error('请核对设备的模具长宽上限。');
      }
    }
    if (order.layoutSize === 'regular') order.preferredMoldLengthMm = 600;
    if (order.layoutSize === 'custom' && !order.preferredMoldLengthMm.trim()) throw new Error('请填写自定模具长度上限。');
  }
  delete order.layoutSize;
  return order;
}

function showLayout(layout, quote) {
  const size = (length, width) => `${formatDimension.format(length)} × ${formatDimension.format(width)} mm`;
  const geometry = layout || quote;
  const items = [['每模穴数', `${geometry.cavities} 穴`]];
  if (layout) {
    items[0].push(`${layout.alongLength} × ${layout.alongWidth} 排${layout.rotated ? ' · 旋转 90°' : ''}`);
    items.push(['模具尺寸', size(layout.moldLengthMm, layout.moldWidthMm)]);
  }
  items.push([layout ? '拉片尺寸' : '实际拉片', size(geometry.sheetLengthMm, geometry.sheetWidthMm)]);
  layoutResult.replaceChildren();
  for (const [label, value, description] of items) {
    const item = document.createElement('div');
    const caption = document.createElement('span');
    caption.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = value;
    item.append(caption, amount);
    if (description) {
      const note = document.createElement('small');
      note.textContent = description;
      item.append(note);
    }
    layoutResult.append(item);
  }
  layoutResult.hidden = false;
}

function feedback(element, text = '', error = false) {
  element.textContent = text;
  element.hidden = !text;
  element.toggleAttribute('data-error', error);
}

function showRows(id, rows) {
  const parent = document.getElementById(id);
  parent.replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'summary-row';
    const caption = document.createElement('span');
    const amount = document.createElement('strong');
    caption.textContent = label;
    amount.textContent = value;
    row.append(caption, amount);
    parent.append(row);
  }
}

async function calculate(endpoint, order) {
  const response = await fetch('/api/' + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order),
  });
  if (response.status === 401) {
    location.reload();
    throw new Error('登录已失效，请重新进入报价台。');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '计算失败，请核对输入。');
  return result;
}

form.addEventListener('input', event => {
  revision++;
  updateFields();
  clearQuote('填写资料后计算。');
  feedback(formError);
  if (event.target.closest('.station-layout-controls') ||
    ['sourceMode', 'sheetLengthMm', 'sheetWidthMm', 'cavities'].includes(event.target.name)) {
    layoutResult.hidden = true;
  }
  feedback(layoutStatus);
});

document.getElementById('station-preview-layout').addEventListener('click', async () => {
  const current = ++revision;
  layoutResult.hidden = true;
  feedback(layoutStatus, '正在排模…');
  try {
    const inputs = orderInputs();
    const fields = ['productLengthMm','productWidthMm','gapMm','edgeMm','layoutMethod','layoutOrientation',
      'layoutAlongLength','layoutAlongWidth','maxMoldLengthMm','maxMoldWidthMm','preferredMoldLengthMm'];
    const result = await calculate('station-layout', Object.fromEntries(fields.filter(field => field in inputs).map(field => [field, inputs[field]])));
    if (current !== revision) return;
    showLayout(result);
    feedback(layoutStatus);
  } catch (error) {
    if (current === revision) feedback(layoutStatus, error.message, true);
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const current = ++revision;
  clearQuote('正在计算…');
  feedback(formError);
  try {
    const quote = await calculate('station-quote', orderInputs());
    if (current !== revision) return;
    currentQuote = quote;
    heading.textContent = quote.quoteBasis === 'target' ? '整单建议报价' : '整单保本报价';
    untaxed.textContent = quote.untaxedUnitPrice.toFixed(4);
    taxed.textContent = quote.taxedUnitPrice.toFixed(4);
    untaxedTotal.textContent = money(quote.untaxedTotal);
    total.textContent = money(quote.taxedTotal);
    message.textContent = `预计投料 ${quote.inputKg.toFixed(2)} kg，成品率 ${quote.yieldPercent.toFixed(2)}%。` +
      (quote.loadingIncluded ? '' : '未计装运费。');
    if (quote.layout || quote.sheetSource === 'actual') showLayout(quote.layout, quote);
    const costs = quote.costs;
    showRows('station-cost-result', [
      ['废料重量', `${quote.scrapKg.toFixed(2)} kg`], ['每班产能', `${quote.piecesPerShift.toLocaleString('zh-CN')} 件`],
      ['计费班次', `${quote.chargedShifts.toFixed(2)} 班`], ['原料采购', money(costs.materialPurchase)],
      ['废料回收收入', money(costs.scrapRevenue)], ['材料净成本', money(costs.materialNet)],
      ['班费', money(costs.production)], ['纸箱费', money(costs.packaging)], ['装运费', costs.loading === null ? '未计' : money(costs.loading)],
      ['模具费', money(costs.mold)], ['其他费用', money(costs.other)], ['整单成本', money(costs.total)],
    ]);
    costDetails.hidden = false;
    if (quote.sale) {
      showRows('station-profit-result', [
        ['未税销售收入', money(quote.sale.untaxedRevenue)],
        ['材料毛利', money(quote.sale.materialGrossProfit)],
        [quote.loadingIncluded ? '整单净利润' : '未扣装运费的整单利润', money(quote.sale.netProfit)],
      ]);
      profitSection.hidden = false;
    }
    copyActions.hidden = false;
    if (matchMedia('(max-width: 760px)').matches) {
      results.focus({preventScroll:true});
      results.scrollIntoView({block:'start'});
    }
  } catch (error) {
    if (current === revision) {
      clearQuote('请核对所填资料。');
      feedback(formError, error.message, true);
    }
  }
});
document.getElementById('station-copy-quote').addEventListener('click', async () => {
  const quote = currentQuote;
  if (!quote) return;
  const text = [
    '工位机吸塑参考报价', `数量 ${quote.quantity.toLocaleString('zh-CN')} 件`,
    `未税单价 ${quote.untaxedUnitPrice.toFixed(4)} 元/件，未税总额 ${money(quote.untaxedTotal)}`,
    `含税单价 ${quote.taxedUnitPrice.toFixed(4)} 元/件，含税总额 ${money(quote.taxedTotal)}`,
    quote.loadingIncluded ? '' : '本报价未计装运费。',
  ].filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    if (quote === currentQuote) copyStatus.textContent = '已复制报价。';
  } catch {
    if (quote === currentQuote) copyStatus.textContent = '复制失败，请手动复制报价。';
  }
});
document.getElementById('station-logout').addEventListener('click', async () => {
  await fetch('/api/logout', {method:'POST'}).catch(() => {});
  location.reload();
});
updateFields();

'use strict';

const form = document.getElementById('station-form');
const message = document.getElementById('station-message');
const untaxed = document.getElementById('station-untaxed');
const taxed = document.getElementById('station-taxed');
const total = document.getElementById('station-total');
let revision = 0;

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
  ['quantity', '数量（件）'], ['cavities', '每模件数'],
  ['sheetLengthMm', '拉片长（mm）', 'sheet'], ['sheetWidthMm', '拉片宽（mm）', 'sheet'],
  ['thicknessMm', '原片厚度（mm）', 'sheet'], ['density', '原片比重（g/cm³）', 'sheet'],
  ['pieceWeight', '成品单件克重（g）', 'weight'], ['yieldPercent', '成品率（%）', 'yield'],
  ['pieceAreaCm2', '单件裁切投影面积（cm²）', 'projection'],
  ['cycleSeconds', '秒/模'], ['shiftHours', '每班有效工时（小时）'],
]);
addFields('station-costs', [
  ['materialPrice', '原料价（元/kg）'], ['scrapPrice', '废料回收价（元/kg）', null, '无收入填 0'],
  ['shiftCost', '生产费用（元/班）'], ['taxPercent', '税点（%）', null, '未税填 0'],
  ['loadingCost', '整单装运费（元）', null, '留空未计'],
]);
addFields('station-extra', [
  ['boxCapacity', '每箱件数'], ['boxPrice', '纸箱价（元/箱）'],
  ['moldCost', '整单模具费（元）'], ['otherCost', '整单其他费用（元）'],
  ['targetProfit', '整单目标加价（元）', null, '留空计算保本价'],
]);

function clear(text) {
  untaxed.textContent = '—';
  taxed.textContent = '—';
  total.textContent = '¥ —';
  message.textContent = text;
}

function updateFields() {
  const sheet = form.elements.mode.value === 'sheet';
  const basis = form.elements.yieldBasis.value;
  const visible = { sheet, weight: !sheet || basis === 'measured', yield: !sheet || basis === 'provided', projection: sheet && basis === 'projection' };
  for (const label of form.querySelectorAll('[data-group]')) {
    label.hidden = !visible[label.dataset.group];
    label.querySelector('input,select').disabled = label.hidden;
  }
}

form.addEventListener('input', () => {
  revision++;
  updateFields();
  clear('资料已修改，请重新计算。');
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const current = ++revision;
  clear('正在计算…');
  try {
    const response = await fetch('/api/station-quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const quote = await response.json();
    if (!response.ok) throw new Error(quote.error?.message || '算价失败，请核对输入。');
    if (current !== revision) return;
    untaxed.textContent = quote.untaxedUnitPrice.toFixed(4);
    taxed.textContent = quote.taxedUnitPrice.toFixed(4);
    total.textContent = '¥ ' + quote.taxedTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    message.textContent = `预计投料 ${quote.inputKg.toFixed(2)} kg，成品率 ${quote.yieldPercent.toFixed(2)}%。` +
      (quote.loadingIncluded ? '' : '未计装运费。');
  } catch (error) {
    if (current === revision) clear(error.message);
  }
});
updateFields();

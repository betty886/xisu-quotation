'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const form = $('quote-form');
  const variants = new Map();
  const state = {ready: false, sequence: 0, timer: null, controller: null, quote: null, payload: null, unit: 'cm', previousMaterial: ''};
  const shapeNames = {rectangle: '矩形', circle: '圆形', ellipse: '椭圆形', hexagon: '正六边形', triangle: '三角形'};
  const selected = name => form.querySelector(`input[name="${name}"]:checked`)?.value || '';
  const currentVariant = () => variants.get($('variant').value);
  const fmt = (number, digits = 2) => Number(number).toLocaleString('zh-CN', {minimumFractionDigits: digits, maximumFractionDigits: digits});
  const numericFields = ['length', 'width', 'height', 'quantity', 'thickness', 'weight'];
  const apiFieldIds = {variantId: 'variant', thicknessMm: 'thickness', weightG: 'weight', moldType: 'mold-male', length: 'length', width: 'width', height: 'height', quantity: 'quantity', shape: 'shape'};

  function invalidate() {
    state.sequence++;
    clearTimeout(state.timer);
    state.controller?.abort();
    state.controller = null;
    state.quote = null;
    state.payload = null;
    $('unit-price').textContent = '—';
    $('untaxed-unit-price').textContent = '—';
    $('total-price').textContent = '¥ —';
    $('total-label').textContent = '本单含税产品金额';
    $('quote-status').textContent = '等待填写';
    $('result-message').textContent = '填写规格后自动计算，修改参数会重新估价。';
    $('copy-quote').disabled = true;
    $('copy-status').textContent = '';
    $('spec-summary').hidden = true;
    $('result-notes').replaceChildren(paragraph('参考价按所填规格计算，最终价格在样品及订单确认后核定。'));
    $('result-card').setAttribute('aria-busy', 'false');
    $('form-error').hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  }
  function paragraph(text) { const p = document.createElement('p'); p.textContent = text; return p; }
  function currentPayload() {
    const payload = {
      variantId: $('variant').value,
      length: $('length').value.trim(),
      height: $('height').value.trim(),
      dimensionUnit: selected('dimensionUnit'),
      quantity: $('quantity').value.trim(),
      moldType: selected('moldType'),
      shape: $('shape').value
    };
    if (!['circle', 'hexagon'].includes(payload.shape)) payload.width = $('width').value.trim();
    if (currentVariant()?.requiresThicknessWeight) {
      if (selected('measurementMode') === 'weight') payload.weightG = $('weight').value.trim();
      else payload.thicknessMm = $('thickness').value.trim();
    }
    return payload;
  }
  function validate(payload) {
    if (!state.ready) return {message: '材料列表尚未载入，请稍后重试。'};
    if (!variants.has(payload.variantId)) return {field: 'variantId', message: '请选择材质与颜色。'};
    const labels = {length: $('length-label').textContent, width: $('width-label').textContent, height: '高度', quantity: '订购数量', thicknessMm: $('thickness-label').textContent, weightG: $('weight-label').textContent};
    const keys = ['length', ...('width' in payload ? ['width'] : []), 'height', 'quantity', ...('thicknessMm' in payload ? ['thicknessMm'] : []), ...('weightG' in payload ? ['weightG'] : [])];
    for (const field of keys) {
      const value = payload[field];
      if (!value && ['thicknessMm', 'weightG'].includes(field)) continue;
      if (!value) return {field, message: `请填写${labels[field]}。`};
      const valid = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value));
      if (!valid || (field === 'height' ? Number(value) < 0 : Number(value) <= 0)) return {field, message: `${labels[field]}须为${field === 'height' ? '不小于 0 的数字' : '大于 0 的数字'}。`};
      if (field === 'quantity' && !Number.isSafeInteger(Number(value))) return {field, message: '订购数量请填写整数，例如 10000。'};
    }
    if (!payload.moldType) return {field: 'moldType', message: '请选择阴模或阳模；点击旁边的说明可查看区别。'};
    return null;
  }
  function showError(error, focus) {
    $('form-error').textContent = error.message || '计算服务暂不可用，请稍后重试。';
    $('form-error').hidden = false;
    $('quote-status').textContent = '请核对';
    $('result-message').textContent = '请核对所填规格后重新计算。';
    const field = $(apiFieldIds[error.field]);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      if (focus) field.focus();
    }
  }
  function addSummaryRow(label, value) {
    const row = document.createElement('div'); row.className = 'summary-row';
    const name = document.createElement('span'); name.textContent = label;
    const content = document.createElement('strong'); content.textContent = value;
    row.append(name, content); $('spec-summary').append(row);
  }
  function describeDimensions(payload) {
    const shape = payload.shape;
    if (shape === 'circle') return `直径 ${payload.length} × 高 ${payload.height} ${payload.dimensionUnit}`;
    if (shape === 'hexagon') return `对角线 ${payload.length} × 高 ${payload.height} ${payload.dimensionUnit}`;
    if (shape === 'triangle') return `底边 ${payload.length} × 平面高 ${payload.width} × 成型高 ${payload.height} ${payload.dimensionUnit}`;
    return `${payload.length} × ${payload.width} × ${payload.height} ${payload.dimensionUnit}`;
  }
  function renderQuote(quote, payload) {
    state.quote = quote; state.payload = payload;
    $('unit-price').textContent = fmt(quote.referenceUnitPrice, 4);
    $('untaxed-unit-price').textContent = fmt(quote.untaxedUnitPrice, 4);
    $('total-price').textContent = `¥ ${fmt(quote.total)}`;
    $('total-label').textContent = `${fmt(quote.quantity, 0)} 件 · 含税产品金额`;
    $('quote-status').textContent = '参考报价';
    const estimate = Number.isFinite(quote.thicknessMm) ? `${fmt(quote.thicknessMm, 3)} mm（${fmt(quote.thicknessMm * 100, 2)} 丝）` : '';
    $('result-message').textContent = quote.thicknessSource === 'weight_estimate' ? `按克重反推厚度：${estimate}，打样后复核。` : quote.thicknessSource === 'height_estimate' ? `按高度估算厚度：${estimate}，打样后复核。` : '按本次规格计算，请核对参考参数。';
    $('spec-summary').replaceChildren();
    addSummaryRow('材料', variants.get(payload.variantId).label);
    addSummaryRow(shapeNames[payload.shape], describeDimensions(payload));
    if (payload.weightG) addSummaryRow('成品单件克重', `${payload.weightG} g`);
    if (quote.thicknessSource !== 'not_required' && Number.isFinite(quote.thicknessMm)) {
      const label = quote.thicknessSource === 'height_estimate' ? '按高度估算厚度' : quote.thicknessSource === 'weight_estimate' ? '按克重反推厚度' : currentVariant().material.includes('植绒') ? '裸基材厚度' : '原片厚度';
      addSummaryRow(label, `${fmt(quote.thicknessMm, 3)} mm（${fmt(quote.thicknessMm * 100, 2)} 丝）`);
    }
    addSummaryRow('模具', payload.moldType === 'male' ? '阳模' : '阴模');
    $('spec-summary').hidden = false;
    $('result-notes').replaceChildren(...quote.notes.map(paragraph));
    $('copy-quote').disabled = false;
    $('quote-announcement').textContent = `未税参考价每件 ${fmt(quote.untaxedUnitPrice, 4)} 元，含税参考价每件 ${fmt(quote.referenceUnitPrice, 4)} 元，总金额 ${fmt(quote.total)} 元。`;
  }
  async function calculate(explicit = false) {
    invalidate();
    const payload = currentPayload();
    const invalid = validate(payload);
    if (invalid) { if (explicit) showError(invalid, true); return; }
    const requestId = state.sequence;
    const controller = new AbortController(); state.controller = controller;
    $('quote-status').textContent = '计算中';
    $('result-message').textContent = '正在计算本款产品的参考价…';
    $('result-card').setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('./api/quote', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal});
      const result = await response.json();
      if (requestId !== state.sequence) return;
      if (!response.ok) { showError(result.error || {}, explicit); return; }
      if (![result.referenceUnitPrice, result.untaxedUnitPrice, result.total].every(value => Number.isFinite(value) && value > 0) || !Array.isArray(result.notes)) throw new Error('Invalid response');
      renderQuote(result, payload);
      if (explicit && window.matchMedia('(max-width: 700px)').matches) {
        document.activeElement?.blur();
        $('result-card').scrollIntoView({block: 'start', behavior: 'instant'});
      }
    } catch (error) {
      if (error.name === 'AbortError' || requestId !== state.sequence) return;
      showError({message: '计算服务暂不可用，请稍后点击“计算参考价”重试。'}, false);
      $('result-message').textContent = '暂未获取到价格，请重试。';
    } finally {
      if (requestId === state.sequence) { $('result-card').setAttribute('aria-busy', 'false'); state.controller = null; }
    }
  }
  function updateMeasurement() {
    const variant = currentVariant();
    const cloth = variant && !variant.requiresThicknessWeight;
    const flocked = variant?.material.includes('植绒');
    if (flocked && selected('measurementMode') === 'weight') form.querySelector('input[name="measurementMode"][value="thickness"]').checked = true;
    $('weight-mode-option').hidden = Boolean(flocked);
    const mode = selected('measurementMode');
    $('measurement-field').hidden = Boolean(cloth);
    $('thickness-field').hidden = mode !== 'thickness';
    $('weight-field').hidden = mode !== 'weight';
    $('thickness-label').textContent = flocked ? '裸基材厚度' : '原片厚度';
    $('weight-label').textContent = flocked ? '植绒后成品单件克重' : '成品单件克重';
    $('thickness').placeholder = flocked ? '填写裸基材厚度' : '填写原片厚度';
    $('weight').placeholder = flocked ? '植绒后成品净重' : '填写成品单件净重';
    $('measurement-hint').textContent = cloth ? '植布按排版面积计算，无需填写厚度和克重。产品长宽方向固定。' : mode === 'weight' ? (flocked ? '填写植绒后的成品单件净重，不含包装。' : '填写成品单件净重，不含包装；按克重估算用料。') : (flocked ? '可填裸基材厚度；不填时按高度估算，需复核。' : '厚度或克重选填；都不填时按高度估算，需复核。');
    $('mold-hint').textContent = cloth ? '植布默认阴模；如使用阳模，请切换。' : '按模具结构选择；不确定时，先确认模具类型。';
  }
  function updateShape() {
    const shape = $('shape').value;
    const oneDimension = ['circle', 'hexagon'].includes(shape);
    $('width-field').hidden = oneDimension;
    $('width').required = !oneDimension;
    document.querySelector('.dimension-grid').classList.toggle('two-dimensions', oneDimension);
    $('length-label').textContent = ({circle: '直径', hexagon: '对角线', ellipse: '长轴', triangle: '底边'})[shape] || '长度';
    $('width-label').textContent = ({ellipse: '短轴', triangle: '平面高度'})[shape] || '宽度';
    $('shape-summary').textContent = shapeNames[shape];
    $('shape-hint').textContent = ({rectangle: '矩形按外部长宽填写。', circle: '填写圆形外径及成型高度。', ellipse: '填写椭圆长轴、短轴及成型高度。', hexagon: '仅适用于正六边形；对角线为两个相对顶点的距离。', triangle: '底边与平面高度用于计算三角形面积；成型高度填写在第三格。'})[shape];
  }
  function convertUnits() {
    const unit = selected('dimensionUnit');
    if (unit !== state.unit) {
      for (const id of ['length', 'width', 'height']) {
        const el = $(id); const value = el.value.trim();
        if (value && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) el.value = String(Number((Number(value) * (unit === 'mm' ? 10 : .1)).toFixed(8)));
      }
      state.unit = unit;
    }
    document.querySelectorAll('.dimension-unit').forEach(el => el.textContent = unit);
    $('length').placeholder = unit === 'cm' ? '例如 17' : '例如 170';
    $('width').placeholder = $('height').placeholder = unit === 'cm' ? '例如 5.5' : '例如 55';
  }
  function schedule() {
    invalidate();
    if (!validate(currentPayload())) state.timer = setTimeout(() => calculate(), 380);
  }
  form.addEventListener('input', event => {
    if (event.target.matches('input[type="text"]')) schedule();
  });
  form.addEventListener('change', event => {
    const target = event.target;
    if (target.id === 'variant') {
      const material = currentVariant()?.material || '';
      if (material === '植布' && state.previousMaterial !== '植布') $('mold-female').checked = true;
      if (state.previousMaterial === '植布' && material !== '植布') form.querySelectorAll('input[name="moldType"]').forEach(input => input.checked = false);
      state.previousMaterial = material;
      updateMeasurement();
    }
    if (target.name === 'measurementMode') updateMeasurement();
    if (target.name === 'dimensionUnit') convertUnits();
    if (target.id === 'shape') updateShape();
    if (!target.matches('input[type="text"]')) schedule();
  });
  form.addEventListener('submit', event => { event.preventDefault(); calculate(true); });
  numericFields.forEach(id => $(id).addEventListener('focus', event => event.target.select()));
  $('mold-help').addEventListener('click', () => $('mold-dialog').showModal());
  ['close-help', 'understood-help'].forEach(id => $(id).addEventListener('click', () => $('mold-dialog').close()));
  $('mold-dialog').addEventListener('click', event => {
    if (event.target !== $('mold-dialog')) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  });
  $('copy-quote').addEventListener('click', async () => {
    if (!state.quote || !state.payload) return;
    const quote = state.quote, payload = state.payload, requestId = state.sequence;
    const material = variants.get(payload.variantId).label;
    const thicknessLabel = quote.thicknessSource === 'height_estimate' ? '按高度估算厚度' : quote.thicknessSource === 'weight_estimate' ? '按克重反推厚度' : currentVariant().material.includes('植绒') ? '裸基材厚度' : '原片厚度';
    const thicknessText = quote.thicknessSource !== 'not_required' && Number.isFinite(quote.thicknessMm) ? `${thicknessLabel}：${fmt(quote.thicknessMm, 3)} mm（${fmt(quote.thicknessMm * 100, 2)} 丝）` : '按面积报价';
    const measurement = payload.weightG ? `成品单件克重：${payload.weightG} g\n${thicknessText}` : thicknessText;
    const text = ['吸塑定制参考报价', `材料：${material}`, `规格：${shapeNames[payload.shape]}，${describeDimensions(payload)}`, measurement, `模具：${payload.moldType === 'male' ? '阳模' : '阴模'}`, `数量：${fmt(quote.quantity, 0)} 件`, `未税参考单价：¥ ${fmt(quote.untaxedUnitPrice, 4)} / 件`, `含税参考单价：¥ ${fmt(quote.referenceUnitPrice, 4)} / 件`, `含税产品总额：¥ ${fmt(quote.total)}`, `另计费用：${quote.exclusions.join('、')}`, ...quote.notes, `报价时间：${new Date().toLocaleString('zh-CN', {hour12: false})}`].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      if (requestId === state.sequence) $('copy-status').textContent = '报价信息已复制';
    } catch {
      if (requestId === state.sequence) $('copy-status').textContent = '复制未成功，请允许浏览器使用剪贴板后重试';
    }
  });
  async function loadOptions() {
    try {
      const response = await fetch('./api/options');
      if (!response.ok) throw new Error('Options unavailable');
      const options = await response.json();
      if (!Array.isArray(options.variants) || !options.variants.length) throw new Error('No materials');
      $('variant').replaceChildren(new Option('请选择材质与颜色', ''));
      const groups = new Map();
      for (const variant of options.variants) {
        variants.set(variant.variantId, variant);
        if (!groups.has(variant.material)) { const group = document.createElement('optgroup'); group.label = variant.material; groups.set(variant.material, group); $('variant').append(group); }
        groups.get(variant.material).append(new Option(variant.label, variant.variantId));
      }
      state.ready = true; $('variant').disabled = false; $('calculate').disabled = false;
    } catch {
      $('variant').replaceChildren(new Option('材料暂未载入，请刷新重试', ''));
      showError({message: '报价服务未连接成功，请刷新页面重试。'}, false);
    }
  }
  updateMeasurement();
  updateShape();
  loadOptions();
})();

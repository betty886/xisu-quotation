'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const form = $('quote-form');
  const variants = new Map();
  const state = {ready: false, sequence: 0, timer: null, controller: null, quote: null, payload: null, unit: 'cm', previousMaterial: '', designSource: null, pendingDesign: null, formEdited: false, geometryRevision: 0};
  const designHandoffKey = 'xisu.design.handoff.v1';
  const quoteDraftKey = 'xisu.quote.draft.v1';
  const draftFields = ['variant', 'length', 'width', 'height', 'quantity', 'thickness', 'weight', 'shape', 'flock-weight-basis'];
  const draftChoices = {dimensionUnit: ['cm', 'mm'], moldType: ['', 'male', 'female'], measurementMode: ['thickness', 'weight'], taxMode: ['tax', 'untax']};
  const shapeNames = {rectangle: '矩形', circle: '圆形', ellipse: '椭圆形', hexagon: '正六边形', triangle: '三角形'};
  const selected = name => form.querySelector(`input[name="${name}"]:checked`)?.value || '';
  const currentVariant = () => variants.get($('variant').value);
  const fmt = (number, digits = 2) => Number(number).toLocaleString('zh-CN', {minimumFractionDigits: digits, maximumFractionDigits: digits});
  const numericFields = ['length', 'width', 'height', 'quantity', 'thickness', 'weight'];
  const apiFieldIds = {variantId: 'variant', thicknessMm: 'thickness', weightG: 'weight', weightBasis: 'flock-weight-basis', moldType: 'mold-male', length: 'length', width: 'width', height: 'height', quantity: 'quantity', shape: 'shape', taxIncluded: 'tax-label'};

  function designTransferError(message) {
    $('design-transfer-error').textContent = message;
    $('design-transfer-error').hidden = false;
  }
  function saveDraft() {
    if (!state.ready && !state.formEdited) return true;
    const fields = Object.fromEntries(draftFields.map(id => [id, $(id).value]));
    const choices = Object.fromEntries(Object.keys(draftChoices).map(name => [name, selected(name)]));
    try {
      sessionStorage.setItem(quoteDraftKey, JSON.stringify({version: 1, created_at: Date.now(), fields, choices, design_source: state.designSource}));
      return true;
    } catch {return false;}
  }
  function restoreDraft() {
    if (state.formEdited) return null;
    try {
      const raw = sessionStorage.getItem(quoteDraftKey);
      if (!raw) return null;
      if (raw.length > 18000) throw new Error('Oversize draft');
      const draft = JSON.parse(raw);
      if (!draft || draft.version !== 1 || typeof draft.created_at !== 'number' || Date.now() - draft.created_at > 12 * 60 * 60 * 1000 || draft.created_at > Date.now() + 60000 || !draft.fields || !draft.choices) throw new Error('Invalid draft');
      if (!draftFields.every(id => typeof draft.fields[id] === 'string' && draft.fields[id].length <= 160) || !Object.entries(draftChoices).every(([name, values]) => values.includes(draft.choices[name])) || !Object.hasOwn(shapeNames, draft.fields.shape) || (draft.fields.variant && !variants.has(draft.fields.variant)) || !['', 'finished', 'substrate'].includes(draft.fields['flock-weight-basis'])) throw new Error('Invalid draft fields');
      for (const id of draftFields) $(id).value = draft.fields[id];
      for (const name of Object.keys(draftChoices)) form.querySelectorAll(`input[name="${name}"]`).forEach(element => {element.checked = element.value === draft.choices[name];});
      state.unit = draft.choices.dimensionUnit;
      updateMeasurement(); updateShape(); convertUnits();
      return draft.design_source || null;
    } catch {
      try {sessionStorage.removeItem(quoteDraftKey);} catch {}
      return null;
    }
  }
  function handoffValid(value, maxAge = 30 * 60 * 1000) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.schema_version !== '1.0' || value.accepted !== true || typeof value.created_at !== 'number' || !Number.isFinite(value.created_at) || Date.now() - value.created_at > maxAge || value.created_at > Date.now() + 60000) return false;
    const request = value.request, dims = value.quote_dimensions;
    if (!request || typeof request !== 'object' || Array.isArray(request) || !request.product || typeof request.product !== 'object' || !['rectangle', 'circle'].includes(request.product.shape) || !['mm', 'cm'].includes(request.product.unit) || !dims || !['rectangle', 'circle'].includes(dims.shape) || dims.shape !== request.product.shape) return false;
    if (![dims.length_cm, dims.width_cm, dims.height_cm].every(number => typeof number === 'number' && Number.isFinite(number) && number > 0 && number <= 1000) || (dims.shape === 'circle' && dims.width_cm !== dims.length_cm) || ![null, 'male', 'female'].includes(value.mold_type)) return false;
    return JSON.stringify(request).length <= 8192;
  }
  async function verifyDesign(handoff, maxAge) {
    if (!handoffValid(handoff, maxAge)) throw new Error('Invalid handoff');
    const response = await fetch('./api/design', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(handoff.request)});
    const result = await response.json();
    if (!response.ok || result.schema_version !== '1.0' || result.status !== 'pending_review' || result.tooling_release !== false || !result.quote_dimensions || !result.tooling) throw new Error('Design unavailable');
    if (result.quote_dimensions.shape !== handoff.quote_dimensions.shape || !['length_cm', 'width_cm', 'height_cm'].every(key => typeof result.quote_dimensions[key] === 'number' && result.quote_dimensions[key] === handoff.quote_dimensions[key]) || (result.tooling.mold_type || null) !== handoff.mold_type) throw new Error('Design changed');
    return handoff;
  }
  function designDimensionsSummary(handoff) {
    const dims = handoff.quote_dimensions;
    const outline = dims.shape === 'circle' ? `圆形直径 ${fmt(dims.length_cm, 3)}` : `矩形 ${fmt(dims.length_cm, 3)} × ${fmt(dims.width_cm, 3)}`;
    const mold = handoff.mold_type === 'female' ? '阴模' : handoff.mold_type === 'male' ? '阳模' : '模具待确认（报价按材料默认规则试算）';
    return `${outline} × 高 ${fmt(dims.height_cm, 3)} cm；${mold}`;
  }
  function designConflicts(handoff) {
    const dims = handoff.quote_dimensions;
    const hasDimensions = ['length', 'width', 'height'].some(id => $(id).value.trim() !== '');
    if ((hasDimensions || $('shape').value !== 'rectangle') && $('shape').value !== dims.shape) return true;
    const factor = selected('dimensionUnit') === 'mm' ? 0.1 : 1;
    const checks = [['length', 'length_cm'], ['height', 'height_cm'], ...(dims.shape === 'rectangle' ? [['width', 'width_cm']] : [])];
    for (const [id, key] of checks) {
      const value = $(id).value.trim();
      if (value && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || Math.abs(Number(value) * factor - dims[key]) > 1e-8)) return true;
    }
    return Boolean(selected('moldType') && selected('moldType') !== (handoff.mold_type || ''));
  }
  function detachDesign() {
    state.designSource = null;
    $('design-source').hidden = true;
    $('design-source-detail').textContent = '';
  }
  function attachDesign(handoff) {
    state.designSource = handoff;
    $('design-source-detail').textContent = `${designDimensionsSummary(handoff)}。${handoff.request.design?.quote_height_mm != null ? '报价高度采用填写的实际成型外高。' : '报价高度暂按净腔深度，仍需实测外高。'}`;
    $('design-source').hidden = false;
  }
  function updateConflictSummary() {
    if (!state.pendingDesign) return;
    const mold = selected('moldType');
    $('design-current-summary').textContent = `${shapeNames[$('shape').value]}，${describeDimensions(currentPayload())}；${mold === 'male' ? '阳模' : mold === 'female' ? '阴模' : '模具未填写'}`;
    $('design-incoming-summary').textContent = designDimensionsSummary(state.pendingDesign);
  }
  function applyDesign(handoff) {
    if (!handoffValid(handoff)) {
      state.pendingDesign = null;
      $('design-conflict').hidden = true;
      designTransferError('本次尺寸方案已过期，未替换现有填写。请返回尺寸设计页重新计算并确认。');
      return;
    }
    const dims = handoff.quote_dimensions;
    $('shape').value = dims.shape;
    form.querySelectorAll('input[name="dimensionUnit"]').forEach(element => {element.checked = element.value === 'cm';});
    state.unit = 'cm';
    $('length').value = String(dims.length_cm);
    $('width').value = String(dims.width_cm);
    $('height').value = String(dims.height_cm);
    form.querySelectorAll('input[name="moldType"]').forEach(element => {element.checked = element.value === handoff.mold_type;});
    updateShape(); convertUnits();
    state.pendingDesign = null;
    $('design-conflict').hidden = true;
    $('design-transfer-error').hidden = true;
    attachDesign(handoff);
    saveDraft();
    schedule();
  }
  async function receiveDesign(restoredSource) {
    let raw;
    try {raw = sessionStorage.getItem(designHandoffKey); sessionStorage.removeItem(designHandoffKey);} catch {}
    if (restoredSource) {
      const geometryRevision = state.geometryRevision;
      try {
        const handoff = await verifyDesign(restoredSource, 12 * 60 * 60 * 1000);
        if (!designConflicts(handoff) && state.geometryRevision === geometryRevision) {attachDesign(handoff); saveDraft();}
      } catch {
        detachDesign();
        designTransferError('上次尺寸设计关联已过期或无法核验。当前填写已保留；请核对尺寸，或重新设计后再确认报价。');
      }
    }
    if (!raw) return;
    try {
      if (raw.length > 14000) throw new Error('Oversize handoff');
      const handoff = await verifyDesign(JSON.parse(raw));
      if (designConflicts(handoff)) {
        state.pendingDesign = handoff;
        updateConflictSummary();
        $('design-conflict').hidden = false;
      } else applyDesign(handoff);
    } catch {
      designTransferError('本次尺寸方案已过期、被改动或无法核验，未带入报价。请返回尺寸设计页重新计算并确认；现有填写已保留。');
    }
  }

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
    $('breakdown').hidden = true;
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
      ...(selected('moldType') ? {moldType: selected('moldType')} : {}),
      shape: $('shape').value,
      taxIncluded: selected('taxMode') !== 'untax'
    };
    if (!['circle', 'hexagon'].includes(payload.shape)) payload.width = $('width').value.trim();
    if (currentVariant()?.requiresThicknessWeight) {
      if (selected('measurementMode') === 'weight') {
        payload.weightG = $('weight').value.trim();
        if (currentVariant().material.includes('植绒') && payload.weightG) payload.weightBasis = $('flock-weight-basis').value;
      }
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
    if (currentVariant().material.includes('植绒') && payload.weightG && !['finished', 'substrate'].includes(payload.weightBasis)) return {field: 'weightBasis', message: '请选择植绒克重的称重阶段。'};
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
    const taxed = payload.taxIncluded !== false;
    $('unit-price').textContent = fmt(quote.referenceUnitPrice, 4);
    $('untaxed-unit-price').textContent = fmt(quote.untaxedUnitPrice, 4);
    $('total-price').textContent = `¥ ${fmt(taxed ? quote.total : quote.untaxedTotal)}`;
    $('total-label').textContent = `${fmt(quote.quantity, 0)} 件 · ${taxed ? '含税' : '未税'}产品金额`;
    $('quote-status').textContent = quote.reviewLabel || '参考报价';
    $('untaxed-option').classList.toggle('is-selected', !taxed);
    $('taxed-option').classList.toggle('is-selected', taxed);
    const estimate = Number.isFinite(quote.thicknessMm) ? `${fmt(quote.thicknessMm, 3)} mm（${fmt(quote.thicknessMm * 100, 2)} 丝）` : '';
    $('result-message').textContent = quote.thicknessSource === 'weight_estimate' ? `${currentVariant().material.includes('植绒') && payload.weightBasis === 'finished' ? '按成品克重估算等效厚度（非裸基材厚度）' : currentVariant().material.includes('植绒') ? '按裸片克重估算裸基材厚度' : '按克重反推厚度'}：${estimate}，打样后复核。` : quote.thicknessSource === 'height_estimate' ? `按高度估算厚度：${estimate}，打样后复核。` : '按本次规格计算，请核对参考参数。';
    if (Number.isFinite(quote.flockPricePerKg) && Number.isFinite(quote.flockDensity)) $('result-message').textContent += ` 植绒比重 ${fmt(quote.flockDensity, 6)}，材料单价 ${fmt(quote.flockPricePerKg, 4)} 元/kg。`;
    $('spec-summary').replaceChildren();
    addSummaryRow('材料', variants.get(payload.variantId).label);
    if (Number.isFinite(quote.flockPricePerKg) && Number.isFinite(quote.flockDensity)) { addSummaryRow('植绒比重', fmt(quote.flockDensity, 6)); addSummaryRow('植绒材料单价', `${fmt(quote.flockPricePerKg, 4)} 元/kg`); }
    addSummaryRow(shapeNames[payload.shape], describeDimensions(payload));
    if (state.designSource) addSummaryRow('尺寸来源', '按产品推算，待样品确认；采用吸塑裁切外形');
    if (payload.weightG) addSummaryRow(payload.weightBasis === 'substrate' ? '植绒前裸片单件克重' : payload.weightBasis === 'finished' ? '植绒后成品单件克重' : '成品单件克重', `${payload.weightG} g`);
    if (quote.thicknessSource !== 'not_required' && Number.isFinite(quote.thicknessMm)) {
      const label = quote.thicknessSource === 'height_estimate' ? '按高度估算厚度' : quote.thicknessSource === 'weight_estimate' ? (currentVariant().material.includes('植绒') ? (payload.weightBasis === 'finished' ? '成品克重估算的等效厚度（非裸基材厚度）' : '裸片克重估算裸基材厚度') : '按克重反推厚度') : currentVariant().material.includes('植绒') ? '裸基材厚度' : '原片厚度';
      addSummaryRow(label, `${fmt(quote.thicknessMm, 3)} mm（${fmt(quote.thicknessMm * 100, 2)} 丝）`);
    }
    const moldName = quote.moldType === 'female' ? '阴模' : '阳模';
    addSummaryRow('模具', `${moldName}${quote.moldDefaulted ? `（未填写，按${moldName}）` : ''}`);
    renderBreakdown(quote);
    $('spec-summary').hidden = false;
    $('result-notes').replaceChildren(...[...(state.designSource ? ['按产品推算，待样品确认。报价采用吸塑裁切外形，高度仍需按成型实物复核。'] : []), ...quote.notes].map(paragraph));
    $('copy-quote').disabled = false;
    $('quote-announcement').textContent = `未税参考价每件 ${fmt(quote.untaxedUnitPrice, 4)} 元，含税参考价每件 ${fmt(quote.referenceUnitPrice, 4)} 元，总金额 ${fmt(quote.total)} 元。`;
  }
  function fillRows(element, rows) {
    element.replaceChildren();
    for (const [label, value] of rows) {
      const row = document.createElement('div'); row.className = 'summary-row';
      const name = document.createElement('span'); name.textContent = label;
      const content = document.createElement('strong'); content.textContent = value;
      row.append(name, content); element.append(row);
    }
  }
  function renderBreakdown(quote) {
    const layout = quote.layout, sheet = quote.perSheet, piece = quote.perPiece;
    if (!layout || !sheet || !piece) { $('breakdown').hidden = true; return; }
    const layoutRows = [
      ['采用方向', layout.orientation],
      ['横排 × 纵排', `${layout.columns} × ${layout.rows}`],
      ['穴数', `${layout.theoreticalCavities} 穴`],
      ['单穴占位', `${fmt(layout.occupiedLengthCm, 2)} × ${fmt(layout.occupiedWidthCm, 2)} cm`],
      ['片材', `${fmt(layout.sheetLengthCm, 2)} × ${fmt(layout.sheetWidthCm, 2)} cm`]
    ];
    for (const item of layout.alternatives || []) layoutRows.push([item.orientation, `${item.cavities} 穴，${fmt(item.sheetLengthCm, 1)} × ${fmt(item.sheetWidthCm, 1)} cm`]);
    fillRows($('layout-summary'), layoutRows);
    const sheetRows = [
      ['单张材料费', `¥ ${fmt(sheet.materialCost, 4)}`],
      ['单张加工费', `¥ ${fmt(sheet.processingCost, 2)}（起步 ${fmt(sheet.processingBase, 2)} + 档差 ${fmt(sheet.processingIncrement, 2)}）`],
      ['计价张数', fmt(sheet.pricingSheets, 4)],
      ['小单张数 / 小单费', `${fmt(sheet.smallOrderSheets, 4)} 张 / ¥ ${fmt(sheet.smallOrderFee, 2)}`]
    ];
    if (Number.isFinite(sheet.weightKg)) sheetRows.splice(1, 0, ['单张片重', `${fmt(sheet.weightKg, 4)} kg`]);
    fillRows($('sheet-summary'), sheetRows);
    fillRows($('piece-summary'), [
      ['材料', `¥ ${fmt(piece.material, 4)}`],
      ['加工', `¥ ${fmt(piece.processing, 4)}`],
      ['小单分摊', `¥ ${fmt(piece.smallOrder, 4)}`],
      ['取整前未税 / 含税', `¥ ${fmt(piece.rawUntaxed, 6)} / ¥ ${fmt(piece.rawTaxed, 6)}`],
      ['报价未税 / 含税', `¥ ${fmt(piece.untaxedUnit, 4)} / ¥ ${fmt(piece.taxedUnit, 4)}`]
    ]);
    $('breakdown').hidden = false;
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
    const mode = selected('measurementMode');
    $('weight-mode-option').hidden = false;
    $('flock-weight-basis-field').hidden = !(flocked && mode === 'weight');
    $('measurement-field').hidden = Boolean(cloth);
    $('thickness-field').hidden = mode !== 'thickness';
    $('weight-field').hidden = mode !== 'weight';
    $('thickness-label').textContent = flocked ? '裸基材厚度' : '原片厚度';
    $('weight-label').textContent = flocked ? '植绒单件克重' : '成品单件克重';
    $('thickness').placeholder = flocked ? '填写裸基材厚度' : '填写原片厚度';
    $('weight').placeholder = flocked ? '填写单件净重' : '填写成品单件净重';
    $('measurement-hint').textContent = cloth ? '植布按排版面积计算，无需填写厚度和克重。产品长宽方向固定，不旋转。' : mode === 'weight' ? (flocked ? '选择称重阶段。成品克重按植绒比重估算等效厚度，会反映胶水与绒的增重；裸片克重按裸基材比重，不扣减增重。' : '填写成品单件净重，不含包装；按克重反推厚度，不归整到 5 丝。') : (flocked ? '所填厚度是裸基材厚度。植绒按材料加颜色的参考单价和比重报价，未知组合会报错。' : '厚度或克重选填；都不填时按高度估算到最近 5 丝，需复核。');
    $('mold-hint').textContent = cloth ? '植布不选模具时按阴模做初步报价，并标为待复核。阴模总出血 1 cm，不加高度，不旋转。' : '不选时按阳模做初步报价，并标为待复核。阴模默认总出血 1 cm，不加高度。';
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
    state.formEdited = true;
    if (['length', 'width', 'height'].includes(event.target.id)) {state.geometryRevision++; detachDesign();}
    if (event.target.matches('input[type="text"]')) schedule();
    updateConflictSummary(); saveDraft();
  });
  form.addEventListener('change', event => {
    const target = event.target;
    state.formEdited = true;
    if (['length', 'width', 'height', 'shape'].includes(target.id) || ['moldType', 'dimensionUnit'].includes(target.name)) {state.geometryRevision++; detachDesign();}
    if (target.id === 'variant') {
      state.previousMaterial = currentVariant()?.material || '';
      updateMeasurement();
    }
    if (target.name === 'measurementMode') updateMeasurement();
    if (target.name === 'dimensionUnit') convertUnits();
    if (target.id === 'shape') updateShape();
    if (!target.matches('input[type="text"]')) schedule();
    updateConflictSummary(); saveDraft();
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
    const thicknessLabel = quote.thicknessSource === 'height_estimate' ? '按高度估算厚度' : quote.thicknessSource === 'weight_estimate' ? (currentVariant().material.includes('植绒') ? (payload.weightBasis === 'finished' ? '成品克重估算的等效厚度（非裸基材厚度）' : '裸片克重估算裸基材厚度') : '按克重反推厚度') : currentVariant().material.includes('植绒') ? '裸基材厚度' : '原片厚度';
    const thicknessText = quote.thicknessSource !== 'not_required' && Number.isFinite(quote.thicknessMm) ? `${thicknessLabel}：${fmt(quote.thicknessMm, 3)} mm（${fmt(quote.thicknessMm * 100, 2)} 丝）` : '按面积报价';
    const weightLabel = payload.weightBasis === 'substrate' ? '植绒前裸片单件克重' : payload.weightBasis === 'finished' ? '植绒后成品单件克重' : '成品单件克重';
    const measurement = payload.weightG ? `${weightLabel}：${payload.weightG} g\n${thicknessText}` : thicknessText;
    const layoutLine = quote.layout ? `排版：${quote.layout.orientation}，${quote.layout.columns}×${quote.layout.rows}，${quote.layout.theoreticalCavities} 穴，片材 ${fmt(quote.layout.sheetLengthCm, 2)}×${fmt(quote.layout.sheetWidthCm, 2)} cm` : '';
    const copiedMold = quote.moldType === 'female' ? '阴模' : '阳模';
    const text = ['吸塑定制参考报价', quote.reviewLabel, state.designSource ? '尺寸来源：按产品推算，待样品确认；采用吸塑裁切外形，成型外高待复核。' : '', `材料：${material}`, `规格：${shapeNames[payload.shape]}，${describeDimensions(payload)}`, measurement, `模具：${copiedMold}${quote.moldDefaulted ? `（未填写，按${copiedMold}）` : ''}`, layoutLine, `数量：${fmt(quote.quantity, 0)} 件`, `未税参考单价：¥ ${fmt(quote.untaxedUnitPrice, 4)} / 件`, `含税参考单价：¥ ${fmt(quote.referenceUnitPrice, 4)} / 件`, `${payload.taxIncluded === false ? '未税' : '含税'}产品总额：¥ ${fmt(payload.taxIncluded === false ? quote.untaxedTotal : quote.total)}`, `另计费用：${quote.exclusions.join('、')}`, ...quote.notes, `报价时间：${new Date().toLocaleString('zh-CN', {hour12: false})}`].filter(Boolean).join('\n');
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
      const restoredSource = restoreDraft();
      await receiveDesign(restoredSource);
      if (!state.pendingDesign && $('design-transfer-error').hidden && !validate(currentPayload())) schedule();
    } catch {
      $('variant').replaceChildren(new Option('材料暂未载入，请刷新重试', ''));
      showError({message: '报价服务未连接成功，请刷新页面重试。'}, false);
    }
  }
  $('logout').addEventListener('click', async () => {
    try {sessionStorage.removeItem(quoteDraftKey); sessionStorage.removeItem(designHandoffKey);} catch {}
    await fetch('./api/logout', {method: 'POST'}).catch(() => {});
    location.replace('./');
  });
  $('design-entry').addEventListener('click', event => {
    if (!saveDraft()) {event.preventDefault(); designTransferError('浏览器未能保存现有填写，尚未离开报价页。请允许本站会话存储后重试。');}
  });
  $('design-apply-replacement').addEventListener('click', () => {if (state.pendingDesign) applyDesign(state.pendingDesign);});
  $('design-keep-existing').addEventListener('click', () => {state.pendingDesign = null; $('design-conflict').hidden = true; saveDraft(); if (!validate(currentPayload())) schedule();});
  updateMeasurement();
  updateShape();
  loadOptions();
})();

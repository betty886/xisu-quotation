'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const form = $('design-form');
  const handoffKey = 'xisu.design.handoff.v1';
  const schemaVersion = '1.0';
  const state = {unit: 'mm', sequence: 0, controller: null, result: null, request: null};
  const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const format = (value, digits = 3) => Number(value).toLocaleString('zh-CN', {minimumFractionDigits: digits, maximumFractionDigits: digits});
  const textValue = id => $(id).value.trim();
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const pair = (value, circle, digits = 3) => circle && Math.abs(value.length - value.width) < 1e-9 ? `直径 ${format(value.length, digits)} mm` : circle ? `长向 ${format(value.length, digits)} × 宽向 ${format(value.width, digits)} mm` : `${format(value.length, digits)} × ${format(value.width, digits)} mm`;

  function error(message) {
    $('design-error').textContent = message;
    $('design-error').hidden = false;
  }
  function invalidate() {
    state.sequence++;
    state.controller?.abort();
    state.controller = null;
    state.result = null;
    state.request = null;
    $('design-accept').checked = false;
    $('design-accept').disabled = true;
    $('design-transfer').disabled = true;
    $('design-error').hidden = true;
    $('design-status').textContent = '输入已变更，请重新计算';
    $('design-result-message').textContent = '当前输入尚未计算；重新计算后才可带入报价。';
    for (const id of ['design-product', 'design-bottom', 'design-opening', 'design-depth', 'design-trim', 'design-quote-dimensions']) $(id).textContent = '—';
    $('design-mold').textContent = '尚未计算。参数不全时显示缺项，不生成模具尺寸。';
    $('design-contact').replaceChildren();
    $('design-diagram').hidden = true;
    $('design-review-lists').hidden = true;
    $('design-result').setAttribute('aria-busy', 'false');
    $('design-calculate').disabled = false;
    try {sessionStorage.removeItem(handoffKey);} catch {}
  }
  function appendOptional(object, key, id) {
    const value = textValue(id);
    if (value !== '') object[key] = value;
  }
  function percent(id) {
    const value = textValue(id);
    if (value === '') return undefined;
    if (!numberPattern.test(value) || !Number.isFinite(Number(value))) throw new Error('收缩率请填写有效百分数，例如 0.5 表示 0.5%。');
    return Number(value) / 100;
  }
  function buildRequest() {
    const shape = $('product-shape').value;
    const product = {shape, unit: $('product-unit').value, length: textValue('product-length'), height: textValue('product-height'), dimensions_are_maximum: $('product-maximum').checked};
    if (shape === 'rectangle') product.width = textValue('product-width');
    appendOptional(product, 'source', 'product-source');
    const design = {};
    // Unchanged software starting values remain defaults in the calculation's provenance.
    for (const [key, id, initial] of [['clearance_per_side_mm', 'clearance', '1'], ['draft_angle_deg', 'draft-angle', '3'], ['rim_to_trim_mm', 'rim', '8']]) {
      if (textValue(id) !== initial) appendOptional(design, key, id);
    }
    for (const [key, id] of [['pocket_depth_mm', 'pocket-depth'], ['forming_negative_tolerance_mm', 'negative-tolerance'], ['quote_height_mm', 'quote-height']]) appendOptional(design, key, id);
    const lining = {type: $('lining-type').value};
    if (lining.type !== 'none') {
      for (const [key, id] of [['bottom_offset_mm', 'lining-bottom'], ['opening_offset_mm', 'lining-opening'], ['depth_offset_mm', 'lining-depth'], ['source', 'lining-source']]) appendOptional(lining, key, id);
    }
    const tooling = {};
    appendOptional(tooling, 'mold_type', 'design-mold-type');
    appendOptional(tooling, 'source', 'tooling-source');
    if (tooling.mold_type === 'female') {
      for (const [key, id] of [['bottom_offset_mm', 'mold-bottom'], ['opening_offset_mm', 'mold-opening'], ['depth_offset_mm', 'mold-depth']]) appendOptional(tooling, key, id);
    }
    if ($('shrinkage-mode').value === 'uniform') {
      const shrinkage = percent('shrinkage-percent');
      if (shrinkage !== undefined) tooling.shrinkage_fraction = shrinkage;
    } else {
      const shrinkage = {};
      for (const axis of ['length', 'width', 'height']) {
        const value = percent('shrinkage-' + axis);
        if (value !== undefined) shrinkage[axis] = value;
      }
      if (Object.keys(shrinkage).length) tooling.shrinkage_fraction = shrinkage;
    }
    return {product, design, lining, tooling, fit_mode: 'loose'};
  }
  function updateControls() {
    const circle = $('product-shape').value === 'circle';
    $('product-width-field').hidden = circle;
    $('product-width').required = !circle;
    $('product-length-label').textContent = circle ? '最大直径' : '最大长度';
    document.querySelector('.design-product-dimensions').classList.toggle('two-dimensions', circle);
    $('lining-offsets').hidden = $('lining-type').value === 'none';
    $('mold-offsets').hidden = $('design-mold-type').value !== 'female';
    const axes = $('shrinkage-mode').value === 'axes';
    $('shrinkage-uniform').hidden = axes;
    $('shrinkage-axes').hidden = !axes;
  }
  function convertProductUnits() {
    const unit = $('product-unit').value;
    if (unit !== state.unit) {
      for (const id of ['product-length', 'product-width', 'product-height']) {
        const value = textValue(id);
        if (numberPattern.test(value) && Number.isFinite(Number(value))) $(id).value = String(Number((Number(value) * (unit === 'mm' ? 10 : 0.1)).toFixed(8)));
      }
      state.unit = unit;
    }
    document.querySelectorAll('.product-unit').forEach(element => {element.textContent = unit;});
    $('product-length').placeholder = unit === 'mm' ? '例如 100' : '例如 10';
    $('product-width').placeholder = unit === 'mm' ? '例如 60' : '例如 6';
    $('product-height').placeholder = unit === 'mm' ? '例如 20' : '例如 2';
  }
  const missingNames = {
    'tooling.mold_type': '阴模或阳模类型',
    'tooling.shrinkage_fraction': '收缩系数',
    'tooling.shrinkage_fraction.length': '长度方向收缩系数',
    'tooling.shrinkage_fraction.width': '宽度方向收缩系数',
    'tooling.shrinkage_fraction.height': '深度方向收缩系数',
    'tooling.bottom_offset_mm': '阴模底部单侧有效偏置',
    'tooling.opening_offset_mm': '阴模开口单侧有效偏置',
    'tooling.depth_offset_mm': '阴模净深有效差',
    'tooling.source': '模具偏置与收缩依据',
    'lining.bottom_offset_mm': '覆层底部单侧有效偏置',
    'lining.opening_offset_mm': '覆层开口单侧有效偏置',
    'lining.depth_offset_mm': '覆层净深有效差',
    'lining.source': '覆层偏置依据'
  };
  const readableNames = {
    ...missingNames,
    'product.dimensions_are_maximum': '产品是否已按最大包络测量', 'product.source': '产品尺寸来源',
    'product.shape': '产品包络形状', 'product.unit': '产品尺寸单位', 'product.length': '产品长度或直径', 'product.width': '产品宽度', 'product.height': '产品高度',
    'design.clearance_per_side_mm': '每侧装入间隙', 'design.draft_angle_deg': '净腔拔模角', 'design.rim_to_trim_mm': '净口到裁切线距离',
    'design.pocket_depth_mm': '使用净腔深度', 'design.forming_negative_tolerance_mm': '底部成型负公差补偿', 'design.quote_height_mm': '报价成型外高',
    'clearance_per_side_mm': '每侧装入间隙', 'draft_angle_deg': '净腔拔模角', 'rim_to_trim_mm': '净口到裁切线距离',
    'pocket_depth_mm': '使用净腔深度', 'forming_negative_tolerance_mm': '底部成型负公差补偿', 'quote_height_mm': '报价成型外高',
    'lining.type': '覆层类型', 'fit_mode': '装入配合方式', 'tooling_release=false': '不放行加工'
  };
  function readable(value) {
    let result = String(value);
    for (const [technical, label] of Object.entries(readableNames).sort((a, b) => b[0].length - a[0].length)) result = result.split(technical).join(label);
    return result;
  }
  function list(element, values) {
    element.replaceChildren(...values.map(value => {const item = document.createElement('li'); item.textContent = readable(value); return item;}));
  }
  function renderDiagram(geometry, circle) {
    const svg = $('design-diagram-svg');
    svg.replaceChildren();
    const add = (name, attributes, content) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
      if (content) element.textContent = content;
      svg.append(element);
      return element;
    };
    const label = (x, y, content, attributes = {}) => add('text', {x, y, fill: '#536879', 'font-size': 12, 'text-anchor': 'middle', ...attributes}, content);
    add('title', {}, '吸塑尺寸俯视图与长向剖面；理想尖角示意，非加工图');
    label(180, 18, '俯视：逐层包络');
    const scale = Math.min(292 / geometry.trim_outer_mm.length, 112 / geometry.trim_outer_mm.width);
    for (const [feature, stroke, fill, dashed] of [
      [geometry.trim_outer_mm, '#086887', '#e4f4f8', false],
      [geometry.cavity_opening_mm, '#537766', '#edf4f0', false],
      [geometry.cavity_bottom_mm, '#627eab', '#ffffff', false],
      [geometry.product_mm, '#a7772c', '#fff4dc', true]
    ]) {
      const width = feature.length * scale, height = feature.width * scale;
      const attributes = {stroke, fill, 'stroke-width': 1.5, ...(dashed ? {'stroke-dasharray': '4 3'} : {})};
      if (circle) add('ellipse', {...attributes, cx: 180, cy: 85, rx: width / 2, ry: height / 2});
      else add('rect', {...attributes, x: 180 - width / 2, y: 85 - height / 2, width, height});
    }
    label(180, 160, circle ? '同心轮廓按直径绘制' : '外框为裁切线，内框为对应净腔特征');
    add('line', {x1: 16, y1: 177, x2: 344, y2: 177, stroke: '#d7e1e8'});
    label(180, 198, '长向剖面：产品从上方放入');
    const sectionScale = Math.min(282 / geometry.trim_outer_mm.length, 88 / Math.max(geometry.pocket_depth_mm, geometry.product_mm.height));
    const bottomY = 301, openingY = bottomY - geometry.pocket_depth_mm * sectionScale;
    const left = length => 180 - length * sectionScale / 2;
    const right = length => 180 + length * sectionScale / 2;
    const trim = geometry.trim_outer_mm.length, opening = geometry.cavity_opening_mm.length, bottom = geometry.cavity_bottom_mm.length;
    add('polyline', {points: `${left(trim)},${openingY} ${left(opening)},${openingY} ${left(bottom)},${bottomY} ${right(bottom)},${bottomY} ${right(opening)},${openingY} ${right(trim)},${openingY}`, fill: 'none', stroke: '#086887', 'stroke-width': 2});
    add('line', {x1: left(opening), y1: openingY, x2: right(opening), y2: openingY, stroke: '#537766', 'stroke-width': 1.2, 'stroke-dasharray': '4 3'});
    add('line', {x1: left(bottom), y1: bottomY, x2: right(bottom), y2: bottomY, stroke: '#627eab', 'stroke-width': 2.5});
    add('rect', {x: left(geometry.product_mm.length), y: bottomY - geometry.product_mm.height * sectionScale, width: geometry.product_mm.length * sectionScale, height: geometry.product_mm.height * sectionScale, fill: '#fff4dc', 'fill-opacity': 0.65, stroke: '#a7772c', 'stroke-dasharray': '4 3'});
    add('line', {x1: 334, y1: openingY, x2: 334, y2: bottomY, stroke: '#536879'});
    for (const y of [openingY, bottomY]) add('line', {x1: 329, y1: y, x2: 339, y2: y, stroke: '#536879'});
    label(180, 326, `净深 ${format(geometry.pocket_depth_mm)} mm · 露出 ${format(geometry.protrusion_mm)} mm`);
    $('design-diagram').hidden = false;
  }
  function describeTooling(feature, circle) {
    return `底部 ${pair(feature.bottom, circle)}；开口 ${pair(feature.opening, circle)}；深度 ${format(feature.depth)} mm。`;
  }
  function resultIsValid(result) {
    if (!result || result.schema_version !== schemaVersion || result.status !== 'pending_review' || result.tooling_release !== false || !result.geometry || !result.tooling) return false;
    const q = result.quote_dimensions;
    return q && ['rectangle', 'circle'].includes(q.shape) && [q.length_cm, q.width_cm, q.height_cm].every(positive) && (q.shape !== 'circle' || q.width_cm === q.length_cm) && ['errors', 'warnings', 'assumptions', 'pending_review'].every(key => Array.isArray(result[key]) && result[key].every(value => typeof value === 'string')) && result.errors.length === 0;
  }
  function render(result, request) {
    const geometry = result.geometry;
    const circle = request.product.shape === 'circle';
    const q = result.quote_dimensions;
    $('design-status').textContent = '初步尺寸 · 待复核';
    $('design-result-message').textContent = '尺寸按理想直壁、尖角包络计算。圆角、装入方式、产品公差与成型效果仍需实物核对。';
    $('design-product').textContent = `${pair(geometry.product_mm, circle)}，高 ${format(geometry.product_mm.height)} mm`;
    $('design-bottom').textContent = pair(geometry.cavity_bottom_mm, circle);
    $('design-opening').textContent = pair(geometry.cavity_opening_mm, circle);
    $('design-depth').textContent = `${format(geometry.pocket_depth_mm)} / ${format(geometry.protrusion_mm)} mm`;
    $('design-trim').textContent = `${pair({length: q.length_cm * 10, width: q.width_cm * 10}, circle, 2)}（向上取至 0.01 mm）`;
    $('design-quote-dimensions').textContent = circle ? `直径 ${format(q.length_cm, 3)} × 高 ${format(q.height_cm, 3)} cm` : `${format(q.length_cm, 3)} × ${format(q.width_cm, 3)} × 高 ${format(q.height_cm, 3)} cm`;
    renderDiagram(geometry, circle);
    const tooling = result.tooling;
    if (tooling.status === 'reference_only' && tooling.mold_mm) {
      $('design-mold').textContent = `工程参考 · ${tooling.mold_type === 'female' ? '阴模' : '阳模'}：${describeTooling(tooling.mold_mm, circle)}仍需试模核准，不可直接加工。`;
    } else {
      $('design-mold').textContent = `模具尺寸 —；缺少：${(tooling.missing || []).map(item => missingNames[item] || item).join('、') || '完整有效的工艺参数'}。补齐后再计算。`;
    }
    $('design-contact').textContent = tooling.contact_mm ? `补偿前稳定接触特征：${describeTooling(tooling.contact_mm, circle)}` : '';
    list($('design-assumptions'), result.assumptions);
    list($('design-pending'), result.pending_review);
    $('design-warnings').replaceChildren(...result.warnings.map(value => {const p = document.createElement('p'); p.textContent = readable(value); return p;}));
    $('design-warnings').hidden = result.warnings.length === 0;
    $('design-review-lists').hidden = false;
    state.result = result;
    state.request = request;
    $('design-accept').disabled = false;
  }
  async function calculate(event) {
    event.preventDefault();
    invalidate();
    const sequence = state.sequence;
    let request;
    try {request = buildRequest();} catch (problem) {error(problem.message); return;}
    const controller = new AbortController();
    state.controller = controller;
    $('design-status').textContent = '正在计算';
    $('design-result').setAttribute('aria-busy', 'true');
    $('design-calculate').disabled = true;
    try {
      const response = await fetch('./api/design', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request), signal: controller.signal});
      const result = await response.json();
      if (sequence !== state.sequence) return;
      if (!response.ok) {
        $('design-status').textContent = '请核对输入';
        error(response.status === 401 ? '登录已失效，请返回报价页重新输入内部口令。' : readable(result.errors?.join('；') || result.error?.message || '暂时不能计算，请核对输入。'));
        return;
      }
      if (!resultIsValid(result)) throw new Error('Unsupported design response');
      render(result, request);
    } catch (problem) {
      if (problem.name === 'AbortError' || sequence !== state.sequence) return;
      $('design-status').textContent = '未取得可用结果';
      error('尺寸计算服务暂不可用，请重新计算。');
    } finally {
      if (sequence === state.sequence) {
        state.controller = null;
        $('design-result').setAttribute('aria-busy', 'false');
        $('design-calculate').disabled = false;
      }
    }
  }
  form.addEventListener('input', () => {invalidate();});
  form.addEventListener('change', event => {
    if (event.target.id === 'product-unit') convertProductUnits();
    updateControls();
    invalidate();
  });
  form.addEventListener('submit', calculate);
  $('design-accept').addEventListener('change', () => {$('design-transfer').disabled = !($('design-accept').checked && state.result && state.request);});
  $('design-transfer').addEventListener('click', () => {
    if (!$('design-accept').checked || !state.result || !state.request || !resultIsValid(state.result)) return;
    const handoff = {version: 1, schema_version: schemaVersion, created_at: Date.now(), accepted: true, request: state.request, quote_dimensions: state.result.quote_dimensions, mold_type: state.result.tooling.mold_type || null};
    try {
      sessionStorage.setItem(handoffKey, JSON.stringify(handoff));
      location.assign('./');
    } catch {
      error('浏览器未能保存本次方案，尚未带入报价。请允许本站会话存储后重试。');
    }
  });
  updateControls();
})();

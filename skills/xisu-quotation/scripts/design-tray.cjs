'use strict';

// A preliminary envelope calculator, not a mold machining release. All internal
// engineering lengths are mm. The existing quotation engine still receives cm.
const SCHEMA_VERSION = '1.0';
const AXES = ['length', 'width'];
const OFFSET_FIELDS = ['bottom_offset_mm', 'opening_offset_mm', 'depth_offset_mm'];
const missing = value => value === undefined || value === null || typeof value === 'string' && value.trim() === '';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function emptyResult(input) {
  return {
    schema_version: SCHEMA_VERSION,
    status: 'pending_review',
    tooling_release: false,
    errors: [],
    warnings: [],
    assumptions: [],
    pending_review: [],
    input,
    parameters: {},
    geometry: null,
    tooling: { status: 'needs_parameters', mold_type: null, contact_mm: null, mold_mm: null, missing: [] },
    quote_dimensions: null
  };
}

function designTray(input) {
  const result = emptyResult(input);
  const { errors, warnings, assumptions, pending_review: review, parameters, tooling: toolResult } = result;
  const addMissing = field => { if (!toolResult.missing.includes(field)) toolResult.missing.push(field); };
  const finish = () => {
    if (errors.length) {
      result.status = 'blocked';
      result.quote_dimensions = null;
      toolResult.status = 'needs_parameters';
      toolResult.mold_mm = null;
    }
    return result;
  };
  const put = (name, value, unit, source, assumed = false) => {
    parameters[name] = { value, unit, source, assumed };
    return value;
  };
  const objectField = (value, field, required = false) => {
    if (missing(value)) {
      if (required) errors.push(`${field} 须为包含产品尺寸的对象。`);
      return {};
    }
    if (!record(value)) {
      errors.push(`${field} 须为 JSON 对象，不能是数组或其他值。`);
      return {};
    }
    return value;
  };
  const sourceField = (value, field) => {
    if (missing(value)) return null;
    if (typeof value !== 'string') {
      errors.push(`${field} 须为说明测量、CAD 或参数依据的文本。`);
      return null;
    }
    return value.trim();
  };
  const numeric = (value, field, { required = false, min = -Infinity, max = Infinity, strictMin = false, strictMax = false } = {}) => {
    if (missing(value)) {
      if (required) errors.push(`${field} 缺失，须填写有效数值。`);
      return null;
    }
    if (!(typeof value === 'number' || typeof value === 'string' && decimal.test(value.trim()))) {
      errors.push(`${field} 须为有限数或严格十进制数字字符串；不能使用布尔值、数组、对象或带单位的文本。`);
      return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
      errors.push(`${field} 须为有限数，数值不能溢出。`);
      return null;
    }
    if ((strictMin ? number <= min : number < min) || (strictMax ? number >= max : number > max)) {
      errors.push(`${field} 超出有效范围${Number.isFinite(min) ? `，应${strictMin ? '大于' : '不小于'} ${min}` : ''}${Number.isFinite(max) ? ` 且${strictMax ? '小于' : '不大于'} ${max}` : ''}。`);
      return null;
    }
    return Object.is(number, -0) ? 0 : number;
  };
  const positive = (value, name) => {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${name} 必须为有限正值；请检查尺寸、有效偏置及计算溢出。`);
      return false;
    }
    return true;
  };

  if (!record(input)) {
    errors.push('输入须为 JSON 对象。');
    return finish();
  }
  const product = objectField(input.product, 'product', true);
  const design = objectField(input.design, 'design');
  const lining = objectField(input.lining, 'lining');
  const tooling = objectField(input.tooling, 'tooling');
  const productSource = sourceField(product.source, 'product.source');
  const liningSource = sourceField(lining.source, 'lining.source');
  const toolingSource = sourceField(tooling.source, 'tooling.source');

  const shape = product.shape;
  if (!['rectangle', 'circle'].includes(shape)) errors.push('product.shape 仅支持 rectangle 或 circle 的规则单腔包络。');
  const unit = product.unit;
  if (!['mm', 'cm'].includes(unit)) errors.push('product.unit 必填，且仅支持 mm 或 cm；不推测产品尺寸单位。');
  put('product_shape', shape ?? null, null, 'product.shape 用户输入');
  put('product_unit', unit ?? null, null, 'product.unit 用户输入');
  const unitScale = unit === 'cm' ? 10 : 1;
  const length = numeric(product.length, 'product.length', { required: true, min: 0, strictMin: true });
  const suppliedWidth = numeric(product.width, 'product.width', { required: shape === 'rectangle', min: 0, strictMin: true });
  const height = numeric(product.height, 'product.height', { required: true, min: 0, strictMin: true });
  if (shape === 'circle' && suppliedWidth !== null && length !== null && suppliedWidth !== length) {
    errors.push('圆形 product.width 如有填写必须与 product.length 直径一致。');
  }
  const width = shape === 'circle' ? length : suppliedWidth;
  const maximum = product.dimensions_are_maximum;
  if (!missing(maximum) && typeof maximum !== 'boolean') errors.push('product.dimensions_are_maximum 须为 true 或 false。');
  put('dimensions_are_maximum', missing(maximum) ? null : maximum, null, 'product.dimensions_are_maximum 用户声明，待实物/CAD核对');
  if (maximum !== true) warnings.push('产品尺寸尚未声明为最大包络：最大包络及产品制造公差未核实，当前仅按所填尺寸试算，装入间隙不能视为已保证。');
  if (!productSource) review.push('补充 product.source，核对产品最大包络、测量方法和产品公差。');

  const fitDefaulted = missing(input.fit_mode);
  const fitMode = fitDefaulted ? 'loose' : input.fit_mode;
  if (fitMode !== 'loose') errors.push('fit_mode 仅支持 loose 放入式配合；卡紧、扣位及其他装配结构需另行工程设计。');
  put('fit_mode', fitMode, null, fitDefaulted ? '软件初步假设：放入式配合' : 'fit_mode 用户输入', fitDefaulted);
  if (fitDefaulted) assumptions.push('未提供 fit_mode，暂按 loose 放入式配合；这是软件初步假设，装入方式待核实。');

  const liningDefaulted = missing(lining.type);
  const liningType = liningDefaulted ? 'none' : lining.type;
  if (!['none', 'flock', 'cloth'].includes(liningType)) errors.push('lining.type 仅支持 none、flock 或 cloth。');
  put('lining_type', liningType, null, liningDefaulted ? '软件初步假设：无覆层' : 'lining.type 用户输入', liningDefaulted);
  if (liningDefaulted) assumptions.push('未提供 lining.type，概念设计暂按 none 无覆层；这是软件初步假设，覆层状态待核实。');
  const moldType = missing(tooling.mold_type) ? null : tooling.mold_type;
  if (moldType !== null && !['male', 'female'].includes(moldType)) errors.push('tooling.mold_type 仅支持 male 或 female。');
  toolResult.mold_type = moldType;
  put('mold_type', moldType, null, moldType === null ? '未知，未提供' : 'tooling.mold_type 用户输入');
  if (moldType === null) addMissing('tooling.mold_type');

  // Validate every supported optional field before selecting process branches.
  // A malformed unused female/lining offset must never disappear silently.
  const liningOffsets = {}, toolingOffsets = {};
  for (const field of OFFSET_FIELDS) {
    liningOffsets[field] = numeric(lining[field], `lining.${field}`);
    toolingOffsets[field] = numeric(tooling[field], `tooling.${field}`);
    put(`lining_${field}`, liningOffsets[field], 'mm', missing(lining[field]) ? '未知，未提供' : liningSource || '用户输入，覆层对应特征偏置来源未提供');
    put(`tooling_${field}`, toolingOffsets[field], 'mm', missing(tooling[field]) ? '未知，未提供' : toolingSource || '用户输入，阴模对应特征偏置来源未提供');
    if (liningType !== 'none' && missing(lining[field])) addMissing(`lining.${field}`);
    if (moldType === 'female' && missing(tooling[field])) addMissing(`tooling.${field}`);
  }
  if (liningType !== 'none' && !liningSource) addMissing('lining.source');
  if (liningType === 'none' && OFFSET_FIELDS.some(field => !missing(lining[field]))) warnings.push('lining.type=none：已填写的覆层偏置已校验，本次无覆层几何不应用这些偏置。');
  if (moldType === 'male' && OFFSET_FIELDS.some(field => !missing(tooling[field]))) warnings.push('tooling.mold_type=male：已填写的阴模特征偏置已校验，阳模接触内表面的计算不应用这些阴模偏置。');

  let shrinkage = null;
  if (missing(tooling.shrinkage_fraction)) {
    addMissing('tooling.shrinkage_fraction');
  } else if (record(tooling.shrinkage_fraction)) {
    shrinkage = {};
    for (const axis of [...AXES, 'height']) {
      const value = tooling.shrinkage_fraction[axis];
      shrinkage[axis] = numeric(value, `tooling.shrinkage_fraction.${axis}`, { min: 0, max: 1, strictMax: true });
      if (missing(value)) addMissing(`tooling.shrinkage_fraction.${axis}`);
    }
  } else {
    const fraction = numeric(tooling.shrinkage_fraction, 'tooling.shrinkage_fraction', { min: 0, max: 1, strictMax: true });
    if (fraction !== null) shrinkage = { length: fraction, width: fraction, height: fraction };
  }
  put('shrinkage_fraction', shrinkage, 'fraction', shrinkage === null ? '未知，未采用零收缩' : toolingSource || '用户输入，收缩测量依据及参考温度未提供');
  if (!toolingSource) review.push('补充 tooling.source，核对有效偏置和按方向测得的稳定收缩、模具参考温度及工艺条件。');

  const productMm = { length: length === null ? null : length * unitScale, width: width === null ? null : width * unitScale, height: height === null ? null : height * unitScale };
  for (const axis of [...AXES, 'height']) {
    if (productMm[axis] !== null) positive(productMm[axis], `product.${axis} 换算后的 mm 尺寸`);
    put(`product_${axis}_mm`, productMm[axis], 'mm', productSource || '用户输入，产品尺寸来源未提供');
  }
  const adopt = (name, fallback, label, options = {}) => {
    const assumed = missing(design[name]);
    const value = assumed ? fallback : numeric(design[name], `design.${name}`, options);
    const parameterUnit = name === 'draft_angle_deg' ? 'deg' : 'mm';
    put(name, value, parameterUnit, assumed ? `软件初步假设：${label}` : `design.${name} 用户输入，待工程复核`, assumed);
    if (assumed) {
      assumptions.push(`${label}（${value === null ? '未知' : value} ${parameterUnit === 'deg' ? '°' : parameterUnit}）为软件初步假设，尚非工厂核准参数。`);
      review.push(`确认 ${name}：${label}。`);
    }
    return value;
  };
  const clearance = adopt('clearance_per_side_mm', 1, '每侧放入间隙', { min: 0 });
  const angle = adopt('draft_angle_deg', 3, '相对脱模方向的直壁拔模角', { min: 0, max: 90, strictMax: true });
  const rim = adopt('rim_to_trim_mm', 8, '完成后使用净开口至裁切线的每侧边宽', { min: 0 });
  const depth = adopt('pocket_depth_mm', productMm.height, '净腔深度暂按产品高度', { min: 0, strictMin: true });
  const tolerance = adopt('forming_negative_tolerance_mm', 0, '整条净腔底尺寸的成型负公差补偿暂用 0，未核准且仅加一次', { min: 0 });
  const quoteHeight = adopt('quote_height_mm', depth, '报价高度暂以净腔深度初步估计，实际成型外高待测', { min: 0, strictMin: true });

  warnings.push('尺寸按规则单腔、理想尖角和直壁包络计算；圆角占位、卡位、局部曲面和装入路径尚未核实。');
  review.push('核对产品最大包络与公差、放入方式、间隙、拔模、圆角占位、露出量及裁切公差。');
  review.push('裁切外形用于初步报价；边料与排版出血由原报价程序另算，不从本设计边宽重复拆减或追加。');
  review.push('所有模具值均为单穴接触特征参考包络；经实物/CAD、材料工艺及试模确认后另行工程放行，本程序始终 tooling_release=false。');
  if (errors.length) return finish();

  const growth = 2 * depth * Math.tan(angle * Math.PI / 180);
  const bottom = {}, opening = {}, trim = {};
  for (const axis of AXES) {
    // The tolerance belongs to the entire bottom dimension, not each side.
    bottom[axis] = productMm[axis] + 2 * clearance + tolerance;
    opening[axis] = bottom[axis] + growth;
    trim[axis] = opening[axis] + 2 * rim;
    positive(bottom[axis], `净腔底 ${axis}`);
    positive(opening[axis], `使用净开口 ${axis}`);
    positive(trim[axis], `裁切外形 ${axis}`);
  }
  positive(depth, '净腔深度');
  positive(quoteHeight, '报价高度');
  if (errors.length) return finish();
  result.geometry = {
    product_mm: productMm,
    cavity_bottom_mm: bottom,
    cavity_opening_mm: opening,
    pocket_depth_mm: depth,
    protrusion_mm: Math.max(0, productMm.height - depth),
    trim_outer_mm: trim,
    quote_height_mm: quoteHeight
  };
  if (result.geometry.protrusion_mm > 0) warnings.push(`产品高于使用净腔，理论露出 ${result.geometry.protrusion_mm} mm；需核实支承位置、覆盖及运输保护要求。`);
  if (liningType !== 'none') warnings.push('覆层偏置是对应虚拟尖角特征的有符号单侧有效补偿；depth_offset_mm 是对应基准净深差，不能以原片厚或任意同高度截面厚度替代。');
  if (moldType === 'female') warnings.push('阴模偏置连接对应的内外表面虚拟尖角特征；depth_offset_mm 是有符号基准净深差，不能直接套用原片厚。');

  const pairOffset = (pair, offset) => offset === null || pair === null ? null : { length: pair.length + 2 * offset, width: pair.width + 2 * offset };
  const addDepth = (value, offset) => offset === null || value === null ? null : value + offset;
  const inner = {
    bottom: pairOffset(bottom, liningType === 'none' ? 0 : liningOffsets.bottom_offset_mm),
    opening: pairOffset(opening, liningType === 'none' ? 0 : liningOffsets.opening_offset_mm),
    depth: addDepth(depth, liningType === 'none' ? 0 : liningOffsets.depth_offset_mm)
  };
  const validateFeatures = (features, label, withinTrim) => {
    for (const feature of ['bottom', 'opening']) {
      if (!features[feature]) continue;
      for (const axis of AXES) {
        const value = features[feature][axis];
        positive(value, `${label} ${feature}.${axis}`);
        if (withinTrim && Number.isFinite(value) && value > trim[axis]) errors.push(`${label} ${feature}.${axis} 超出对应成品裁切线；请增大边宽或核实特征偏置。`);
      }
    }
    if (features.depth !== null) positive(features.depth, `${label} 深度`);
    if (features.bottom && features.opening) {
      for (const axis of AXES) {
        if (features.opening[axis] < features.bottom[axis]) errors.push(`${label} ${axis} 开口小于底部，形成倒扣；此直壁脱模模型不支持。`);
      }
    }
  };
  // Known individual features are validated even when another required offset
  // or shrinkage value is still missing. Missing data cannot hide a known clash.
  validateFeatures(inner, '塑料内表面对应特征', true);
  let contact = null;
  if (moldType === 'male') contact = inner;
  if (moldType === 'female') contact = {
    bottom: pairOffset(inner.bottom, toolingOffsets.bottom_offset_mm),
    opening: pairOffset(inner.opening, toolingOffsets.opening_offset_mm),
    depth: addDepth(inner.depth, toolingOffsets.depth_offset_mm)
  };
  if (contact) validateFeatures(contact, '模具接触目标特征', true);
  if (errors.length) return finish();
  if (contact && contact.bottom && contact.opening && contact.depth !== null) {
    toolResult.contact_mm = contact;
    toolResult.contact_draft_angle_deg = {};
    for (const axis of AXES) toolResult.contact_draft_angle_deg[axis] = Math.atan(((contact.opening[axis] - contact.bottom[axis]) / 2) / contact.depth) * 180 / Math.PI;
  }

  const completeShrinkage = shrinkage && [...AXES, 'height'].every(axis => shrinkage[axis] !== null);
  if (toolResult.missing.length === 0 && toolResult.contact_mm && completeShrinkage) {
    const mold = { bottom: {}, opening: {}, depth: contact.depth / (1 - shrinkage.height) };
    for (const feature of ['bottom', 'opening']) {
      for (const axis of AXES) {
        mold[feature][axis] = contact[feature][axis] / (1 - shrinkage[axis]);
        positive(mold[feature][axis], `收缩补偿后模具 ${feature}.${axis}`);
      }
    }
    positive(mold.depth, '收缩补偿后模具深度');
    if (!errors.length) {
      toolResult.mold_mm = mold;
      toolResult.status = 'reference_only';
      warnings.push('模具参考包络使用 M=D/(1-s)，其中 s=(模具参考温度尺寸−最终稳定接触特征尺寸)/模具参考温度尺寸；它不是铝坯尺寸、CAD/CAM 或加工放行。');
      if (shape === 'circle' && shrinkage.length !== shrinkage.width) warnings.push('圆形产品的 length/width 收缩系数不同，补偿后的单穴模具平面参考包络为椭圆：两方向尺寸分别列示，不能按同一直径的圆模加工；成品裁切和报价仍为圆形。');
    }
  } else {
    warnings.push('必要模具参数或覆层依据尚缺，模具参考尺寸保持未知；未把未知收缩或有效偏置当成 0。');
  }
  if (errors.length) return finish();

  const quoteDimension = (millimetres, axis) => {
    const hundredths = millimetres * 100;
    if (!Number.isFinite(hundredths) || hundredths > Number.MAX_SAFE_INTEGER) {
      errors.push(`裁切 ${axis} 过大，无法安全按 0.01 mm 向上归整报价尺寸。`);
      return null;
    }
    // Eliminate only floating-point noise around an exact hundredth, then ceil.
    const nearest = Math.round(hundredths);
    const normalized = nearest > 0 && Math.abs(hundredths - nearest) <= 4 * Number.EPSILON * Math.max(1, hundredths) ? nearest : hundredths;
    return Math.ceil(normalized) / 1000;
  };
  const quoteLength = quoteDimension(trim.length, 'length');
  const quoteWidth = quoteDimension(trim.width, 'width');
  const quoteHeightCm = quoteHeight / 10;
  positive(quoteHeightCm, '报价 height_cm 换算值');
  if (!errors.length) result.quote_dimensions = { shape, length_cm: quoteLength, width_cm: quoteWidth, height_cm: quoteHeightCm };
  return finish();
}

if (require.main === module) {
  let result;
  try {
    const filename = process.argv[2];
    if (!filename) throw new Error('用法：node scripts/design-tray.cjs 输入.json');
    const input = JSON.parse(require('node:fs').readFileSync(filename, 'utf8'));
    result = designTray(input);
  } catch (error) {
    result = emptyResult(null);
    result.status = 'blocked';
    result.errors.push(error.message);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'blocked') process.exitCode = 2;
}

module.exports = { designTray };

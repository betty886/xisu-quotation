'use strict';

const fs = require('node:fs');
const { estimate } = require('./station-layout.cjs');
const fields = new Set([
  'mode', 'yieldBasis', 'quantity', 'cavities', 'pieceWeight', 'yieldPercent',
  'sheetLengthMm', 'sheetWidthMm', 'thicknessMm', 'density', 'pieceAreaCm2',
  'cycleSeconds', 'shiftHours', 'shiftBilling', 'shiftCost', 'materialPrice', 'scrapPrice',
  'boxCapacity', 'boxPrice', 'loadingCost', 'moldCost', 'otherCost', 'taxPercent', 'targetProfit',
  'sheetSource', 'productLengthMm', 'productWidthMm', 'gapMm', 'edgeMm',
  'layoutMethod', 'layoutOrientation', 'layoutAlongLength', 'layoutAlongWidth',
  'maxMoldLengthMm', 'maxMoldWidthMm', 'preferredMoldLengthMm',
]);

class StationInputError extends Error {}

function quoteStation(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    throw new StationInputError('工位机订单须为 JSON 对象。');
  }
  if (Object.keys(order).some(key => !fields.has(key))) {
    throw new StationInputError('订单包含不支持的工位机字段，请对照填写说明。');
  }

  function read(key, label, { optional = false, positive = false, integer = false, max = 1e9 } = {}) {
    const raw = order[key];
    if (raw == null || (typeof raw === 'string' && !raw.trim())) {
      if (optional) return null;
      throw new StationInputError(`请填写${label}。`);
    }
    const value = typeof raw === 'number' || (typeof raw === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()))
      ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < 0 || value > max || (positive && value === 0) ||
        (integer && !Number.isSafeInteger(value))) {
      throw new StationInputError(`${label}数值无效，请核对单位和填写范围。`);
    }
    return value;
  }

  const positive = { positive: true };
  const count = { ...positive, integer: true };
  const optional = { optional: true };
  const quantity = read('quantity', '订单数量', count);
  const mode = order.mode ?? 'weight';
  const basis = mode === 'weight' ? 'provided' : order.yieldBasis ?? 'measured';
  if (!['weight', 'sheet'].includes(mode) || !['measured', 'projection', 'provided'].includes(basis)) {
    throw new StationInputError('请选择合适的投料方式和成品率依据。');
  }

  const sheetSource = mode === 'sheet' ? order.sheetSource || 'actual' : null;
  if (sheetSource !== null && !['actual', 'layout'].includes(sheetSource)) {
    throw new StationInputError('请选择拉片尺寸来源。');
  }
  let layout = null;
  if (sheetSource === 'layout') {
    try { layout = estimate(order); }
    catch (error) { throw new StationInputError(error.message); }
  }
  const cavities = layout?.cavities ?? read('cavities', '每模件数', count);
  let sheetArea;
  let sheetLengthMm = null;
  let sheetWidthMm = null;
  let inputPerCycle;
  if (mode === 'sheet') {
    sheetLengthMm = layout?.sheetLengthMm ?? read('sheetLengthMm', '拉片长度', positive);
    sheetWidthMm = layout?.sheetWidthMm ?? read('sheetWidthMm', '拉片宽度', positive);
    sheetArea = sheetLengthMm * sheetWidthMm;
    inputPerCycle = sheetArea * read('thicknessMm', '原片厚度', positive) * read('density', '原片比重', positive) / 1000;
  }
  let pieceWeight;
  if (mode === 'weight' || basis === 'measured') pieceWeight = read('pieceWeight', '成品单件克重', positive);
  let yieldRatio;
  if (basis === 'measured') {
    yieldRatio = pieceWeight * cavities / inputPerCycle;
  } else if (basis === 'projection') {
    yieldRatio = read('pieceAreaCm2', '单件裁切投影面积', positive) * 100 * cavities / sheetArea;
  } else {
    yieldRatio = read('yieldPercent', '成品率（0 到 100 之间，不能为 0）', { ...positive, max: 100 }) / 100;
  }
  if (!Number.isFinite(yieldRatio) || yieldRatio <= 0 || yieldRatio > 1 + 1e-12) {
    throw new StationInputError('成品总重或裁切投影超过本模投料，请核对拉片规格、克重和模穴数。');
  }
  yieldRatio = Math.min(yieldRatio, 1);
  if (mode === 'weight') inputPerCycle = pieceWeight * cavities / yieldRatio;
  if (pieceWeight === undefined) pieceWeight = inputPerCycle * yieldRatio / cavities;

  const seconds = read('cycleSeconds', '每模秒数', positive);
  const hours = read('shiftHours', '每班有效工时', { ...positive, max: 24 });
  const dailyCycles = Math.floor(hours * 3600 / seconds);
  const piecesPerShift = dailyCycles * cavities;
  if (dailyCycles < 1 || !Number.isSafeInteger(piecesPerShift)) {
    throw new StationInputError('班次有效产能无效，请核对工时、秒数和每模件数。');
  }
  const billing = order.shiftBilling ?? 'prorated';
  if (!['prorated', 'whole'].includes(billing)) {
    throw new StationInputError('班次费用请选择按工时分摊或按整班计费。');
  }
  const shifts = quantity / piecesPerShift;
  const chargedShifts = billing === 'whole' ? Math.ceil(shifts) : shifts;
  const production = chargedShifts * read('shiftCost', '每班生产费用（无费用时填 0）');
  const inputKg = inputPerCycle * (quantity / cavities) / 1000;
  const scrapKg = Math.max(0, inputKg - quantity * pieceWeight / 1000);
  const materialNet = inputKg * read('materialPrice', '原料单价') -
    scrapKg * read('scrapPrice', '废料回收价（无收入时填 0）');

  const boxCapacity = read('boxCapacity', '每箱件数', { ...count, optional: true });
  const boxPrice = read('boxPrice', '纸箱单价', optional);
  if ((boxCapacity === null) !== (boxPrice === null)) {
    throw new StationInputError('每箱件数和纸箱单价请同时填写。');
  }
  const packaging = boxCapacity === null ? 0 : Math.ceil(quantity / boxCapacity) * boxPrice;
  const loading = read('loadingCost', '整单装运费', optional);
  const mold = read('moldCost', '整单模具费', optional) ?? 0;
  const other = read('otherCost', '整单其他费用', optional) ?? 0;
  const targetProfit = read('targetProfit', '整单目标加价', optional) ?? 0;
  const taxFactor = 1 + read('taxPercent', '税点（未税填 0）', { max: 100 }) / 100;
  const cost = materialNet + production + packaging + (loading ?? 0) + mold + other;
  const quoteBase = Math.max(0, cost + targetProfit) / quantity;
  const roundUp = amount => {
    const scaled = amount * 10000;
    return Math.ceil(scaled - Math.min(1e-8, scaled * Number.EPSILON * 2)) / 10000;
  };
  const untaxedUnitPrice = roundUp(quoteBase);
  const taxedUnitPrice = roundUp(quoteBase * taxFactor);
  const total = unit => Math.round(unit * quantity * 100 + 1e-8) / 100;
  const result = {
    currency: 'CNY', quantity, untaxedUnitPrice, taxedUnitPrice,
    untaxedTotal: total(untaxedUnitPrice), taxedTotal: total(taxedUnitPrice),
    inputKg, yieldPercent: yieldRatio * 100, pieceWeight, piecesPerShift,
    yieldBasis: basis, sheetSource, layout, cavities, sheetLengthMm, sheetWidthMm, loadingIncluded: loading !== null,
  };
  if (Object.values(result).some(v => typeof v === 'number' && !Number.isFinite(v))) {
    throw new StationInputError('数值超出算价范围，请核对单位。');
  }
  return result;
}

if (require.main === module) {
  try {
    const layoutOnly = process.argv[2] === '--layout';
    const offset = layoutOnly ? 3 : 2;
    const input = process.argv[offset];
    if (!input || process.argv.length !== offset + 1) throw new StationInputError('用法：node scripts/station-quote.cjs [--layout] 订单.json；用 - 从标准输入读取。');
    let order;
    try { order = JSON.parse(fs.readFileSync(input === '-' ? 0 : input, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw new StationInputError('请提供有效的 JSON 文件或标准输入。'); }
    if (!order || typeof order !== 'object' || Array.isArray(order)) throw new StationInputError('请提供 JSON 对象。');
    console.log(JSON.stringify(layoutOnly ? estimate(order) : quoteStation(order), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

module.exports = { quoteStation, StationInputError };

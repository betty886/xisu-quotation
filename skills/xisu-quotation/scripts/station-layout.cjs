(function (root) {
  'use strict';

  function estimate(input) {
    const blank = value => value == null || (typeof value === 'string' && !value.trim());
    function read(key, label, { min = Number.MIN_VALUE, integer = false, optional = false } = {}) {
      const raw = input[key];
      if (blank(raw)) {
        if (optional) return null;
        throw new Error(`请填写${label}。`);
      }
      const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(value) || value < min || value > 1000000 ||
          (integer && !Number.isSafeInteger(value))) {
        throw new Error(`${label}数值无效。`);
      }
      return value;
    }

    const partLength = read('productLengthMm', '单件外部长');
    const partWidth = read('productWidthMm', '单件外部宽');
    const gap = read('gapMm', '产品间净距', { min: 0 });
    const edge = read('edgeMm', '模具每边留量', { min: 0 });
    const method = input.layoutMethod ?? 'manual';
    const orientation = input.layoutOrientation ?? 'fixed';
    if (!['manual', 'auto'].includes(method) || !['fixed', 'compare'].includes(orientation)) {
      throw new Error('请核对排模方式和产品方向。');
    }
    const maxLength = read('maxMoldLengthMm', '设备允许的模具最大长', { optional: method === 'manual' });
    const maxWidth = read('maxMoldWidthMm', '设备允许的模具最大宽', { optional: method === 'manual' });
    if ((maxLength === null) !== (maxWidth === null)) {
      throw new Error('设备允许的模具最大长、宽请一起填写。');
    }
    const preferredLength = method === 'auto'
      ? read('preferredMoldLengthMm', '常规模具长度上限', { optional: true }) : null;
    const lengthLimit = preferredLength === null ? maxLength : Math.min(maxLength, preferredLength);
    const alongLength = method === 'manual' ? read('layoutAlongLength', '模具长向件数', { integer: true }) : null;
    const alongWidth = method === 'manual' ? read('layoutAlongWidth', '模具宽向件数', { integer: true }) : null;

    const extent = (count, size) => count * size + (count - 1) * gap + 2 * edge;
    const tolerance = limit => Math.max(1, limit) * Number.EPSILON * 16;
    const capacity = (limit, size) => {
      const ratio = (limit - 2 * edge + gap) / (size + gap);
      return Math.floor(ratio + tolerance(Math.abs(ratio)));
    };
    const candidates = [];
    for (const rotated of orientation === 'compare' ? [false, true] : [false]) {
      const [length, width] = rotated ? [partWidth, partLength] : [partLength, partWidth];
      const columns = alongLength ?? capacity(lengthLimit, length);
      const rows = alongWidth ?? capacity(maxWidth, width);
      if (columns < 1 || rows < 1 || !Number.isSafeInteger(columns * rows)) continue;
      const moldLengthMm = extent(columns, length);
      const moldWidthMm = extent(rows, width);
      if (maxLength !== null && (moldLengthMm > lengthLimit + tolerance(lengthLimit) ||
          moldWidthMm > maxWidth + tolerance(maxWidth))) continue;
      candidates.push({
        moldLengthMm, moldWidthMm, sheetLengthMm: moldLengthMm, sheetWidthMm: moldWidthMm + 40,
        alongLength: columns, alongWidth: rows, cavities: columns * rows, rotated,
      });
    }
    candidates.sort((a, b) => b.cavities - a.cavities ||
      a.moldLengthMm * a.moldWidthMm - b.moldLengthMm * b.moldWidthMm ||
      a.moldLengthMm - b.moldLengthMm);
    if (!candidates.length) {
      throw new Error(preferredLength !== null && lengthLimit < maxLength
        ? '当前产品在常规模具上限内排不下，请核对长宽和留量；需要加长时可使用设备允许的大版范围。'
        : '当前产品或排法超出模具上限，请核对尺寸、留量和设备。');
    }
    return candidates[0];
  }

  if (typeof module === 'object' && module.exports) module.exports = { estimate };
  else root.StationLayout = { estimate };
})(globalThis);

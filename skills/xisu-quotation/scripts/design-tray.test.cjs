'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The fixtures below are literal, hand-checked engineering examples. Replacing
// a whole-dimension tolerance with a per-side tolerance, estimating an unknown
// offset, or dropping an explicitly supplied invalid value must fail a test.
const run = input => require('./design-tray.cjs').designTray(input);
const product = { shape: 'rectangle', unit: 'mm', length: 100, width: 60, height: 20, dimensions_are_maximum: true, source: '测试用最大包络' };
const base = extra => ({ product: { ...product }, ...extra });
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
const mentions = (list, pattern) => assert.ok(list.some(item => pattern.test(item)), `Expected ${pattern} in ${JSON.stringify(list)}`);
const blocked = (input, pattern) => {
  const result = run(input);
  assert.equal(result.status, 'blocked');
  assert.equal(result.tooling_release, false);
  assert.equal(result.quote_dimensions, null);
  assert.ok(result.errors.length > 0);
  if (pattern) mentions(result.errors, pattern);
  return result;
};

test('100 × 60 × 20 mm product gives the independently calculated cavity and trim envelope', () => {
  const result = run(base());
  assert.equal(result.schema_version, '1.0');
  assert.equal(result.status, 'pending_review');
  assert.equal(result.tooling_release, false);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.geometry.product_mm, { length: 100, width: 60, height: 20 });
  assert.deepEqual(result.geometry.cavity_bottom_mm, { length: 102, width: 62 });
  near(result.geometry.cavity_opening_mm.length, 104.096311171322);
  near(result.geometry.cavity_opening_mm.width, 64.096311171322);
  near(result.geometry.trim_outer_mm.length, 120.096311171322);
  near(result.geometry.trim_outer_mm.width, 80.096311171322);
  assert.equal(result.geometry.pocket_depth_mm, 20);
  assert.equal(result.geometry.protrusion_mm, 0);
  assert.deepEqual(result.quote_dimensions, { shape: 'rectangle', length_cm: 12.01, width_cm: 8.01, height_cm: 2 });
  assert.equal(result.tooling.status, 'needs_parameters');
  assert.equal(result.tooling.contact_mm, null);
  assert.equal(result.tooling.mold_mm, null);
  mentions(result.tooling.missing, /mold_type/);
  mentions(result.tooling.missing, /shrinkage_fraction/);
});

test('cm product dimensions and strict decimal strings normalize to the same mm geometry', () => {
  const result = run(base({ product: { ...product, unit: 'cm', length: '10.0', width: '6', height: '2.00' } }));
  assert.deepEqual(result.geometry, run(base()).geometry);
  assert.deepEqual(result.quote_dimensions, { shape: 'rectangle', length_cm: 12.01, width_cm: 8.01, height_cm: 2 });
});

test('each 1 mm / 3 degree / 8 mm default is exposed as a software preliminary assumption', () => {
  const result = run(base());
  for (const name of ['clearance_per_side_mm', 'draft_angle_deg', 'rim_to_trim_mm']) {
    assert.equal(result.parameters[name].assumed, true);
    assert.match(result.parameters[name].source, /软件初步假设/);
  }
  mentions(result.assumptions, /1\s*mm.*软件初步假设|软件初步假设.*1\s*mm/);
  mentions(result.assumptions, /3.*软件初步假设|软件初步假设.*3/);
  mentions(result.assumptions, /8\s*mm.*软件初步假设|软件初步假设.*8\s*mm/);
  mentions(result.pending_review, /公差/);
});

test('unverified nominal product dimensions explicitly warn about maximum envelope and tolerance', () => {
  for (const maximum of [undefined, false, null]) {
    const result = run(base({ product: { ...product, dimensions_are_maximum: maximum } }));
    assert.equal(result.status, 'pending_review');
    mentions(result.warnings, /最大包络/);
    mentions(result.warnings, /公差/);
  }
});

test('a whole-dimension negative forming tolerance is added once', () => {
  const result = run(base({ design: { draft_angle_deg: 0, forming_negative_tolerance_mm: 0.6 } }));
  assert.deepEqual(result.geometry.cavity_bottom_mm, { length: 102.6, width: 62.6 });
  assert.deepEqual(result.geometry.cavity_opening_mm, { length: 102.6, width: 62.6 });
  assert.deepEqual(result.geometry.trim_outer_mm, { length: 118.6, width: 78.6 });
});

test('zero clearance, zero draft, zero rim and explicit zero shrinkage remain valid zeroes', () => {
  const result = run(base({
    design: { clearance_per_side_mm: 0, draft_angle_deg: 0, rim_to_trim_mm: 0, forming_negative_tolerance_mm: 0 },
    lining: { type: 'none' }, tooling: { mold_type: 'male', shrinkage_fraction: 0, source: '示例显式零值' }
  }));
  assert.equal(result.status, 'pending_review');
  assert.deepEqual(result.geometry.trim_outer_mm, { length: 100, width: 60 });
  assert.equal(result.parameters.clearance_per_side_mm.assumed, false);
  assert.equal(result.tooling.status, 'reference_only');
  assert.deepEqual(result.tooling.contact_mm, { bottom: { length: 100, width: 60 }, opening: { length: 100, width: 60 }, depth: 20 });
  assert.deepEqual(result.tooling.mold_mm, result.tooling.contact_mm);
  assert.equal(result.tooling_release, false);
});

test('shallow pockets expose the product and quote height can use a separately measured forming height', () => {
  const result = run(base({ design: { pocket_depth_mm: 10, draft_angle_deg: 0, quote_height_mm: 22.5 } }));
  assert.equal(result.geometry.pocket_depth_mm, 10);
  assert.equal(result.geometry.protrusion_mm, 10);
  assert.equal(result.geometry.quote_height_mm, 22.5);
  assert.equal(result.quote_dimensions.height_cm, 2.25);
  assert.equal(result.parameters.quote_height_mm.assumed, false);
});

test('round product diameter produces equal finished quote dimensions', () => {
  const result = run({ product: { shape: 'circle', unit: 'cm', length: '5', width: '5.00', height: '1' }, design: { draft_angle_deg: 0 } });
  assert.equal(result.status, 'pending_review');
  assert.deepEqual(result.geometry.product_mm, { length: 50, width: 50, height: 10 });
  assert.deepEqual(result.geometry.cavity_bottom_mm, { length: 52, width: 52 });
  assert.deepEqual(result.geometry.trim_outer_mm, { length: 68, width: 68 });
  assert.deepEqual(result.quote_dimensions, { shape: 'circle', length_cm: 6.8, width_cm: 6.8, height_cm: 1 });
});

test('uniform shrinkage is inverted using the mold-reference dimension definition', () => {
  const result = run(base({ design: { draft_angle_deg: 0 }, tooling: { mold_type: 'male', shrinkage_fraction: 0.005, source: '测试小数系数' } }));
  assert.equal(result.tooling.status, 'reference_only');
  near(result.tooling.mold_mm.bottom.length, 102.512562814070);
  near(result.tooling.mold_mm.bottom.width, 62.311557788945);
  near(result.tooling.mold_mm.depth, 20.100502512563);
  assert.equal(result.tooling_release, false);
});

test('a circular target with unequal in-plane shrinkage has an explicitly elliptical mold envelope', () => {
  const result = run({
    product: { shape: 'circle', unit: 'mm', length: 50, height: 10, dimensions_are_maximum: true },
    design: { draft_angle_deg: 0 },
    tooling: { mold_type: 'male', shrinkage_fraction: { length: 0.01, width: 0.02, height: 0.03 }, source: '示例方向收缩' }
  });
  assert.equal(result.tooling.status, 'reference_only');
  near(result.tooling.mold_mm.bottom.length, 52.525252525253);
  near(result.tooling.mold_mm.bottom.width, 53.061224489796);
  near(result.tooling.mold_mm.depth, 10.309278350515);
  mentions(result.warnings, /椭圆/);
  assert.equal(result.quote_dimensions.length_cm, result.quote_dimensions.width_cm);
});

test('missing shrinkage never becomes zero and partial directional shrinkage remains incomplete', () => {
  for (const shrinkage of [undefined, null, '', { length: 0.005 }]) {
    const result = run(base({ tooling: { mold_type: 'male', shrinkage_fraction: shrinkage } }));
    assert.equal(result.status, 'pending_review');
    assert.equal(result.tooling.status, 'needs_parameters');
    assert.ok(result.tooling.contact_mm);
    assert.equal(result.tooling.mold_mm, null);
    mentions(result.tooling.missing, /shrinkage_fraction/);
  }
});

test('female mold without effective offsets cannot substitute sheet thickness', () => {
  const result = run(base({ tooling: { mold_type: 'female', shrinkage_fraction: 0.005, sheet_thickness_mm: 0.5 } }));
  assert.equal(result.status, 'pending_review');
  assert.equal(result.tooling.status, 'needs_parameters');
  assert.equal(result.tooling.contact_mm, null);
  assert.equal(result.tooling.mold_mm, null);
  for (const field of ['bottom_offset_mm', 'opening_offset_mm', 'depth_offset_mm']) mentions(result.tooling.missing, new RegExp(field));
});

test('lining needs all corresponding signed feature offsets and their source', () => {
  const result = run(base({ lining: { type: 'flock' }, tooling: { mold_type: 'male', shrinkage_fraction: 0 } }));
  assert.equal(result.status, 'pending_review');
  assert.equal(result.tooling.contact_mm, null);
  assert.equal(result.tooling.mold_mm, null);
  for (const field of ['bottom_offset_mm', 'opening_offset_mm', 'depth_offset_mm', 'source']) mentions(result.tooling.missing, new RegExp(`lining\.${field}`));
});

test('lining offsets change corresponding virtual-sharp features and recalculate contact draft', () => {
  const result = run(base({
    design: { draft_angle_deg: 0 },
    lining: { type: 'flock', bottom_offset_mm: 0.5, opening_offset_mm: 1, depth_offset_mm: 1, source: 'CAD特征差' },
    tooling: { mold_type: 'male', shrinkage_fraction: 0 }
  }));
  assert.equal(result.tooling.status, 'reference_only');
  assert.deepEqual(result.tooling.contact_mm, { bottom: { length: 103, width: 63 }, opening: { length: 104, width: 64 }, depth: 21 });
  near(result.tooling.contact_draft_angle_deg.length, 1.363927531602);
  near(result.tooling.contact_draft_angle_deg.width, 1.363927531602);
});

test('female mold adds its own feature offsets after lining and signed depth differences', () => {
  const result = run(base({
    design: { draft_angle_deg: 0 },
    lining: { type: 'cloth', bottom_offset_mm: 0.5, opening_offset_mm: 1, depth_offset_mm: -1, source: '覆层CAD基准差' },
    tooling: { mold_type: 'female', bottom_offset_mm: 0.4, opening_offset_mm: 0.6, depth_offset_mm: 0.8, shrinkage_fraction: 0, source: '成型实测对应特征差' }
  }));
  assert.equal(result.tooling.status, 'reference_only');
  near(result.tooling.contact_mm.bottom.length, 103.8);
  near(result.tooling.contact_mm.bottom.width, 63.8);
  near(result.tooling.contact_mm.opening.length, 105.2);
  near(result.tooling.contact_mm.opening.width, 65.2);
  near(result.tooling.contact_mm.depth, 19.8);
});

test('known contact geometry with an undercut is blocked', () => {
  blocked(base({ design: { draft_angle_deg: 0 }, tooling: { mold_type: 'female', bottom_offset_mm: 2, opening_offset_mm: 0, depth_offset_mm: 0, shrinkage_fraction: 0 } }), /倒扣|开口/);
  blocked(base({ design: { draft_angle_deg: 0 }, lining: { type: 'cloth', bottom_offset_mm: 2, opening_offset_mm: 0, depth_offset_mm: 0, source: '测试' }, tooling: { mold_type: 'male', shrinkage_fraction: 0 } }), /倒扣|开口/);
});

test('nonpositive resulting feature dimensions and depth are blocked', () => {
  blocked(base({ tooling: { mold_type: 'female', bottom_offset_mm: -100, opening_offset_mm: 0, depth_offset_mm: 0, shrinkage_fraction: 0 } }), /正|尺寸/);
  blocked(base({ tooling: { mold_type: 'female', bottom_offset_mm: 0, opening_offset_mm: 0, depth_offset_mm: -20, shrinkage_fraction: 0 } }), /正|深度/);
});

test('contact outside the finished trim is blocked even without shrinkage', () => {
  blocked(base({ design: { draft_angle_deg: 0, rim_to_trim_mm: 1 }, tooling: { mold_type: 'female', bottom_offset_mm: 2, opening_offset_mm: 2, depth_offset_mm: 0 } }), /裁切/);
  blocked(base({ design: { draft_angle_deg: 0, rim_to_trim_mm: 1 }, lining: { type: 'flock', bottom_offset_mm: 2, opening_offset_mm: 2, depth_offset_mm: 0, source: '测试' }, tooling: { mold_type: 'male' } }), /裁切/);
  blocked(base({ design: { draft_angle_deg: 0, rim_to_trim_mm: 1 }, tooling: { mold_type: 'female', bottom_offset_mm: 2 } }), /裁切/);
  blocked(base({ design: { draft_angle_deg: 0, rim_to_trim_mm: 1 }, lining: { type: 'flock', opening_offset_mm: 2 }, tooling: { mold_type: 'male' } }), /裁切/);
});

test('a known lining-compensated inner feature outside trim is blocked before mold type is chosen', () => {
  blocked(base({ design: { draft_angle_deg: 0, rim_to_trim_mm: 1 }, lining: { type: 'flock', opening_offset_mm: 2 } }), /裁切/);
});

test('a shrinkage-compensated mold larger than the finished trim is not rejected as a contact clash', () => {
  const result = run(base({ design: { draft_angle_deg: 0, rim_to_trim_mm: 0 }, tooling: { mold_type: 'male', shrinkage_fraction: 0.01 } }));
  assert.equal(result.status, 'pending_review');
  assert.ok(result.tooling.mold_mm.opening.length > result.geometry.trim_outer_mm.length);
});

test('supplied invalid numerical values cannot be coerced to numbers', () => {
  for (const value of [true, false, [], [1], {}, '0x10', '1e3', 'Infinity', 'NaN', '1 mm', Infinity, NaN]) {
    blocked(base({ design: { clearance_per_side_mm: value } }), /clearance_per_side_mm/);
  }
});

test('invalid optional fields are rejected even in an otherwise unused process branch', () => {
  const examples = [
    { lining: { type: 'none', bottom_offset_mm: true } },
    { lining: { type: 'none', opening_offset_mm: [] } },
    { lining: { type: 'none', depth_offset_mm: 'NaN' } },
    { lining: { type: 'none', source: 42 } },
    { tooling: { mold_type: 'male', bottom_offset_mm: {} } },
    { tooling: { mold_type: 'male', opening_offset_mm: false } },
    { tooling: { mold_type: 'male', depth_offset_mm: Infinity } },
    { tooling: { source: [] } },
    { tooling: { shrinkage_fraction: { length: 0.005, width: false, height: 0.003 } } }
  ];
  for (const extra of examples) blocked(base(extra));
});

test('required units, supported shapes, loose fit, scalar source and maximum flags are validated', () => {
  for (const extra of [
    { product: { ...product, unit: undefined } }, { product: { ...product, unit: 'inch' } },
    { product: { ...product, shape: 'ellipse' } }, { product: { ...product, width: 0 } },
    { product: { ...product, length: -1 } }, { product: { ...product, height: null } },
    { product: { ...product, dimensions_are_maximum: 'true' } }, { product: { ...product, source: true } },
    { fit_mode: 'snap' }, { lining: { type: 'unknown' } }, { tooling: { mold_type: 'unknown' } },
    { design: [] }, { lining: false }, { tooling: 2 }, { product: null }
  ]) blocked(base(extra));
  for (const input of [null, undefined, [], true, 'product']) blocked(input);
});

test('a conflicting or malformed second circle diameter is blocked', () => {
  for (const width of [49, 0, false, [50]]) {
    blocked({ product: { shape: 'circle', unit: 'mm', length: 50, width, height: 10 } }, /width|直径/);
  }
});

test('negative design allowances, bad angles and invalid shrinkage fractions are blocked', () => {
  for (const design of [{ clearance_per_side_mm: -1 }, { forming_negative_tolerance_mm: -0.1 }, { rim_to_trim_mm: -1 }, { pocket_depth_mm: 0 }, { quote_height_mm: 0 }, { draft_angle_deg: -1 }, { draft_angle_deg: 90 }]) blocked(base({ design }));
  for (const value of [-0.01, 1, 5, true, [], { length: 0, width: 1, height: 0 }]) blocked(base({ tooling: { shrinkage_fraction: value } }));
});

test('overflow and unsafe hundredth-mm quote rounding produce a blocked result rather than null numeric fields', () => {
  blocked(base({ product: { ...product, unit: 'cm', length: Number.MAX_VALUE } }));
  blocked(base({ design: { clearance_per_side_mm: Number.MAX_VALUE } }));
  blocked(base({ product: { ...product, length: 1e15 } }));
  blocked(base({ design: { pocket_depth_mm: Number.MAX_VALUE, draft_angle_deg: 89 } }));
});

test('quote length and width round upward to hundredth-mm precision without rounding exact hundredths up twice', () => {
  const exact = run(base({ product: { ...product, length: 100.01, width: 60.01 }, design: { clearance_per_side_mm: 0, draft_angle_deg: 0, rim_to_trim_mm: 0 } }));
  assert.equal(exact.quote_dimensions.length_cm, 10.001);
  assert.equal(exact.quote_dimensions.width_cm, 6.001);
  const smallRemainder = run(base({ product: { ...product, length: 100.010001, width: 60.010001 }, design: { clearance_per_side_mm: 0, draft_angle_deg: 0, rim_to_trim_mm: 0 } }));
  assert.equal(smallRemainder.quote_dimensions.length_cm, 10.002);
  assert.equal(smallRemainder.quote_dimensions.width_cm, 6.002);
});

test('positive tiny lengths still round upward to a positive quotation dimension', () => {
  const result = run(base({ product: { ...product, length: 1e-18, width: 1e-18 }, design: { clearance_per_side_mm: 0, draft_angle_deg: 0, rim_to_trim_mm: 0 } }));
  assert.equal(result.quote_dimensions.length_cm, 0.001);
  assert.equal(result.quote_dimensions.width_cm, 0.001);
});

test('a positive quote height that underflows to zero in cm is blocked', () => {
  blocked(base({ design: { quote_height_mm: Number.MIN_VALUE } }), /报价|height/);
});

test('the pure calculator retains the original input and does not mutate frozen caller objects', () => {
  const input = base({ design: { draft_angle_deg: 0 }, tooling: { mold_type: 'male', shrinkage_fraction: { length: 0, width: 0, height: 0 } } });
  const snapshot = structuredClone(input);
  Object.freeze(input.product); Object.freeze(input.design); Object.freeze(input.tooling.shrinkage_fraction); Object.freeze(input.tooling); Object.freeze(input);
  const first = run(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(first.input, snapshot);
  assert.deepEqual(first, run(input));
  assert.deepEqual(Object.keys(first).sort(), ['schema_version', 'status', 'tooling_release', 'errors', 'warnings', 'assumptions', 'pending_review', 'input', 'parameters', 'geometry', 'tooling', 'quote_dimensions'].sort());
  for (const name of ['errors', 'warnings', 'assumptions', 'pending_review']) assert.ok(first[name].every(item => typeof item === 'string'));
});

test('CLI emits JSON, succeeds for preliminary designs, and exits 2 for blocked inputs or invalid JSON', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-design-'));
  try {
    const filename = path.join(directory, 'input.json');
    for (const [text, exitCode] of [[JSON.stringify(base()), 0], [JSON.stringify(base({ product: { ...product, unit: 'inch' } })), 2], ['{broken-json', 2]]) {
      fs.writeFileSync(filename, text);
      const processResult = spawnSync(process.execPath, [path.join(__dirname, 'design-tray.cjs'), filename], { encoding: 'utf8' });
      assert.equal(processResult.status, exitCode, processResult.stderr);
      const result = JSON.parse(processResult.stdout);
      assert.equal(result.tooling_release, false);
      assert.equal(result.status, exitCode ? 'blocked' : 'pending_review');
    }
    const noFilename = spawnSync(process.execPath, [path.join(__dirname, 'design-tray.cjs')], { encoding: 'utf8' });
    assert.equal(noFilename.status, 2);
    assert.equal(JSON.parse(noFilename.stdout).status, 'blocked');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { quoteStation } = require('./station-quote.cjs');
const { estimate } = require('./station-layout.cjs');
const { createServer } = require('./web-server.cjs');

// Fictional fixture for testing unit conversion and fees.
const demo = {
  quantity: 1200, cavities: 4, pieceWeight: 8, yieldPercent: 80,
  cycleSeconds: 12, shiftHours: 3, shiftCost: 300, materialPrice: 6, scrapPrice: 2,
  boxCapacity: 100, boxPrice: 2, loadingCost: 8, moldCost: 25, otherCost: 3,
  taxPercent: 5, targetProfit: 20,
};
const sheet = { mode: 'sheet', sheetLengthMm: 400, sheetWidthMm: 250, thicknessMm: 0.4, density: 1 };

test('the download-only CLI prices a fictional order using its own inputs', () => {
  const text = execFileSync(process.execPath, [path.join(__dirname, 'station-quote.cjs'), '-'],
    { input: JSON.stringify(demo), encoding: 'utf8' });
  const quote = JSON.parse(text);
  assert.equal(quote.untaxedUnitPrice, 0.2060);
  assert.equal(quote.taxedUnitPrice, 0.2163);
  assert.equal(quote.taxedTotal, 259.56);
  assert.equal(quote.inputKg, 12);
  assert.equal(quote.loadingIncluded, true);
});

test('sheet modes agree with weight mode and missing pricing inputs are rejected', () => {
  const expected = quoteStation(demo).taxedUnitPrice;
  assert.equal(quoteStation({ ...demo, ...sheet, yieldBasis: 'measured' }).taxedUnitPrice, expected);
  assert.equal(quoteStation({ ...demo, ...sheet, yieldBasis: 'projection', pieceAreaCm2: 200 }).taxedUnitPrice, expected);
  assert.equal(quoteStation({ ...demo, ...sheet, yieldBasis: 'provided' }).taxedUnitPrice, expected);
  assert.equal(quoteStation({ ...demo, loadingCost: '' }).loadingIncluded, false);
  assert.throws(() => quoteStation({ ...demo, shiftCost: undefined }), /每班生产费用/);
  assert.throws(() => quoteStation({ ...demo, ...sheet, yieldBasis: 'projection', pieceAreaCm2: 300 }), /超过本模投料/);
  assert.throws(() => quoteStation({ ...demo, boxPrice: undefined }), /同时填写/);
});

test('product layout adds 40 mm only to sheet width and prices the estimated sheet', () => {
  const layout = {
    productLengthMm: 140, productWidthMm: 90, gapMm: 15, edgeMm: 20,
    layoutMethod: 'manual', layoutAlongLength: 3, layoutAlongWidth: 2,
  };
  const expected = {
    moldLengthMm: 490, moldWidthMm: 235, sheetLengthMm: 490, sheetWidthMm: 275,
    alongLength: 3, alongWidth: 2, cavities: 6, rotated: false,
  };
  assert.deepEqual(estimate(layout), expected);
  const order = { ...demo, ...sheet, yieldBasis: 'provided' };
  const calculated = quoteStation({ ...order, ...layout, sheetSource: 'layout' });
  const direct = quoteStation({ ...order, cavities: 6, sheetLengthMm: 490, sheetWidthMm: 275 });
  assert.equal(calculated.inputKg, direct.inputKg);
  assert.equal(calculated.taxedTotal, direct.taxedTotal);
  assert.throws(() => estimate({ ...layout, edgeMm: undefined }), /模具每边留量/);
});

test('automatic layout checks device limits and only rotates when requested', () => {
  const fits = { productLengthMm: 140, productWidthMm: 90, gapMm: 15, edgeMm: 20,
    layoutMethod: 'auto', maxMoldLengthMm: 500, maxMoldWidthMm: 184 };
  assert.equal(estimate(fits).cavities, 3);
  const rotated = estimate({ ...fits, layoutOrientation: 'compare' });
  assert.equal(rotated.cavities, 4);
  assert.equal(rotated.rotated, true);
  assert.equal(rotated.sheetWidthMm, 220);
  assert.throws(() => estimate({ ...fits, maxMoldLengthMm: 40 }), /超出模具上限/);
  assert.throws(() => estimate({ ...fits, maxMoldWidthMm: undefined }), /模具最大宽/);
});

test('users can enter a shorter preferred length without changing the hard limits', () => {
  const params = { productLengthMm: 100, productWidthMm: 60, gapMm: 10, edgeMm: 15,
    layoutMethod: 'auto', maxMoldLengthMm: 540, maxMoldWidthMm: 250 };
  const regular = estimate({ ...params, preferredMoldLengthMm: 400 });
  assert.equal(regular.moldLengthMm, 350);
  assert.equal(regular.cavities, 9);
  assert.equal(estimate(params).moldLengthMm, 460);
  assert.equal(estimate({ ...params, preferredMoldLengthMm: 700 }).moldLengthMm, 460);
  assert.throws(() => estimate({ ...params, preferredMoldLengthMm: 120 }), /常规模具上限/);
});

test('the local web route uses the same calculator with the existing session guard', async t => {
  const password = 'synthetic-test-only';
  const server = createServer({ password });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (route, payload, cookie) => fetch(url + route, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload),
  });
  assert.equal((await post('/api/station-quote', demo)).status, 401);
  const login = await post('/api/login', { password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(await (await fetch(url + '/station', { headers: { cookie } })).text(), /id="station-form"/);
  const quote = await post('/api/station-quote', demo, cookie);
  assert.equal(quote.status, 200);
  assert.deepEqual(await quote.json(), quoteStation(demo));
  assert.equal((await post('/api/station-quote', { ...demo, materialPrice: '' }, cookie)).status, 422);
});

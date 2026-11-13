'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const {createServer} = require('./web-server.cjs');

(async () => {
  const password = 'design-test-only';
  const server = createServer({password});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const input = {product: {shape: 'rectangle', unit: 'mm', length: 100, width: 60, height: 20, dimensions_are_maximum: true}, lining: {type: 'none'}, fit_mode: 'loose'};
  try {
    assert.equal((await fetch(origin + '/api/design', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)})).status, 401);
    assert.equal((await fetch(origin + '/design.js')).status, 401);
    const login = await fetch(origin + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password})});
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const get = pathname => fetch(origin + pathname, {headers: {Cookie: cookie}});
    const req = (body, headers = {}) => fetch(origin + '/api/design', {method: 'POST', headers: {'Content-Type': 'application/json', Cookie: cookie, ...headers}, body: JSON.stringify(body)});
    assert.equal((await get('/design')).status, 200, 'authenticated design page must exist');
    assert.equal((await get('/design.html')).status, 200);
    assert.equal((await get('/design.js')).status, 200);
    let response = await req(input);
    assert.equal(response.status, 200);
    let result = await response.json();
    assert.equal(result.schema_version, '1.0');
    assert.equal(result.status, 'pending_review');
    assert.equal(result.tooling_release, false);
    assert.deepEqual(result.quote_dimensions, {shape: 'rectangle', length_cm: 12.01, width_cm: 8.01, height_cm: 2});
    assert.equal(result.tooling.mold_mm, null);
    assert.ok(result.tooling.missing.length);
    assert.deepEqual(result.input, input);
    const cm = {...input, product: {...input.product, unit: 'cm', length: 10, width: 6, height: 2}};
    assert.deepEqual((await (await req(cm)).json()).quote_dimensions, result.quote_dimensions);
    result = await (await req({...input, tooling: {mold_type: 'male', shrinkage_fraction: 0, source: 'HTTP test'}})).json();
    assert.equal(result.tooling.status, 'reference_only');
    assert.ok(result.tooling.mold_mm);
    assert.equal(result.tooling_release, false);
    for (const product of [{...input.product, unit: 'inch'}, {...input.product, length: true}, {...input.product, shape: 'ellipse'}, {...input.product, width: -1}]) {
      response = await req({...input, product});
      assert.equal(response.status, 422);
      const blocked = await response.json();
      assert.equal(blocked.status, 'blocked');
      assert.ok(blocked.errors.length);
      assert.equal(blocked.quote_dimensions, null);
    }
    assert.equal((await req(input, {Origin: 'https://attacker.invalid'})).status, 403);
    const wrongHost = await new Promise((resolve, reject) => {
      const request = http.request(origin + '/api/design', {method: 'POST', headers: {Host: 'evil.invalid', Cookie: cookie, 'Content-Type': 'application/json'}}, response => {response.resume(); resolve(response.statusCode);});
      request.on('error', reject); request.end(JSON.stringify(input));
    });
    assert.equal(wrongHost, 403);
    for (const pathname of ['/scripts/design-tray.cjs', '/assets/parameters.reference.json', '/%2e%2e%2fscripts%2fdesign-tray.cjs', '/design/../../scripts/design-tray.cjs']) {
      assert.equal((await get(pathname)).status, 404);
    }
    assert.equal((await req(input, {'Content-Type': 'text/plain'})).status, 415);
    const raw = body => fetch(origin + '/api/design', {method: 'POST', headers: {'Content-Type': 'application/json', Cookie: cookie}, body});
    assert.equal((await raw('{')).status, 400);
    assert.equal((await raw('x'.repeat(9000))).status, 413);
    await fetch(origin + '/api/logout', {method: 'POST', headers: {Cookie: cookie}});
    assert.equal((await req(input)).status, 401);
    console.log('PASS design HTTP: authenticated page, real calculations, unit equivalence, semantic errors, Host/Origin protection, private paths, JSON limits, revoked session');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});

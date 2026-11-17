const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const tests = [];

global.test = (name, fn) => tests.push({ name, fn });
global.assert = assert;

// Top-level const/let are not context properties, so the loader returns them explicitly
global.loadBackend = (stubs = {}) => {
  const ctx = vm.createContext({ console, ...stubs });
  const exported = vm.runInContext(read('apps-script.js') +
    '\n;({ REPORT_HEADERS, LATENCY_TARGETS, ENUMS, REGIONS })', ctx);
  return Object.assign(ctx, exported);
};

global.loadFrontend = (stubs = {}) => {
  const html = read('index.html');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const ctx = vm.createContext({ console, window: { __TEST__: true }, Intl, Date, Math, ...stubs });
  const exported = vm.runInContext(read('i18n.js') + '\n' + inline +
    '\n;({ I18N, LATENCY_TARGETS, state })', ctx);
  return Object.assign(ctx, exported);
};

global.loadI18n = () => vm.runInContext(read('i18n.js') + '\n;I18N', vm.createContext({}));

for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, f));
}

let failed = 0;
(async () => {
  for (const t of tests) {
    try { await t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failed++; console.log('FAIL ' + t.name + '\n     ' + e.message); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();

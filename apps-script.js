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

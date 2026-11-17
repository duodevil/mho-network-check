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

// ── Report row ────────────────────────────────────────────────────────────
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

// Built only from validated values, so a forged payload cannot plant text here
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

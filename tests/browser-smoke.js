// Usage: node tests/browser-smoke.js [url] [lang] [screenshot.png]
// Serve the repo first: python3 -m http.server 8765
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2] || 'http://localhost:8765/';
const lang = process.argv[3] || '';
const shot = process.argv[4] || '';

(async () => {
  const profile = path.join(os.tmpdir(), 'mho-smoke-profile-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 2000));
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
  await call('Runtime.enable');
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', m.params.exceptionDetails.exception?.description);
  });
  await call('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 35000));
  if (lang) await call('Runtime.evaluate', { expression: `setLang(${JSON.stringify(lang)})` });
  if (shot) {
    // Fake a server list so Step 3 renders without the Apps Script backend
    await call('Runtime.evaluate', { expression: `state.matchedServers = [{ label: 'Singapore', ip: '43.172.182.161' }]; state.serversFailed = false; renderStep3();` });
    await call('Emulation.setDeviceMetricsOverride', { width: 420, height: 3200, deviceScaleFactor: 1, mobile: false });
    const img = await call('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(shot, Buffer.from(img.data, 'base64'));
  }
  const r = await call('Runtime.evaluate', {
    expression: 'JSON.stringify({ state, lang: currentLang, dir: document.dir, submit: document.getElementById("submit-btn").textContent, step3: document.getElementById("step3-content").innerText.slice(0, 120) })',
    returnByValue: true,
  });
  console.log(JSON.stringify(JSON.parse(r.result.value), null, 2));
  ws.close();
  chrome.kill();
})();

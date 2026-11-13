/* CDP driver for the Streamo Windows build — captures reference screenshots. */
const fs = require('fs');
const path = require('path');

const OUT = 'C:\\Users\\KIMO\\Documents\\X5Coder Projects\\Streamo apk\\streamo_android\\dev';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, { res, rej });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  return { ws, send };
}

async function shot(send, name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails));
  return r.result ? r.result.value : undefined;
}

(async () => {
  // find the chrome page target
  const list = JSON.parse(require('child_process').execSync('curl -s http://127.0.0.1:9333/json').toString());
  const page = list.find((t) => t.title === 'Streamo');
  if (!page) { console.error('chrome page not found'); process.exit(1); }
  const { ws, send } = await cdpConnect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await sleep(1500);

  // seed store: 2 links (one ok/one fail-ish stays testing; better: ok + ok) + 3 searches
  await evaluate(send, `(function(){
    try {
      window.StreamoStore.addLink('https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8', 'https://example.com/watch', { isMaster: true });
      window.StreamoStore.addLink('https://storage.googleapis.com/exoplayer-test-media-0/BigBuckBunny_320x180.mp4', 'https://example.com/other', {});
      window.StreamoStore.addSearch('أفلام جديدة ٢٠٢٦', 'https://www.google.com/search?q=x', 'Google');
      window.StreamoStore.addSearch('beastare', 'https://www.google.com/search?q=x', 'Google');
      window.StreamoStore.addSearch('how to make coffee', 'https://www.google.com/search?q=x', 'Google');
      return 'seeded';
    } catch (e) { return 'err: ' + e.message; }
  })()`);

  // capture-card inject for one link: force an update to flip testing -> ok? addLink sets testing; force update via updateLink with unknown id... we stored entries; let's find ids and set status ok/master
  await evaluate(send, `(function(){
    try {
      var links = window.StreamoStore.getLinks();
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        window.StreamoStore.updateLink(l.id, { status: 'ok', type: l.url.indexOf('.m3u8') >= 0 ? 'hls' : 'mp4', httpStatus: 206, size: 6280, duration: 35, isMaster: l.url.indexOf('master.m3u8') >= 0 });
      }
      return 'patched ' + links.length;
    } catch (e) { return 'err: ' + e.message; }
  })()`);

  await shot(send, 'win_toolbar.png');

  // open links panel
  await evaluate(send, `document.getElementById('btnLinks').click()`);
  await sleep(700);
  await shot(send, 'win_panel_links.png');
  await evaluate(send, `document.getElementById('closeLinks').click()`);
  await sleep(300);

  // menu popover
  await evaluate(send, `document.getElementById('btnMenu').click()`);
  await sleep(500);
  await shot(send, 'win_menu.png');
  // open Records (fullscreen search history)
  await evaluate(send, `document.getElementById('menuRecords').click()`);
  await sleep(700);
  await shot(send, 'win_records.png');
  await evaluate(send, `document.getElementById('closeSearch').click()`);
  await sleep(300);

  // menu -> Tabs
  await evaluate(send, `document.getElementById('btnMenu').click()`);
  await sleep(300);
  await evaluate(send, `document.getElementById('menuTabs').click()`);
  await sleep(600);
  await shot(send, 'win_tabs.png');
  await evaluate(send, `document.getElementById('closeTabs').click()`);
  await sleep(300);

  // player with HLS
  await evaluate(send, `window.__streamoDebug.openPlayer('https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8', 'https://example.com/watch')`);
  await sleep(3500);
  await shot(send, 'win_player.png');
  await evaluate(send, `window.__streamoDebug.closePlayer()`);
  await sleep(400);

  // reset seeded data so the user keeps a clean slate? Keep seeds (they're realistic demo). Leave as is.
  console.log('done');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

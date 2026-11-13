/*
 * Streamo — وضع التطوير (Hot Reload) بدون أي حزم خارجية.
 * التشغيل:  npm run dev
 *
 * طريقة العمل: polling كل 700ms على شجرة الملفات — لا يستخدم fs.watch
 * (تجنّب أخطاء EPERM/ENOENT على ويندوز عند حذف/إعادة إنشاء المجلدات أثناء المزامنة).
 *
 * سلوك:
 *   تعديل في ../shared/**            ← مزامنة إلى renderer/shared/ ثم إعادة تشغيل التطبيق
 *   تعديل في main/preload/browser-preload/renderer  ← إعادة تشغيل بدون مزامنة
 * ملاحظة: renderer/shared/** هو نسخة مولّدة — يتجاهله المراقب تمامًا (مضاد لحلقة الإعادة).
 * Ctrl+C للإيقاف.
 */
'use strict';

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const SHARED_ROOT = path.join(HERE, '..', 'shared');
const RENDERER_ROOT = path.join(HERE, 'renderer');
const GENERATED_PREFIX = path.normalize(path.join(RENDERER_ROOT, 'shared') + path.sep);

let electronBin;
try {
  electronBin = require('electron');
} catch (e) {
  console.error('electron is not installed — run: npm install first');
  process.exit(1);
}

let child = null;
let restarting = false;
let suppressUntil = 0;
let debounce = null;

function syncShared() {
  suppressUntil = Date.now() + 2500;
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'sync-shared.ps1')], { stdio: 'inherit' });
  } catch (e) {
    console.error('sync-shared failed:', e.message);
  } finally {
    suppressUntil = Date.now() + 1000;
  }
}

/* ---------- polling snapshot ---------- */
const WATCH_IGNORED = /[\\/](node_modules|dist|\.git)([\\/]|$)/;

function collect(rootList) {
  const snap = new Map();
  const walk = (p) => {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(p, entry.name);
      if (WATCH_IGNORED.test(full)) continue;
      if (path.normalize(full) + path.sep === GENERATED_PREFIX) continue; // renderer/shared مولّدة
      if (entry.isDirectory()) { walk(full); continue; }
      try {
        const st = fs.statSync(full);
        snap.set(path.normalize(full), String(Math.round(st.mtimeMs)) + ':' + st.size);
      } catch (e) {}
    }
  };
  for (const root of rootList) {
    try {
      const st = fs.statSync(root);
      if (st.isDirectory()) walk(root); else snap.set(path.normalize(root), String(Math.round(st.mtimeMs)) + ':' + st.size);
    } catch (e) {}
  }
  return snap;
}

const RELEVANT_FILES = [
  path.join(HERE, 'main.js'),
  path.join(HERE, 'preload.js'),
  path.join(HERE, 'browser-preload.js')
];
const WATCH_ROOTS = [SHARED_ROOT, RENDERER_ROOT, ...RELEVANT_FILES];
const SHARED_PREFIX = path.normalize(SHARED_ROOT + path.sep);

let lastSnapshot = null;

function poll() {
  if (Date.now() < suppressUntil) return;
  const snap = collect(WATCH_ROOTS);
  if (!lastSnapshot) { lastSnapshot = snap; return; }
  let sharedChanged = false;
  let otherChanged = false;
  const keys = new Set([...lastSnapshot.keys(), ...snap.keys()]);
  for (const key of keys) {
    const a = lastSnapshot.get(key), b = snap.get(key);
    if (a !== b) {
      if (key.startsWith(SHARED_PREFIX)) sharedChanged = true; else otherChanged = true;
    }
  }
  lastSnapshot = snap;
  if (sharedChanged || otherChanged) schedule(sharedChanged);
}

function start() {
  child = spawn(electronBin, ['.'], { cwd: HERE, stdio: 'inherit', env: { ...process.env, STREAMO_DEV: '1' } });
  child.on('exit', (code, signal) => {
    child = null;
    if (!restarting) {
      process.exit(code || 0 || (signal ? 1 : 0));
    }
  });
}

function restart() {
  if (restarting) return;
  restarting = true;
  const dead = () => { restarting = false; start(); };
  if (child) {
    const c = child;
    c.once('exit', () => dead());
    try { c.kill('SIGTERM'); } catch (e) { try { dead(); } catch (e2) {} }
    setTimeout(() => { try { c.kill('SIGKILL'); } catch (e) {} }, 3000);
  } else {
    dead();
  }
}

function schedule(needsSync) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log('\n[dev] change detected — restarting app…\n');
    if (needsSync) syncShared();
    restart();
  }, 350);
}

console.log('[dev] Streamo — hot reload (polling). Ctrl+C to stop.');
lastSnapshot = collect(WATCH_ROOTS);
setInterval(poll, 700);
start();

/*
 * Streamo Android — hot reload development mode.
 * The Android equivalent of the Windows `npm run dev` watcher (dev-reload.js):
 * polls the source tree, and on change it runs an incremental build + reinstall + relaunch.
 *
 * NOTE ON HOT RELOAD: Kotlin/Java code on a real Android device is not bit-swappable the way
 * Flutter/Dart is (Flutter has true hot reload; Android JVM/ART only supports
 * method-body swaps via Android Studio "Apply Changes"/Live Edit, which needs the IDE).
 * This watcher is therefore a fast restart-based loop: an incremental `installDebug` +
 * `am start` lands in roughly 5-15 seconds for small edits. Editing the WebView layer
 * (assets/hook.js etc.) is NOT hot-swapped this way — it requires a reinstall (same as Windows).
 *
 * Usage:   node dev/dev-reload.mjs            (uses the first connected device)
 *          node dev/dev-reload.mjs JVWWK...   (pin a serial)
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const WATCH_DIRS = [
  path.join(ROOT, 'app', 'src', 'main', 'java'),
  path.join(ROOT, 'app', 'src', 'main', 'res'),
  path.join(ROOT, 'app', 'src', 'main', 'assets'),
  path.join(ROOT, 'app', 'build.gradle.kts'),
  path.join(ROOT, 'settings.gradle.kts'),
];
const WATCH_IGNORED = /[\\/](build|\.gradle|\.kotlin|node_modules|\.git)[\\/]|\.png$|\.ico$|\.ttf$/;

const SERIAL_ARG = process.argv[2] || null;
const APP_ID = 'com.streamo.link.android';
const ACTIVITY = APP_ID + '/.MainActivity';
const GRADLE = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

let debounce = null;
let building = false;
let pending = false;

function adb(args) {
  const full = SERIAL_ARG ? ['-s', SERIAL_ARG, ...args] : args;
  return execFile('adb', full, { cwd: ROOT });
}

function snapshot(root) {
  const snap = new Map();
  const walk = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      let entries;
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(p, e.name);
        if (WATCH_IGNORED.test(full) || e.name === 'build' || e.name === '.gradle') continue;
        walk(full);
      }
    } else {
      try {
        snap.set(path.normalize(p), String(Math.round(st.mtimeMs)) + ':' + st.size);
      } catch { /* ignore */ }
    }
  };
  for (const p of root) walk(p);
  return snap;
}

function rebuildAndRelaunch(reason) {
  if (building) { pending = true; return; }
  building = true;
  console.log('\n[dev] change detected (' + reason + ') — incremental build + reinstall…');
  const child = spawn(GRADLE, ['installDebug', '--console=plain'], {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[dev] build OK — relaunching on device');
      adb(['shell', 'am', 'force-stop', APP_ID]).on('exit', () => {
        adb(['shell', 'am', 'start', '-n', ACTIVITY]);
      });
    } else {
      console.error('[dev] build FAILED (exit ' + code + ') — fix the errors and save again');
    }
    building = false;
    if (pending) {
      pending = false;
      // re-check for changes that happened during the build
      const snap = snapshot(WATCH_DIRS);
      // trigger once more only if files changed in between; debounce handles spam
      debounce = setTimeout(() => rebuildAndRelaunch('pending changes'), 300);
      void snap;
    }
  });
}

let last = snapshot(WATCH_DIRS);
setInterval(() => {
  const snap = snapshot(WATCH_DIRS);
  const keys = new Set([...last.keys(), ...snap.keys()]);
  let changed = false;
  let firstChange = '';
  for (const key of keys) {
    if (last.get(key) !== snap.get(key)) {
      if (!changed) firstChange = path.basename(key);
      changed = true;
    }
  }
  last = snap;
  if (changed) {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => rebuildAndRelaunch(firstChange), 500);
  }
}, 600);

console.log('[dev] Streamo Android — hot reload watcher (polling every 600ms). Ctrl+C to stop.');
console.log('[dev] target package: ' + APP_ID + (SERIAL_ARG ? ' (device ' + SERIAL_ARG + ')' : ''));
if (!fs.existsSync(path.join(ROOT, 'gradlew.bat')) && process.platform === 'win32') {
  console.error('[dev] gradlew.bat not found — run this from the streamo_android root folder');
}

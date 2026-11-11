'use strict';
const http = require('http');
const https = require('https');

const TEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

/* اختبار الرابط — طلب HTTP Range 4KB (وحدة مستقلة قابلة للاختبار) */

function typeFromUrl(url) {
  const m = /\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd|ts)(\?|#|$)/i.exec(url || '');
  if (!m) return 'unknown';
  const ext = m[1].toLowerCase();
  if (ext === 'm3u8') return 'hls';
  if (ext === 'mpd') return 'dash';
  if (['mp3', 'm4a', 'wav', 'aac', 'opus', 'flac'].includes(ext)) return 'audio';
  return ext;
}
function isMediaExt(url) {
  return /\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd|ts)(\?|#|$)/i.test(url || '');
}
function isManifestType(ct, url) {
  ct = String(ct || '').toLowerCase();
  return ct.indexOf('mpegurl') !== -1 || ct.indexOf('dash+xml') !== -1 ||
         /\.m3u8(\?|#|$)|\.mpd(\?|#|$)/i.test(url || '');
}
function isMediaMime(ct) {
  ct = String(ct || '').toLowerCase();
  return /^(video\/|audio\/)/.test(ct) ||
         ct.indexOf('mpegurl') !== -1 || ct.indexOf('dash+xml') !== -1 ||
         ct === 'application/octet-stream' || ct === 'binary/octet-stream' || ct === 'application/binary';
}
/** بصمة الملف (magic bytes) — تخبرنا بالنوع الحقيقي مهما كان الامتداد */
function sniffMagic(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const head = bytes.slice(0, Math.min(bytes.length, 16)).toString('latin1');
  if (head.indexOf('ftyp') !== -1 || bytes.slice(4, 8).toString('latin1') === 'ftyp') return 'mp4'; // عائلات MP4/M4A/MOV
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return 'webm'; // Matroska/WebM
  if (head.indexOf('OggS') !== -1) return 'ogg';
  if (head.indexOf('FLV') === 0) return 'flv';
  if (head.indexOf('#EXTM3U') !== -1) return 'hls';
  if (head.toLowerCase().indexOf('<mpd') !== -1) return 'dash';
  if (head.indexOf('ID3') === 0) return 'audio'; // MP3 بعلامة ID3
  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return 'audio'; // إطار MP3
  if (head.indexOf('RIFF') === 0 && head.indexOf('WAVE') !== -1) return 'wav';
  if (head.indexOf('fLaC') === 0) return 'audio';
  return null;
}

/**
 * طلب GET واحد بـ Range: bytes=0-4095 ثم إلغاء الاتصال.
 * يتبع سلسلة تحويلات ≤5، ويتحقق من: حالة HTTP + Content-Type + Magic Bytes.
 * يرجع نفس شكل نتيجة الاختبار القديم بالكامل.
 */
function probeLink(url, pageUrl) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = {
      url: url, status: 'fail', type: typeFromUrl(url), duration: null,
      size: null, httpStatus: null, contentType: null, via: 'http',
      finalUrl: null, error: null, testedInMs: 0
    };
    const finish = (patch) => {
      Object.assign(out, patch);
      out.testedInMs = Math.round(Date.now() - t0);
      resolve(out);
    };

    let referer = '';
    if (typeof pageUrl === 'string' && /^https?:\/\//i.test(pageUrl)) {
      try { referer = new URL(pageUrl).origin + '/'; } catch (e) { referer = ''; }
    }

    let hops = 0;
    const requestAt = (currentUrl) => {
      let u;
      try { u = new URL(currentUrl); } catch (e) { return finish({ error: 'BAD_URL' }); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return finish({ error: 'UNSUPPORTED' });
      const lib = u.protocol === 'https:' ? https : http;
      const headers = {
        'Range': 'bytes=0-4095',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*'
      };
      if (referer) headers['Referer'] = referer;

      let req;
      try {
        req = lib.request(u, { method: 'GET', headers, timeout: TEST_TIMEOUT_MS }, (res) => {
          const status = res.statusCode || 0;

          // 3xx → تبع السلسلة
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            if (hops >= MAX_REDIRECTS) return finish({ httpStatus: status, error: 'TOO_MANY_REDIRECTS' });
            hops += 1;
            let next;
            try { next = new URL(res.headers.location, currentUrl).href; }
            catch (e) { return finish({ httpStatus: status, error: 'BAD_REDIRECT' }); }
            requestAt(next);
            return;
          }

          const ct = String(res.headers['content-type'] || '').toLowerCase();
          let size = null;
          const cr = res.headers['content-range'];
          if (cr) {
            // صيغة: bytes 0-4095/123456 → نأخذ الحجم الكلي الحقيقي للملف
            const mRange = /\/(\d+)\s*$/.exec(cr);
            if (mRange) size = parseInt(mRange[1], 10) || null;
          }
          if (size === null && status !== 206) {
            const clRaw = res.headers['content-length'];
            size = clRaw ? (parseInt(String(clRaw), 10) || null) : null;
          }

          const chunks = [];
          let len = 0;
          let done = false;
          const doneOnce = () => {
            if (done) return;
            done = true;
            const bytes = Buffer.concat(chunks);
            const magic = sniffMagic(bytes);
            const okRange = status >= 200 && status < 300;
            const finalUrl = currentUrl !== url ? currentUrl : null;

            if (!okRange) {
              finish({ status: 'fail', httpStatus: status, contentType: ct || null, finalUrl, error: 'HTTP_' + status });
              return;
            }
            if (magic) {
              finish({ status: 'ok', type: magic, httpStatus: status, contentType: ct || null, size, finalUrl, error: null });
              return;
            }
            if (isManifestType(ct, currentUrl)) {
              const dash = /\.mpd(\?|#|$)/i.test(currentUrl) || ct.indexOf('dash+xml') !== -1;
              finish({ status: 'ok', type: dash ? 'dash' : 'hls', httpStatus: status, contentType: ct || null, size, finalUrl, error: null });
              return;
            }
            if (isMediaMime(ct)) {
              let t = typeFromUrl(currentUrl);
              if (t === 'unknown') t = ct.indexOf('audio/') === 0 ? 'audio' : 'mp4';
              finish({ status: 'ok', type: t, httpStatus: status, contentType: ct || null, size, finalUrl, error: null });
              return;
            }
            if (isMediaExt(currentUrl) && /^(video\/|audio\/|application\/octet-stream|binary\/octet-stream|application\/binary)/i.test(ct || 'application/octet-stream')) {
              finish({ status: 'ok', type: typeFromUrl(currentUrl), httpStatus: status, contentType: ct || null, size, finalUrl, error: null });
              return;
            }
            finish({ status: 'fail', httpStatus: status, contentType: ct || null, size, finalUrl, error: 'NOT_MEDIA' });
          };

          res.on('data', (chunk) => {
            if (len < 8192) {
              chunks.push(chunk);
              len += chunk.length;
              if (len >= 8192) { try { res.destroy(); } catch (e) {} }
            }
          });
          res.on('end', doneOnce);
          res.on('close', doneOnce);   // يصل عند destroy() المبكر
          res.on('error', doneOnce);
        });
        req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (e) {} });
        req.on('error', () => finish({ error: 'NETWORK' }));
        req.end();
      } catch (e) {
        return finish({ error: 'EXCEPTION' });
      }
    };

    requestAt(url);
  });
}

module.exports = { probeLink };

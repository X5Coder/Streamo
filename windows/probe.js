'use strict';
const http = require('http');
const https = require('https');

const TEST_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const MANIFEST_READ_BYTES = 65536;
const SEGMENT_PROBE_BYTES = 8192;

/* Link probe — HTTP Range request chain (unit-tested in isolation).
 * Multi-step verification so only genuinely playable links come back ok:
 *   1. Range GET with redirect chain (up to 5 hops)          -> status / Content-Type / magic bytes
 *   2. Content-Disposition: attachment anywhere              -> DOWNLOAD (never offered as playable)
 *   3. .mpd / DASH                                           -> DASH_BLOCKED (downloads, not streaming)
 *   4. ?bytes=5417-62932 partial captures                     -> RANGE_CAPTURE (never offered)
 *   5. HLS: manifest parsed, first variant + first segment fetched and sniffed
 *      (rejects expired tokens that answer 200 with an HTML error page, and
 *       disguised-ad playlists whose segments are images)
 * One request for the manifest — the first response body IS the manifest; we do
 * not re-download it for validation.
 */

const RANGE_CAPTURE_RE = /[?&]bytes=\d+-\d*/i;
const DASH_URL_RE = /\.mpd(\?|#|$)/i;
const ATTACHMENT_RE = /attachment/i;

const isRangeCapture = (url) => RANGE_CAPTURE_RE.test(String(url || ''));
const isDashUrl = (url) => DASH_URL_RE.test(String(url || ''));

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
/** Validate an HLS segment: real media (TS / fMP4 / audio container), never an image or an error page. */
function sniffSegment(bytes, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (/^image\//.test(ct)) return 'image'; // disguised-ad playlists use CDN images as segments
  if (!bytes || !bytes.length) return null;
  const is = (arr) => arr.every((v, i) => bytes[i] === v);
  if (bytes.length >= 4 && is([0x89, 0x50, 0x4E, 0x47])) return 'image';  // PNG
  if (bytes.length >= 3 && is([0xFF, 0xD8, 0xFF])) return 'image';         // JPEG
  if (bytes.length >= 4 && is([0x47, 0x49, 0x46, 0x38])) return 'image';   // GIF
  if (bytes.length >= 12) {
    const head = bytes.slice(0, 16).toString('latin1');
    if (head.indexOf('RIFF') === 0 && head.indexOf('WEBP') !== -1) return 'image'; // WebP
  }
  if (bytes[0] === 0x47) return 'ts';                                     // MPEG-TS
  const head12 = bytes.slice(0, 12).toString('latin1');
  if (head12.indexOf('ftyp') !== -1) return 'fmp4';                        // fragmented MP4
  if (head12.indexOf('OggS') !== -1) return 'other';
  if (head12.indexOf('#EXTM3U') !== -1) return 'other';                    // HLS audio-only variant
  return null;
}
/** 200 with an HTML error page is the classic expired-token shape */
function looksLikeHtml(bytes) {
  if (!bytes || !bytes.length) return false;
  const head = bytes.slice(0, Math.min(bytes.length, 512)).toString('latin1').toLowerCase();
  return head.indexOf('<html') !== -1 || head.indexOf('<!doctype') !== -1 || head.indexOf('<body') !== -1;
}

function baseHeaders(referer, rangeBytes) {
  const headers = {
    'Range': 'bytes=0-' + (rangeBytes - 1),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': '*/*'
  };
  if (referer) headers['Referer'] = referer;
  return headers;
}

/** One GET request (Range: bytes=0-N) with a redirect chain. Calls onDone(result) exactly once. */
function fetchOnce(startUrl, referer, readBytes, onDone) {
  let hops = 0;
  const requestAt = (currentUrl) => {
    let u;
    try { u = new URL(currentUrl); } catch (e) { return onDone({ error: 'BAD_URL' }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return onDone({ error: 'UNSUPPORTED' });
    const lib = u.protocol === 'https:' ? https : http;
    const headers = baseHeaders(referer, readBytes);
    let req;
    try {
      req = lib.request(u, { method: 'GET', headers, timeout: TEST_TIMEOUT_MS }, (res) => {
        const status = res.statusCode || 0;

        // 3xx → تبع السلسلة
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (hops >= MAX_REDIRECTS) return onDone({ error: 'TOO_MANY_REDIRECTS', httpStatus: status });
          hops += 1;
          let next;
          try { next = new URL(res.headers.location, currentUrl).href; }
          catch (e) { return onDone({ error: 'BAD_REDIRECT', httpStatus: status }); }
          if (isDashUrl(next)) return onDone({ error: 'DASH_BLOCKED', type: 'dash', httpStatus: status, finalUrl: next });
          if (isRangeCapture(next)) return onDone({ error: 'RANGE_CAPTURE', httpStatus: status, finalUrl: next });
          requestAt(next);
          return;
        }

        const chunks = [];
        let len = 0;
        let done = false;
        const ct = String(res.headers['content-type'] || '').toLowerCase();
        const disposition = String(res.headers['content-disposition'] || '');
        let size = null;
        const cr = res.headers['content-range'];
        if (cr) {
          const mRange = /\/(\d+)\s*$/.exec(cr);
          if (mRange) size = parseInt(mRange[1], 10) || null;
        }
        if (size === null && status !== 206) {
          const clRaw = res.headers['content-length'];
          size = clRaw ? (parseInt(String(clRaw), 10) || null) : null;
        }
        const finishOnce = () => {
          if (done) return;
          done = true;
          onDone({
            status,
            contentType: ct || null,
            contentDisposition: disposition || null,
            size,
            bytes: Buffer.concat(chunks),
            finalUrl: currentUrl,
            error: null
          });
        };
        res.on('data', (chunk) => {
          if (len < readBytes + 8192) {
            chunks.push(chunk);
            len += chunk.length;
            if (len >= readBytes + 8192) { try { res.destroy(); } catch (e) {} }
          }
        });
        res.on('end', finishOnce);
        res.on('close', finishOnce);
        res.on('error', finishOnce);
      });
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (e) {} });
      req.on('error', () => onDone({ error: 'NETWORK' }));
      req.end();
    } catch (e) {
      onDone({ error: 'EXCEPTION' });
    }
  };
  requestAt(startUrl);
}

/** First variant URI from a master playlist (skips I-frame streams and #EXT-X-* tags). */
function firstVariantUri(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/^#EXT-X-STREAM-INF/i.test(line)) continue;
    // the next non-empty, non-comment line is the variant URI
    for (let j = i + 1; j < lines.length; j++) {
      const v = lines[j].trim();
      if (!v) continue;
      if (v.charAt(0) === '#') continue;
      return v;
    }
  }
  return null;
}

/** First segment URI from a media playlist (skips tags; the URI is the next plain line). */
function firstSegmentUri(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.charAt(0) === '#') continue;
    return line;
  }
  return null;
}

/** Deep HLS check: manifest already in hand -> variant playlist -> first segment bytes. */
function validateHls(manifestUrl, referer, prefetched, done) {
  const consume = (finalUrl, bytes) => {
    if (!bytes || !bytes.length) { done({ ok: false, error: 'HLS_MANIFEST' }); return; }
    if (looksLikeHtml(bytes)) { done({ ok: false, error: 'HLS_HTML' }); return; }
    const text = String(bytes);
    if (text.indexOf('#EXTM3U') === -1) { done({ ok: false, error: 'HLS_NO_TAG' }); return; }

    // master playlist? then resolve the first variant and check that too
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const variant = firstVariantUri(text);
      if (!variant) { done({ ok: false, error: 'HLS_NO_VARIANT', isMaster: true }); return; }
      const variantUrl = (() => { try { return new URL(variant, finalUrl || manifestUrl).href; } catch (e) { return null; } })();
      if (!variantUrl) { done({ ok: false, error: 'HLS_BAD_VARIANT', isMaster: true }); return; }
      fetchOnce(variantUrl, referer, MANIFEST_READ_BYTES, (r2) => {
        if (!r2) return done({ ok: false, error: 'HLS_VARIANT', isMaster: true });
        if (r2.contentDisposition && ATTACHMENT_RE.test(r2.contentDisposition)) return done({ ok: false, error: 'DOWNLOAD', isMaster: true });
        if (r2.status < 200 || r2.status >= 300) return done({ ok: false, error: 'HTTP_' + r2.status, isMaster: true });
        if (looksLikeHtml(r2.bytes)) return done({ ok: false, error: 'HLS_VARIANT_HTML', isMaster: true });
        const text2 = String(r2.bytes || '');
        if (text2.indexOf('#EXTM3U') === -1) return done({ ok: false, error: 'HLS_VARIANT_NO_TAG', isMaster: true });
        probeSegment(text2, r2.finalUrl || variantUrl, referer, done, true);
      });
      return;
    }
    // media playlist directly
    if (!/#EXTINF|#EXT-X-TARGETDURATION/i.test(text)) { done({ ok: false, error: 'HLS_EMPTY_PLAYLIST', isMaster: false }); return; }
    probeSegment(text, finalUrl || manifestUrl, referer, done, false);
  };

  if (prefetched && prefetched.bytes) {
    consume(prefetched.finalUrl || manifestUrl, prefetched.bytes);
    return;
  }
  fetchOnce(manifestUrl, referer, MANIFEST_READ_BYTES, (r) => {
    if (!r) return done({ ok: false, error: 'HLS_MANIFEST' });
    if (r.error) return done(r.error === 'NETWORK' || r.error === 'TIMEOUT' ? { ok: false, error: 'HLS_MANIFEST' } : { ok: false, error: r.error });
    if (r.contentDisposition && ATTACHMENT_RE.test(r.contentDisposition)) return done({ ok: false, error: 'DOWNLOAD' });
    if (r.status < 200 || r.status >= 300) return done({ ok: false, error: 'HTTP_' + r.status });
    consume(r.finalUrl || manifestUrl, r.bytes);
  });
}

function probeSegment(playlistText, mediaUrl, referer, done, isMaster) {
  const seg = firstSegmentUri(playlistText);
  if (!seg) return done({ ok: false, error: 'HLS_EMPTY_PLAYLIST', isMaster: !!isMaster });
  const segUrl = (() => { try { return new URL(seg, mediaUrl).href; } catch (e) { return null; } })();
  if (!segUrl) return done({ ok: false, error: 'HLS_BAD_SEGMENT', isMaster: !!isMaster });
  fetchOnce(segUrl, referer, SEGMENT_PROBE_BYTES, (r3) => {
    if (!r3) return done({ ok: false, error: 'HLS_SEGMENT', isMaster: !!isMaster });
    if (r3.error) return done({ ok: false, error: 'HLS_SEGMENT', isMaster: !!isMaster });
    if (r3.contentDisposition && ATTACHMENT_RE.test(r3.contentDisposition)) return done({ ok: false, error: 'DOWNLOAD', isMaster: !!isMaster });
    if (r3.status < 200 || r3.status >= 300) return done({ ok: false, error: 'HLS_SEGMENT_HTTP', isMaster: !!isMaster });
    if (looksLikeHtml(r3.bytes)) return done({ ok: false, error: 'HLS_SEGMENT_HTML', isMaster: !!isMaster });
    const kind = sniffSegment(r3.bytes, r3.contentType);
    if (kind === 'image') return done({ ok: false, error: 'HLS_IMAGE_SEGMENT', isMaster: !!isMaster });
    if (!kind) return done({ ok: false, error: 'HLS_SEGMENT_NOT_MEDIA', isMaster: !!isMaster });
    return done({ ok: true, isMaster: !!isMaster });
  });
}

/**
 * Probe a single link. Resolves to the same shape as the legacy probe:
 * { url, status, type, duration, size, httpStatus, contentType, via, finalUrl, error, testedInMs, isMaster }
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

    // (0) never even try partial-capture or DASH links — they are downloads, not streaming
    if (isRangeCapture(url)) return finish({ status: 'fail', error: 'RANGE_CAPTURE' });
    if (isDashUrl(url)) return finish({ status: 'fail', type: 'dash', error: 'DASH_BLOCKED' });

    let referer = '';
    if (typeof pageUrl === 'string' && /^https?:\/\//i.test(pageUrl)) {
      try { referer = new URL(pageUrl).origin + '/'; } catch (e) { referer = ''; }
    }

    // One request for the whole candidate file/manifest — HLS bodies are read completely once.
    fetchOnce(url, referer, MANIFEST_READ_BYTES, (r) => {
      if (!r) return finish({ error: 'NETWORK' });
      if (r.error) {
        if (r.error === 'DASH_BLOCKED') return finish({ type: 'dash', error: 'DASH_BLOCKED', httpStatus: r.httpStatus || null, finalUrl: r.finalUrl || null });
        if (r.error === 'RANGE_CAPTURE') return finish({ error: 'RANGE_CAPTURE', httpStatus: r.httpStatus || null, finalUrl: r.finalUrl || null });
        if (r.error === 'TIMEOUT') return finish({ error: 'NETWORK' });
        return finish({ error: r.error, httpStatus: r.httpStatus || null, finalUrl: r.finalUrl || null });
      }
      const status = r.status;
      const ct = r.contentType || '';
      const size = r.size;
      const finalUrl = r.finalUrl !== url ? r.finalUrl : null;
      const okRange = status >= 200 && status < 300;

      // (1) downloads are never offered as playable streams
      if (r.contentDisposition && ATTACHMENT_RE.test(r.contentDisposition)) {
        return finish({ status: 'fail', httpStatus: status, contentType: ct || null, size, finalUrl, error: 'DOWNLOAD' });
      }

      const magic = sniffMagic(r.bytes);
      const treatAsHls = magic === 'hls' || isManifestType(ct, String(r.finalUrl || url));

      if (!okRange) {
        return finish({ status: 'fail', httpStatus: status, contentType: ct || null, size, finalUrl, error: 'HTTP_' + status });
      }

      // (3) HLS gets the full deep check — the manifest bytes are already in hand
      if (treatAsHls) {
        if (/\.mpd(\?|#|$)/i.test(String(r.finalUrl || url)) || ct.indexOf('dash+xml') !== -1) {
          return finish({ status: 'fail', type: 'dash', httpStatus: status, contentType: ct || null, size, finalUrl, error: 'DASH_BLOCKED' });
        }
        validateHls(String(r.finalUrl || url), referer, r, (v) => {
          if (v.ok) {
            finish({ status: 'ok', type: 'hls', httpStatus: status, contentType: ct || null, size, finalUrl, error: null, isMaster: !!v.isMaster });
          } else {
            finish({ status: 'fail', type: 'hls', httpStatus: status, contentType: ct || null, size, finalUrl, error: v.error || 'HLS_INVALID', isMaster: !!v.isMaster });
          }
        });
        return;
      }

      if (magic) {
        finish({ status: 'ok', type: magic, httpStatus: status, contentType: ct || null, size, finalUrl, error: null });
        return;
      }
      if (isMediaMime(ct)) {
        let t = typeFromUrl(String(r.finalUrl || url));
        if (t === 'unknown') t = ct.indexOf('audio/') === 0 ? 'audio' : 'mp4';
        if (t === 'dash') return finish({ status: 'fail', type: 'dash', httpStatus: status, contentType: ct || null, size, finalUrl, error: 'DASH_BLOCKED' });
        finish({ status: 'ok', type: t, httpStatus: status, contentType: ct || null, size, finalUrl, error: null });
        return;
      }
      // HTML error page disguised as plain text with no usable magic -> not a stream
      if (looksLikeHtml(r.bytes)) {
        return finish({ status: 'fail', httpStatus: status, contentType: ct || null, size, finalUrl, error: 'NOT_MEDIA' });
      }
      if (isMediaExt(String(r.finalUrl || url)) && /^(video\/|audio\/|application\/octet-stream|binary\/octet-stream|application\/binary)/i.test(ct || 'application/octet-stream')) {
        finish({ status: 'ok', type: typeFromUrl(String(r.finalUrl || url)), httpStatus: status, contentType: ct || null, size, finalUrl, error: null });
        return;
      }
      finish({ status: 'fail', httpStatus: status, contentType: ct || null, size, finalUrl, error: 'NOT_MEDIA' });
    });
  });
}

module.exports = { probeLink };

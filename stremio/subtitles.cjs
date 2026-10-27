'use strict';
const {redactURL} = require('./addons.cjs');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CUES = 10000;
const MAX_SECONDS = 24 * 60 * 60;
const LIMIT_MESSAGE = 'The subtitle file exceeds the size limit.';
const FORMAT_MESSAGE = 'This subtitle format is not supported yet. Choose a UTF-8 SRT or WebVTT subtitle.';
const bounded = (value, maximum, fallback) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;

function subtitleURL(value) {
  if (typeof value !== 'string' || value.length > 8192) throw Error('The subtitle URL is invalid.');
  let url;
  try { url = new URL(value); } catch { throw Error('The subtitle URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw Error('Subtitles require HTTP(S) URLs without embedded usernames or passwords.');
  url.hash = '';
  if (url.href.length > 8192) throw Error('The subtitle URL is invalid.');
  return url;
}

function timestamp(value) {
  const match = /^(?:(\d{1,4}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return null;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  return seconds <= MAX_SECONDS ? seconds : null;
}

function plainLines(value) {
  const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: ''};
  const text = String(value).slice(0, 4096).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  }).replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '');
  return text.split('\n').map(line => Array.from(line.replace(/\s+/g, ' ').trim()).slice(0, 200).join('')).filter(Boolean).slice(0, 3);
}

function parseSubtitle(value, {maxBytes = MAX_BYTES, maxCues = MAX_CUES} = {}) {
  if (typeof value !== 'string') throw Error(FORMAT_MESSAGE);
  if (Buffer.byteLength(value, 'utf8') > bounded(maxBytes, MAX_BYTES, MAX_BYTES)) throw Error(LIMIT_MESSAGE);
  const text = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text || /\x00|^\[Script Info\]|^\[V4\+? Styles\]/im.test(text)) throw Error(FORMAT_MESSAGE);
  const vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text);
  const blocks = (vtt ? text.replace(/^WEBVTT[^\n]*(?:\n|$)/, '') : text).split(/\n[ \t]*\n/);
  const cues = []; let timedCues = 0;
  const limit = bounded(maxCues, MAX_CUES, MAX_CUES);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines[0] || vtt && /^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[0])) continue;
    let index = lines[0].includes('-->') ? 0 : 1;
    const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[index] || '');
    if (!timing) continue;
    const start = timestamp(timing[1]), end = timestamp(timing[2]);
    if (start === null || end === null || end <= start) throw Error('The subtitle file contains invalid or out-of-range cue times.');
    if (++timedCues > limit) throw Error('The subtitle file contains too many cues.');
    const content = plainLines(lines.slice(index + 1).join('\n'));
    if (!content.length) continue;
    cues.push({start, end, lines: content});
  }
  if (!cues.length) throw Error(FORMAT_MESSAGE);
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

async function loadSubtitle(track, {fetchImpl = globalThis.fetch, signal, timeoutMs = 5000,
  maxBytes = MAX_BYTES, maxCues = MAX_CUES, onLog = () => {}} = {}) {
  const initial = subtitleURL(track?.url);
  if (/\.(ass|ssa)$/i.test(initial.pathname)) throw Error(FORMAT_MESSAGE);
  if (signal?.aborted) throw Error('The subtitle request was cancelled.');
  const controller = new AbortController();
  const cancelled = () => controller.abort();
  signal?.addEventListener('abort', cancelled, {once: true});
  const limit = bounded(maxBytes, MAX_BYTES, MAX_BYTES);
  let rejectAbort;
  const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
  const abortedListener = () => rejectAbort(Error(signal?.aborted ? 'The subtitle request was cancelled.' : 'The subtitle request timed out.'));
  controller.signal.addEventListener('abort', abortedListener, {once: true});
  const timer = setTimeout(() => controller.abort(), bounded(timeoutMs, 5000, 5000));
  const download = async () => {
    let url = initial;
    for (let redirects = 0; redirects <= 3; redirects++) {
      onLog(`Subtitle request: ${redactURL(url.href)}`);
      const response = await fetchImpl(url, {redirect: 'manual', signal: controller.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', headers: {accept: 'text/vtt, application/x-subrip, text/plain', 'user-agent': 'mac2jb-stremio-subtitles'}});
      if (controller.signal.aborted) throw Error('The subtitle request was cancelled.');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw Error('The subtitle provider redirected too many times.');
        let next;
        try { next = subtitleURL(new URL(location, url).href); } catch { throw Error('The subtitle provider returned an invalid redirect.'); }
        if (url.protocol === 'https:' && next.protocol !== 'https:') throw Error('The subtitle provider redirected to an insecure connection.');
        url = next; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw Error(`The subtitle request failed (HTTP ${response.status}).`); }
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error(LIMIT_MESSAGE); }
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(response.headers.get('content-type') || '')?.[1];
      if (charset && !/^(utf-?8|us-ascii)$/i.test(charset)) { await response.body?.cancel(); throw Error('This subtitle encoding is not supported yet. Choose a UTF-8 subtitle.'); }
      const pieces = []; let length = 0;
      for await (const bytes of response.body || []) {
        if (controller.signal.aborted) throw Error('The subtitle request was cancelled.');
        length += bytes.length;
        if (length > limit) throw Error(LIMIT_MESSAGE);
        pieces.push(Buffer.from(bytes));
      }
      let text;
      try { text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(pieces)); }
      catch { throw Error('This subtitle encoding is not supported yet. Choose a UTF-8 subtitle.'); }
      return parseSubtitle(text, {maxBytes: limit, maxCues});
    }
    throw Error('The subtitle provider redirected too many times.');
  };
  try { return await Promise.race([download(), aborted]); }
  catch (error) {
    if (signal?.aborted) throw Error('The subtitle request was cancelled.');
    if (controller.signal.aborted) throw Error('The subtitle request timed out.');
    if (/^(The subtitle|This subtitle|Subtitles require)/.test(error.message)) throw error;
    throw Error('The subtitle provider could not be reached.');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', abortedListener); controller.abort();
  }
}

function cueAt(cues, seconds) {
  if (!Array.isArray(cues) || !Number.isFinite(seconds) || seconds < 0) return [];
  let low = 0, high = cues.length;
  while (low < high) { const middle = (low + high) >>> 1; if (cues[middle].start <= seconds) low = middle + 1; else high = middle; }
  const active = [];
  for (let index = low - 1; index >= 0 && active.length < 3; index--) {
    const cue = cues[index];
    if (seconds < cue.end) active.unshift(...cue.lines);
  }
  return active.slice(0, 3);
}

module.exports = {MAX_BYTES, MAX_CUES, MAX_SECONDS, subtitleURL, timestamp, plainLines, parseSubtitle, loadSubtitle, cueAt};

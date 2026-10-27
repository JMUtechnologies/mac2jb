'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');

const MAX_BYTES = 2 * 1024 * 1024;
const MODEL_BYTES = 65536;
const bounded = (value, maximum, fallback) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
function artworkURL(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.hash = '';
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}
const artworkID = value => 'img_' + createHash('sha256').update(value).digest('hex').slice(0, 24);
function rasterHeader(bytes) {
  return bytes.length >= 12 && (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ||
    /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) ||
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ||
    bytes.subarray(0, 2).toString('ascii') === 'BM' ||
    bytes.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || bytes.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42])) ||
    bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(avif|avis)$/.test(bytes.subarray(8, 12).toString('ascii')));
}

class ArtworkCache {
  constructor({fetchImpl = globalThis.fetch, timeoutMs = 2500, maxBytes = MAX_BYTES,
    maxEntries = 32, maxConcurrent = 3, maxQueued = 32} = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = bounded(timeoutMs, 2500, 2500); this.maxBytes = bounded(maxBytes, MAX_BYTES, MAX_BYTES);
    this.maxEntries = bounded(maxEntries, 32, 32); this.maxConcurrent = bounded(maxConcurrent, 3, 3);
    this.maxQueued = bounded(maxQueued, 32, 32);
    this.entries = new Map(); this.queue = []; this.running = new Set();
    this.directory = null; this.closed = false; this.onArtworkReady = null; this.notifyHandle = null;
  }

  get(value, fetchImages = false) {
    if (this.closed) return null;
    const url = artworkURL(value);
    if (!url) return null;
    const found = this.entries.get(url);
    if (found) {
      this.entries.delete(url); this.entries.set(url, found);
      return found.status === 'ready' ? found.file : null;
    }
    if (!fetchImages || typeof this.fetchImpl !== 'function' || this.queue.length >= this.maxQueued) return null;
    if (this.entries.size >= this.maxEntries) {
      // Failed requests stay negative for this session. Only successful files are evicted.
      const evicted = [...this.entries].find(([, entry]) => entry.status === 'ready');
      if (!evicted) return null;
      this.entries.delete(evicted[0]);
      fs.promises.unlink(evicted[1].file).catch(() => {});
    }
    const entry = {url, status: 'queued', controller: new AbortController(), file: null};
    this.entries.set(url, entry); this.queue.push(entry); this._pump();
    return null;
  }

  _notify() {
    if (this.closed || this.notifyHandle || typeof this.onArtworkReady !== 'function') return;
    this.notifyHandle = setImmediate(() => {
      this.notifyHandle = null;
      if (this.closed || typeof this.onArtworkReady !== 'function') return;
      try { const result = this.onArtworkReady(); if (result?.catch) result.catch(() => {}); } catch {}
    });
    this.notifyHandle.unref?.();
  }

  _pump() {
    while (!this.closed && this.running.size < this.maxConcurrent && this.queue.length) {
      const entry = this.queue.shift();
      entry.status = 'loading';
      const task = this._run(entry);
      this.running.add(task);
      task.finally(() => { this.running.delete(task); this._pump(); }).catch(() => {});
    }
  }

  async _download(entry) {
    let url = entry.url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await this.fetchImpl(url, {redirect: 'manual', signal: entry.controller.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', headers: {accept: 'image/*', 'user-agent': 'mac2jb-stremio-artwork'}});
      if (entry.controller.signal.aborted) throw Error('Artwork request cancelled.');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        const next = location && artworkURL(new URL(location, url).href);
        if (redirects === 3 || !next || new URL(url).protocol === 'https:' && new URL(next).protocol !== 'https:')
          throw Error('Artwork redirect rejected.');
        url = next; continue;
      }
      if (!response.ok || Number(response.headers.get('content-length')) > this.maxBytes || !response.body)
        throw Error('Artwork response rejected.');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        if (entry.controller.signal.aborted) throw Error('Artwork request cancelled.');
        size += chunk.length;
        if (size > this.maxBytes) throw Error('Artwork exceeds the size limit.');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (!rasterHeader(bytes)) throw Error('Artwork is not a supported raster image.');
      return bytes;
    }
    throw Error('Artwork redirect rejected.');
  }

  async _run(entry) {
    let timer, cancelled;
    const aborted = new Promise((resolve, reject) => {
      cancelled = () => reject(Error('Artwork request cancelled.'));
      entry.controller.signal.addEventListener('abort', cancelled, {once: true});
      timer = setTimeout(() => entry.controller.abort(), this.timeoutMs); timer.unref?.();
    });
    try {
      const bytes = await Promise.race([this._download(entry), aborted]);
      if (this.closed || entry.controller.signal.aborted) { entry.status = 'failed'; return; }
      if (!this.directory) this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2jb-stremio-artwork-'));
      const file = path.join(this.directory, artworkID(entry.url) + '-' + randomBytes(6).toString('hex') + '.img');
      await fs.promises.writeFile(file, bytes, {mode: 0o600, flag: 'wx'});
      if (this.closed || entry.controller.signal.aborted) { entry.status = 'failed'; await fs.promises.unlink(file).catch(() => {}); return; }
      entry.file = file; entry.status = 'ready'; this._notify();
    } catch {
      entry.status = 'failed'; entry.controller.abort();
    } finally {
      clearTimeout(timer);
      entry.controller.signal.removeEventListener('abort', cancelled);
    }
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true; this.onArtworkReady = null;
    if (this.notifyHandle) clearImmediate(this.notifyHandle);
    this.notifyHandle = null; this.queue.length = 0;
    for (const entry of this.entries.values()) entry.controller.abort();
    this.closePromise = Promise.allSettled([...this.running]).then(async () => {
      this.entries.clear();
      if (this.directory) await fs.promises.rm(this.directory, {recursive: true, force: true});
    });
    return this.closePromise;
  }
}

let defaultCache;
function explicitPath(posterPaths, reference) {
  const value = posterPaths instanceof Map ? posterPaths.get(reference) :
    posterPaths && Object.prototype.hasOwnProperty.call(posterPaths, reference) ? posterPaths[reference] : null;
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value)) return null;
  try { const stat = fs.statSync(value); return stat.isFile() && stat.size <= MAX_BYTES ? value : null; } catch { return null; }
}

function prepareArtwork(model, {posterPaths, onArtworkReady, fetchImages = false, cache} = {}) {
  const prepared = {...model}; delete prepared._artwork;
  if (Array.isArray(model.cards)) prepared.cards = model.cards.map(card => ({...card}));
  if (model.hero && typeof model.hero === 'object') prepared.hero = {...model.hero};
  const explicit = posterPaths !== undefined;
  if (!explicit) {
    if (!cache && (fetchImages || defaultCache)) cache = defaultCache ||= new ArtworkCache();
    if (cache && fetchImages) cache.onArtworkReady = typeof onArtworkReady === 'function' ? onArtworkReady : null;
  }
  const references = [];
  if (prepared.hero) for (const field of ['poster', 'background', 'logo']) references.push([prepared.hero, field]);
  if (Array.isArray(prepared.cards)) for (const card of [...prepared.cards].sort((a, b) => Number(b.selected) - Number(a.selected)))
    references.push([card, 'poster']);
  const files = {};
  for (const [object, field] of references) {
    const reference = object[field];
    delete object[field];
    if (typeof reference !== 'string') continue;
    const file = explicit ? explicitPath(posterPaths, reference) : cache?.get(reference, fetchImages);
    if (!file) continue;
    const id = artworkID(reference); files[id] = file; object[field] = id;
  }
  if (Object.keys(files).length) {
    prepared._artwork = files;
    for (const id of Object.keys(files).reverse()) {
      if (Buffer.byteLength(JSON.stringify(prepared)) <= MODEL_BYTES) break;
      for (const [object, field] of references) if (object[field] === id) delete object[field];
      delete files[id];
    }
    if (!Object.keys(files).length) delete prepared._artwork;
  }
  return prepared;
}

function closeArtworkCache() {
  const cache = defaultCache; defaultCache = undefined;
  return cache ? cache.close() : Promise.resolve();
}

module.exports = {ArtworkCache, prepareArtwork, closeArtworkCache};

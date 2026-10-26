'use strict';
// Cloud LibraryItem times are milliseconds; all player callbacks use seconds.
const {clean, normalizeMeta} = require('./addons.cjs');
const MAX_SECONDS = 400 * 60 * 60;
const MAX_LIBRARY_ITEMS = 2000;
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
const milliseconds = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SECONDS * 1000 ? value : 0;
const seconds = value => Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS ? value : null;
function posterURL(value) {
  if (typeof value !== 'string' || value.length > 8192) return undefined;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function normalizeLibraryItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = identifier(raw._id), type = clean(raw.type, 64);
  if (!id || !type || type === 'other') return null;
  const state = raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state) ? {...raw.state} : {};
  state.timeOffset = milliseconds(state.timeOffset); state.duration = milliseconds(state.duration);
  if (state.duration && state.timeOffset >= state.duration) state.timeOffset = 0;
  state.video_id = identifier(state.video_id);
  return {...raw, _id: id, type, name: clean(raw.name) || id.slice(0, 80), poster: posterURL(raw.poster),
    removed: raw.removed === true, temp: raw.temp === true, state};
}
function normalizeLibrary(items) {
  if (!Array.isArray(items)) return [];
  const found = new Map();
  for (const raw of items.slice(0, MAX_LIBRARY_ITEMS)) {
    const item = normalizeLibraryItem(raw); if (item) found.set(item._id, item);
  }
  return [...found.values()];
}
function inContinue(item) { return item.type !== 'tv' && (!item.removed || item.temp) && item.state.timeOffset > 0; }
function libraryMeta(item) { return normalizeMeta({...item, id: item._id}, item.type); }
function resumePosition(item, videoId) {
  if (!item || item.type === 'tv') return 0;
  const stored = item.state.video_id || (item.type !== 'series' ? item.behaviorHints?.defaultVideoId || item._id : null);
  return stored === videoId ? item.state.timeOffset / 1000 : 0;
}
function updateLibraryItem(item, {videoId, position, duration, ended = false} = {}) {
  const validPosition = seconds(position), validDuration = seconds(duration);
  if (!item || !identifier(videoId) || validPosition === null || validDuration === null) return item;
  const offset = ended ? 0 : Math.round(Math.min(validPosition, validDuration || MAX_SECONDS) * 1000);
  return {...item, state: {...item.state, video_id: videoId, timeOffset: offset,
    duration: Math.round(validDuration * 1000)}};
}
module.exports = {MAX_SECONDS, MAX_LIBRARY_ITEMS, identifier, seconds, normalizeLibraryItem, normalizeLibrary,
  inContinue, libraryMeta, resumePosition, updateLibraryItem};

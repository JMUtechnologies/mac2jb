'use strict';
const DEFAULT_QUALITY = '720p';
const PROFILES = Object.freeze(Object.fromEntries([
  ['180p', 320, 180], ['360p', 640, 360], ['540p', 960, 540],
  ['720p', 1280, 720]
].map(([id, width, height]) => [id, Object.freeze({id, width, height, fps: 15})])));
function qualityProfile(value = DEFAULT_QUALITY) {
  if (typeof value !== 'string' || !Object.hasOwn(PROFILES, value))
    throw Error('Choose a supported playback quality: 180p, 360p, 540p or 720p.');
  return PROFILES[value];
}
module.exports = {DEFAULT_QUALITY, PROFILES, qualityProfile};

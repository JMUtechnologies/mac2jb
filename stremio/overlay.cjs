'use strict';
// Blend a cached transparent controls layer without modifying the decoded frame.
function composite(video, overlay, width, height) {
  const length = width * height * 4;
  if (!Buffer.isBuffer(video) || !Buffer.isBuffer(overlay) || video.length !== length || overlay.length !== length)
    throw Error('Playback overlay dimensions do not match the video frame.');
  const output = Buffer.from(video);
  for (let at = 0; at < length; at += 4) {
    const alpha = overlay[at + 3];
    if (!alpha) continue;
    const inverse = 255 - alpha;
    output[at] = Math.round((overlay[at] * alpha + video[at] * inverse) / 255);
    output[at + 1] = Math.round((overlay[at + 1] * alpha + video[at + 1] * inverse) / 255);
    output[at + 2] = Math.round((overlay[at + 2] * alpha + video[at + 2] * inverse) / 255);
    output[at + 3] = 255;
  }
  return output;
}
module.exports = {composite};

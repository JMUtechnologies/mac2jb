'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {composite} = require('./overlay.cjs');

test('transparent, half-opacity and opaque overlay pixels blend without modifying either input', () => {
  const video = Buffer.from([20, 40, 60, 255, 100, 150, 200, 255, 12, 34, 56, 255]);
  const overlay = Buffer.from([255, 0, 80, 0, 200, 50, 0, 128, 7, 8, 9, 255]);
  const originalVideo = Buffer.from(video), originalOverlay = Buffer.from(overlay);
  const result = composite(video, overlay, 3, 1);
  assert.deepEqual([...result], [20, 40, 60, 255, 150, 100, 100, 255, 7, 8, 9, 255]);
  assert.deepEqual(video, originalVideo); assert.deepEqual(overlay, originalOverlay);
  assert.notEqual(result, video); assert.notEqual(result, overlay);
});

test('overlay composition rejects buffers that do not match the chosen video dimensions', () => {
  assert.throws(() => composite(Buffer.alloc(8), Buffer.alloc(4), 2, 1), /dimensions/);
  assert.throws(() => composite(Buffer.alloc(4), Buffer.alloc(8), 2, 1), /dimensions/);
  assert.throws(() => composite(new Uint8Array(8), Buffer.alloc(8), 2, 1), /dimensions/);
  assert.throws(() => composite(Buffer.alloc(8), null, 2, 1), /dimensions/);
});

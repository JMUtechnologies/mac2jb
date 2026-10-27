'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {renderMenu, createMenuRenderer} = require('./menu.cjs');
const {playbackOverlayModel} = require('./playback-controls.cjs');

test('real overlay raster preserves every caption line above controls, below track pickers and with controls hidden', async t => {
  const python = process.env.STREMIO_TEST_PYTHON, fontPath = process.env.STREMIO_TEST_FONT;
  if (!python || !fs.existsSync(python) || !fontPath || !fs.existsSync(fontPath)) {
    t.skip('The portable Python/Pillow runtime and font are required.'); return;
  }
  const options = {python, fontPath, width: 1280, height: 720, overlay: true};
  for (const mode of ['hidden', 'controls', 'audio', 'subtitles']) {
    const model = {view: 'playing', playbackOverlay: playbackOverlayModel({visible: mode !== 'hidden',
      mode, title: 'A title', position: 20, duration: 600, audioTracks: [{id: 2, label: 'English', selected: true}],
      subtitleTracks: [{id: 'sub:eng', label: 'English', selected: true}]})};
    const baseline = await renderMenu(model, options);
    const captioned = await renderMenu({...model, subtitleLines: ['First caption line', 'Second caption line', 'Third caption line']}, options);
    const band = mode === 'controls' ? [220, 405] : mode === 'hidden' ? [500, 670] : [600, 720];
    const rows = new Set(); let bright = 0;
    for (let y = band[0]; y < band[1]; y++) for (let x = 80; x < 1200; x++) {
      const at = (y * 1280 + x) * 4;
      if (captioned[at] > 235 && captioned[at + 1] > 235 && captioned[at + 2] > 235 && captioned[at + 3] === 255 &&
          !captioned.subarray(at, at + 4).equals(baseline.subarray(at, at + 4))) { rows.add(y); bright++; }
    }
    // Three separated runs of visible glyphs prove gradients and option panels
    // did not erase any line. Caption backgrounds do not satisfy this check.
    let groups = 0, previous = -2;
    for (const y of [...rows].sort((a, b) => a - b)) { if (y > previous + 1) groups++; previous = y; }
    assert.equal(groups, 3, mode + ' retains three caption lines');
    assert.ok(bright > 300, mode + ' retains legible caption glyphs');
    assert.equal(captioned[(400 * 1280 + 20) * 4 + 3], mode === 'hidden' ? 0 : baseline[(400 * 1280 + 20) * 4 + 3]);
  }
});

test('persistent renderer serializes requests, matches fresh pixels and closes without another redraw', async t => {
  const python = process.env.STREMIO_TEST_PYTHON, fontPath = process.env.STREMIO_TEST_FONT;
  if (!python || !fs.existsSync(python) || !fontPath || !fs.existsSync(fontPath)) { t.skip('Portable renderer required.'); return; }
  const options = {python, fontPath, width: 1280, height: 720};
  const render = createMenuRenderer(options); t.after(() => render.close());
  const models = [0, 1, 0].map(selected => ({view: 'sources', title: 'Choose a source',
    rows: [{label: 'Source 1'}, {label: 'Source 2'}], selected}));
  const frames = await Promise.all(models.map(model => render(model)));
  assert.deepEqual(frames[0], frames[2]); assert.notDeepEqual(frames[0], frames[1]);
  assert.deepEqual(frames[1], await renderMenu(models[1], options));
  const overlay = {view: 'playing', playbackOverlay: playbackOverlayModel({visible: true, position: 10, duration: 60}), subtitleLines: ['Caption']};
  assert.deepEqual(await render(overlay, {overlay: true}), await renderMenu(overlay, {...options, overlay: true}));
  await assert.rejects(render({title: 'x'.repeat(65537)}), /size limit/);
  assert.deepEqual(await render(models[0]), frames[0]);
  await render.close();
  await assert.rejects(render(models[0]), /closed/);
});

test('closing an active persistent renderer rejects queued frames and stops its worker promptly', async t => {
  const python = process.env.STREMIO_TEST_PYTHON, fontPath = process.env.STREMIO_TEST_FONT;
  if (!python || !fs.existsSync(python) || !fontPath || !fs.existsSync(fontPath)) { t.skip('Portable renderer required.'); return; }
  const render = createMenuRenderer({python, fontPath}); t.after(() => render.close());
  const first = render({title: 'Pending render'}), second = render({title: 'Queued render'});
  const observed = Promise.allSettled([first, second]);
  await new Promise(resolve => setTimeout(resolve, 2));
  await render.close();
  assert.ok((await observed).every(result => result.status === 'rejected'));
});

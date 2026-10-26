'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createController, renderMenu} = require('./controller.cjs');

async function fixture(t, callbacks = {}) {
  const requests = [], calls = [], logs = [];
  let failCatalog = false;
  const instance = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture'); requests.push(url.pathname);
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/manifest.json') response.end(JSON.stringify({id: 'fixture', name: 'Fixture', types: ['series'],
      resources: ['catalog', 'meta', 'stream'], catalogs: [{id: 'top', name: 'Shows', type: 'series'}]}));
    else if (url.pathname.startsWith('/catalog/')) {
      if (failCatalog) response.writeHead(502).end('{}');
      else response.end(JSON.stringify({metas: Array.from({length: 11}, (_, index) => ({id: `show:${index}`, type: 'series', name: `Show ${index}`}))}));
    } else if (url.pathname.startsWith('/meta/')) response.end(JSON.stringify({meta: {id: 'show:0', type: 'series', name: 'Show 0',
      description: 'A real series metadata fixture.', videos: [{id: 'show:0:1:1', title: 'Pilot', season: 1, episode: 1}]}}));
    else if (url.pathname.startsWith('/stream/')) response.end(JSON.stringify({streams: [{name: 'Torrent source', infoHash: 'unsupported'},
      {name: 'Direct HLS', url: `http://127.0.0.1:${instance.address().port}/video.m3u8?token=STREAMSECRET`,
        behaviorHints: {proxyHeaders: {request: {Authorization: 'Bearer HEADERSECRET'}}}}]}));
    else response.writeHead(404).end('{}');
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  const defaults = Object.fromEntries(['play', 'pause', 'seek', 'stop', 'volume'].map(name => [name, async value => {calls.push({name, value});}]));
  const controller = createController({addonUrls: [`http://127.0.0.1:${instance.address().port}/manifest.json?apiKey=ADDONSECRET`],
    callbacks: {...defaults, ...callbacks}, onLog: value => logs.push(value)});
  assert.equal(await controller.init(), true);
  return {controller, calls, logs, requests, failCatalog: () => {failCatalog = true;}};
}

test('catalog, series episodes and sources lead to actual playback callbacks and controls', async t => {
  const {controller, calls, logs, requests} = await fixture(t);
  assert.equal(controller.getMenuModel().count, 11);
  assert.equal(controller.getMenuModel().rows.length, 8);
  await controller.handleButton('up');
  assert.equal(controller.getMenuModel().offset, 3);
  assert.equal(controller.getMenuModel().rows.at(-1).label, 'Show 10');
  await controller.handleButton('down');
  await controller.handleButton('a'); assert.equal(controller.getMenuModel().view, 'details');
  await controller.handleButton('a'); assert.equal(controller.getMenuModel().view, 'episodes');
  assert.match(controller.getMenuModel().rows[0].label, /S01E01.*Pilot/);
  await controller.handleButton('a'); assert.equal(controller.getMenuModel().view, 'sources');
  await controller.handleButton('a');
  assert.match(controller.getMenuModel().message, /Torrent sources/); assert.equal(calls.length, 0);
  await controller.handleButton('down'); await controller.handleButton('a');
  assert.equal(controller.getMenuModel().isPlaying, true);
  assert.equal(calls[0].name, 'play'); assert.match(calls[0].value.url, /video\.m3u8/);
  assert.equal(calls[0].value.headers.Authorization, 'Bearer HEADERSECRET');
  assert.equal(calls[0].value.meta.videoId, 'show:0:1:1');
  await controller.handleButton('a'); assert.equal(controller.playback.paused, true);
  await controller.handleButton('right'); await controller.handleButton('left');
  await controller.handleButton('down'); await controller.handleButton('up');
  controller.setPlaybackInfo({position: 65, duration: 600, paused: false, volume: 0.5});
  assert.match(controller.getMenuModel().subtitle, /1:05 \/ 10:00.*50%/);
  await controller.handleButton('b'); assert.equal(controller.getMenuModel().view, 'sources');
  assert.deepEqual(calls.slice(1).map(call => [call.name, call.value]), [['pause', undefined], ['seek', 10], ['seek', -10], ['volume', -0.05], ['volume', 0.05], ['stop', undefined]]);
  await controller.handleButton('b'); assert.equal(controller.getMenuModel().view, 'episodes');
  await controller.handleButton('b'); await controller.handleButton('b'); await controller.handleButton('b');
  assert.equal(controller.getMenuModel().view, 'catalogs');
  assert.ok(requests.some(route => /stream\/series\/show%3A0%3A1%3A1\.json/.test(route)));
  assert.ok(logs.every(message => !/ADDONSECRET|STREAMSECRET|HEADERSECRET/.test(message)));
});

test('network failure stays visible and stale playback start cannot override an asynchronous failure', async t => {
  let finishPlay, started;
  const entered = new Promise(resolve => {started = resolve;});
  const {controller, failCatalog} = await fixture(t, {play: async () => {started(); await new Promise(resolve => {finishPlay = resolve;});}});
  await controller.handleButton('a'); await controller.handleButton('a'); await controller.handleButton('a'); await controller.handleButton('down');
  const playing = controller.handleButton('a'); await entered;
  controller.playbackFailed('Decoder could not open https://user:secret@example.invalid/path?token=SECRET');
  finishPlay(); await playing;
  assert.equal(controller.getMenuModel().view, 'sources'); assert.equal(controller.getMenuModel().isPlaying, false);
  assert.match(controller.getMenuModel().message, /Decoder could not open/);
  assert.equal(controller.getMenuModel().message.includes('SECRET'), false);
  await controller.handleButton('b'); await controller.handleButton('b'); await controller.handleButton('b');
  failCatalog(); await controller.handleButton('x');
  assert.match(controller.getMenuModel().message, /HTTP 502/);
});

test('menu renderer produces a complete opaque frame with visible selection and bounded rows', async t => {
  const bundled = path.resolve(__dirname, '../.build-gui/homebrew');
  const python = process.env.STREMIO_TEST_PYTHON || (fs.existsSync(path.join(bundled, 'python/bin/python3')) ? path.join(bundled, 'python/bin/python3') : 'python3');
  const fontPath = process.env.STREMIO_TEST_FONT || (fs.existsSync(path.join(bundled, 'fonts/DejaVuSans.ttf')) ? path.join(bundled, 'fonts/DejaVuSans.ttf') : '');
  if (spawnSync(python, ['-c', 'from PIL import Image'], {env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}}).status !== 0) {
    t.skip('The portable Python/Pillow runtime is required for raster verification.'); return;
  }
  const model = {title: 'Stremio compatible · alpha', subtitle: 'Fixture catalog',
    rows: Array.from({length: 8}, (_, index) => ({label: `Movie ${index}`, detail: '2026'})), selected: 4,
    message: 'A source failed; select another source.', footer: 'A Select  B Back  X Refresh  Y Catalog'};
  const bytes = await renderMenu(model, {python, fontPath});
  assert.equal(bytes.length, 320 * 180 * 4);
  assert.ok(bytes.every((value, index) => index % 4 !== 3 || value === 255));
  assert.notDeepEqual(bytes.subarray((36 * 320 + 5) * 4, (36 * 320 + 5) * 4 + 4),
    bytes.subarray(((36 + 4 * 14) * 320 + 5) * 4, ((36 + 4 * 14) * 320 + 5) * 4 + 4));
});

test('closing the controller aborts pending addon networking and stops menu updates', async t => {
  let catalogStarted;
  const started = new Promise(resolve => {catalogStarted = resolve;});
  const instance = http.createServer((request, response) => {
    if (request.url === '/manifest.json') response.end(JSON.stringify({id: 'fixture', types: ['movie'], resources: ['catalog'],
      catalogs: [{id: 'slow', type: 'movie'}]}));
    else catalogStarted(); // A deliberately uncompleted real HTTP response.
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {instance.closeAllConnections(); instance.close(resolve);}));
  let updates = 0;
  const controller = createController({addonUrls: [`http://127.0.0.1:${instance.address().port}/manifest.json`],
    onChange: () => {updates++;}});
  const pending = controller.init(); await started;
  const atClose = updates, before = performance.now(); controller.close();
  assert.equal(await pending, false);
  assert.ok(performance.now() - before < 1000);
  assert.equal(updates, atClose);
  assert.equal(await controller.handleButton('a'), false);
});

test('TV metadata programme lists do not change channel stream IDs', async () => {
  const calls = [];
  const controller = createController({callbacks: {play: async source => {calls.push(source);}}});
  controller.view = 'details';
  controller.meta = {id: 'channel:1', type: 'tv', name: 'Fixture TV', description: '', releaseInfo: '',
    videos: [{id: 'programme:1', title: 'Now'}, {id: 'programme:2', title: 'Next'}]};
  controller.addons.streams = async (type, id) => {
    assert.equal(type, 'tv'); assert.equal(id, 'channel:1');
    return [{label: 'HTTP', addonName: 'Fixture', playable: true, url: 'https://media.example.invalid/live.m3u8', headers: {}}];
  };
  assert.equal(controller.getMenuModel().rows[0].label, 'Choose a stream');
  await controller.handleButton('a'); assert.equal(controller.view, 'sources');
  await controller.handleButton('a');
  assert.equal(calls[0].meta.videoId, 'channel:1');
  controller.close();
});

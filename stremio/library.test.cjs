'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('./library.cjs');
const {createController} = require('./controller.cjs');

const item = () => ({_id: 'show:7', type: 'series', name: 'Saved show', removed: false, temp: false,
  poster: 'https://images.example.invalid/poster.jpg', customTopLevel: {keep: true},
  state: {video_id: 'show:7:1:2', timeOffset: 52000, duration: 120000, watched: 'opaque-watched-state',
    lastWatched: '2026-10-25T12:00:00Z', timesWatched: 4, customState: {keep: true}}});

test('cloud milliseconds resume only the recorded video and local updates preserve unrelated fields', () => {
  const raw = item(), normalized = library.normalizeLibraryItem(raw);
  assert.equal(library.resumePosition(normalized, 'show:7:1:2'), 52);
  assert.equal(library.resumePosition(normalized, 'show:7:1:1'), 0);
  const updated = library.updateLibraryItem(normalized, {videoId: 'show:7:1:2', position: 73.5, duration: 120});
  assert.equal(updated.state.timeOffset, 73500);
  assert.equal(updated.state.duration, 120000);
  assert.equal(updated.state.watched, 'opaque-watched-state');
  assert.equal(updated.state.timesWatched, 4);
  assert.deepEqual(updated.state.customState, {keep: true});
  assert.deepEqual(updated.customTopLevel, {keep: true});
  assert.equal(raw.state.timeOffset, 52000);
  assert.equal(library.updateLibraryItem(updated, {videoId: 'show:7:1:2', position: 120, duration: 120, ended: true}).state.timeOffset, 0);
});

test('invalid cloud/player counters never produce an unsafe resume position', () => {
  for (const value of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER, '52000']) {
    const raw = item(); raw.state.timeOffset = value;
    assert.equal(library.normalizeLibraryItem(raw).state.timeOffset, 0);
  }
  for (const value of [-1, Infinity, NaN, library.MAX_SECONDS + 1]) {
    const original = library.normalizeLibraryItem(item());
    assert.equal(library.updateLibraryItem(original, {videoId: 'show:7:1:2', position: value, duration: 120}), original);
  }
  const complete = item(); complete.state.timeOffset = 121000;
  assert.equal(library.normalizeLibraryItem(complete).state.timeOffset, 0);
  const temporary = library.normalizeLibraryItem({...item(), removed: true, temp: true});
  assert.equal(library.inContinue(temporary), true);
  assert.equal(library.inContinue({...temporary, temp: false}), false);
  assert.equal(library.inContinue({...temporary, type: 'tv'}), false);
  assert.equal(library.normalizeLibraryItem({...item(), _id: 'bad\nID'}), null);
});

test('metadata for an unrelated item cannot replace the saved library identity', async () => {
  const {AddonClient} = require('./addons.cjs');
  const client = await new AddonClient('https://addon.example.invalid/manifest.json', {fetchImpl: async url =>
    new Response(JSON.stringify(new URL(url).pathname === '/manifest.json' ?
      {id: 'fixture', types: ['series'], resources: ['meta'], catalogs: []} :
      {meta: {id: 'unrelated', type: 'series', name: 'Wrong show'}}))}).init();
  assert.equal(await client.meta('series', 'show:7'), null);
});

function fetchFixture(routes) {
  return async url => {
    const pathname = new URL(url).pathname; routes.push(pathname);
    let value;
    if (pathname === '/manifest.json') value = {id: 'fixture', name: 'Fixture', types: ['series'],
      resources: ['catalog', 'meta', 'stream'], catalogs: [{id: 'top', type: 'series'}]};
    else if (pathname.startsWith('/meta/')) value = {meta: {id: 'show:7', type: 'series', name: 'Saved show',
      videos: [{id: 'show:7:1:1', title: 'First', season: 1, episode: 1},
        {id: 'show:7:1:2', title: 'Second', season: 1, episode: 2}]}};
    else if (pathname.startsWith('/stream/')) value = {streams: [{name: 'HTTP fixture', url: 'https://media.example.invalid/movie.mp4'}]};
    else value = {metas: []};
    return new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
  };
}

test('account library fetches the saved episode and sends exact resume identity to the player', async () => {
  const routes = [], plays = [];
  const controller = createController({addonUrls: ['https://addon.example.invalid/manifest.json'], libraryItems: [item()],
    fetchImpl: fetchFixture(routes), callbacks: {play: async source => {plays.push(source);}, stop: async () => {}}});
  assert.equal(await controller.init(), true);
  assert.match(controller.getMenuModel().subtitle, /Continue watching/);
  assert.equal(controller.getMenuModel().rows[0].label, 'Saved show');
  await controller.handleButton('a');
  assert.match(controller.getMenuModel().rows[0].label, /Resume at 0:52/);
  await controller.handleButton('a'); await controller.handleButton('a');
  assert.equal(plays[0].resumePosition, 52);
  assert.deepEqual(plays[0].meta, {id: 'show:7', type: 'series', videoId: 'show:7:1:2'});
  assert.equal(plays[0].libraryInfo.season, 1); assert.equal(plays[0].libraryInfo.episode, 2);
  assert.equal(plays[0].libraryInfo.poster, 'https://images.example.invalid/poster.jpg');
  assert.deepEqual(plays[0].libraryInfo.videoIds, ['show:7:1:1', 'show:7:1:2']);
  assert.ok(routes.includes('/stream/series/show%3A7%3A1%3A2.json'));
  controller.setPlaybackInfo({position: 72, duration: 120});
  await controller.handleButton('b'); // Hide playback controls before stopping.
  await controller.handleButton('b'); await controller.handleButton('b'); await controller.handleButton('b'); await controller.handleButton('b');
  assert.match(controller.getMenuModel().rows[0].label, /Resume at 1:12/);
  await controller.handleButton('down'); await controller.handleButton('a');
  assert.equal(controller.getMenuModel().view, 'episodes');
  assert.equal(controller.getMenuModel().rows[controller.selected].id, 'show:7:1:2');
  await controller.handleButton('b');
  assert.equal(controller.getMenuModel().view, 'seasons');
  assert.equal(controller.getMenuModel().rows[controller.selected].season, 1);
  await controller.handleButton('a'); await controller.handleButton('a'); await controller.handleButton('a');
  assert.equal(plays[1].resumePosition, 0);
  assert.equal(plays[1].libraryInfo.videoId, 'show:7:1:1');
  controller.setPlaybackInfo({position: 120, duration: 120}); controller.playbackEnded();
  assert.equal(controller.libraryItem.state.timeOffset, 0);
  assert.equal(controller.libraryItem.state.watched, 'opaque-watched-state');
  controller.close();
});

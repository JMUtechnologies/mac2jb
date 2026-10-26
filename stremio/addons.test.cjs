'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {AddonClient, AddonCollection, requestJSON, normalizeStream, manifestURL, redactText, DEFAULT_ADDON_URL} = require('./addons.cjs');

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('real HTTP addon routes honor resources, prefixes, encoding, query and stream headers', async t => {
  const seen = [], logs = [];
  const base = await server(t, (request, response) => {
    const url = new URL(request.url, 'http://fixture'); seen.push(url);
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/addon/manifest.json') response.end(JSON.stringify({id: 'fixture', name: 'Fixture addon', types: ['series'],
      resources: ['catalog', {name: 'meta', types: ['series'], idPrefixes: ['fixture:']},
        {name: 'stream', types: ['series'], idPrefixes: ['fixture:']}],
      catalogs: [{type: 'series', id: 'top / picks', name: 'Top', extra: [{name: 'search'}]}]}));
    else if (url.pathname.startsWith('/addon/catalog/')) response.end(JSON.stringify({metas: [{id: 'fixture:show', name: 'Fixture show', type: 'series'}]}));
    else if (url.pathname.startsWith('/addon/meta/')) response.end(JSON.stringify({meta: {id: 'fixture:show', name: 'Fixture show', type: 'series',
      videos: [{id: 'fixture:show:1/1', title: 'Pilot', season: 1, episode: 1}]}}));
    else if (url.pathname.startsWith('/addon/stream/')) response.end(JSON.stringify({streams: [{name: 'HLS', url: base + '/video.m3u8?token=STREAMSECRET',
      behaviorHints: {notWebReady: true, proxyHeaders: {request: {Authorization: 'Bearer HEADERSECRET', 'User-Agent': 'Fixture player'}}}}]}));
    else response.writeHead(404).end('{}');
  });
  const client = await new AddonClient(base + '/addon/manifest.json?key=ADDONSECRET', {onLog: value => logs.push(value)}).init();
  assert.equal(client.supports('stream', 'series', 'fixture:show:1/1'), true);
  assert.equal(client.supports('stream', 'movie', 'fixture:show'), false);
  assert.equal(client.supports('meta', 'series', 'unrelated'), false);
  assert.equal(await client.meta('series', 'unrelated'), null);
  const catalog = client.manifest.catalogs[0];
  const items = await client.catalog(catalog, {search: 'space & slash/', ignored: 'not forwarded'});
  assert.equal(items[0].name, 'Fixture show');
  assert.match(seen[1].pathname, /top%20%2F%20picks\/search=space%20%26%20slash%2F\.json$/);
  assert.equal(seen[1].searchParams.get('key'), 'ADDONSECRET');
  const meta = await client.meta('series', 'fixture:show');
  const sources = await client.streams('series', meta.videos[0].id);
  assert.match(seen.at(-1).pathname, /fixture%3Ashow%3A1%2F1\.json$/);
  assert.equal(sources[0].playable, true);
  assert.equal(sources[0].headers.Authorization, 'Bearer HEADERSECRET');
  assert.ok(logs.every(message => !/ADDONSECRET|STREAMSECRET|HEADERSECRET/.test(message)));
});

test('timeouts, size bounds, invalid JSON and redirect loops fail explicitly without URLs', async t => {
  const base = await server(t, (request, response) => {
    if (request.url === '/slow') setTimeout(() => response.end('{}'), 150).unref();
    else if (request.url === '/large') response.end(JSON.stringify({data: 'x'.repeat(500)}));
    else if (request.url === '/bad') response.end('not json');
    else if (request.url === '/loop') response.writeHead(302, {location: '/loop'}).end();
    else response.writeHead(503).end('https://user:password@example.invalid/?key=SECRET');
  });
  await assert.rejects(requestJSON(base + '/slow', {timeoutMs: 25}), /timed out/);
  await assert.rejects(requestJSON(base + '/large', {maxBytes: 64}), /size limit/);
  await assert.rejects(requestJSON(base + '/bad'), /invalid JSON/);
  await assert.rejects(requestJSON(base + '/loop'), /redirected too many/);
  await assert.rejects(requestJSON(base + '/error'), error => /HTTP 503/.test(error.message) && !error.message.includes('SECRET'));
});

test('unsupported stream types and unsafe headers never become executable playback requests', () => {
  for (const raw of [{infoHash: 'abc'}, {ytId: 'youtube-id'}, {externalUrl: 'https://example.invalid'},
    {url: 'file:///private/data'}, {url: 'https://user:password@example.invalid/movie'},
    {url: 'https://example.invalid/movie', behaviorHints: {proxyHeaders: {request: {Authorization: 'value\r\nInjected: yes'}}}}]) {
    const result = normalizeStream(raw, 'Fixture');
    assert.equal(result.playable, false); assert.ok(result.reason.length);
  }
  assert.equal(manifestURL('stremio://example.invalid/manifest.json').protocol, 'https:');
  assert.throws(() => manifestURL('https://example.invalid/configure'), /manifest.json/);
  assert.equal(new AddonCollection().urls[0], DEFAULT_ADDON_URL);
  const redacted = redactText('https://user:password@example.invalid/path/APISECRET?key=SECRET Authorization: Bearer TOKEN');
  assert.equal(/password|APISECRET|TOKEN|key=SECRET/.test(redacted), false);
});

test('one malformed addon does not hide a valid provider', async t => {
  const base = await server(t, (_, response) => response.end(JSON.stringify({id: 'working', types: ['movie'], resources: ['catalog'],
    catalogs: [{id: 'working', type: 'movie'}]})));
  const collection = await new AddonCollection({addonUrls: ['invalid-url', base + '/manifest.json']}).init();
  assert.equal(collection.errors.length, 1); assert.equal(collection.catalogs().length, 1);
});

module.exports = {server};

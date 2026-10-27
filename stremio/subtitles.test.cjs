'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {parseSubtitle, loadSubtitle, cueAt, plainLines, MAX_CUES, MAX_BYTES} = require('./subtitles.cjs');

const SRT = '1\r\n00:00:01,250 --> 00:00:03,000\r\n<b>Hello &amp; welcome</b>\r\n{\\an8}Second line\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,500\r\nAfter the gap\r\n';
const VTT = '\uFEFFWEBVTT\n\nSTYLE\n::cue { color: red; }\n\nNOTE ignored\ntext\n\nintro\n00:01.000 --> 00:03.000 align:start position:0%\n<v Narrator>Hello &lt;b&gt;viewer&lt;/b&gt;</v>\n\n00:02.000 --> 00:04.000\nOverlapping cue\n';

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('SRT and WebVTT produce bounded plain text with exact, seekable cue boundaries', () => {
  const cues = parseSubtitle(SRT);
  assert.deepEqual(cues[0], {start: 1.25, end: 3, lines: ['Hello & welcome', 'Second line']});
  assert.deepEqual(cueAt(cues, 1.249), []);
  assert.deepEqual(cueAt(cues, 1.25), ['Hello & welcome', 'Second line']);
  assert.deepEqual(cueAt(cues, 3), []);
  assert.deepEqual(cueAt(cues, 4), ['After the gap']);
  assert.deepEqual(cueAt(cues, 1.5), ['Hello & welcome', 'Second line']);
  assert.deepEqual(cueAt(cues, NaN), []);
  const vtt = parseSubtitle(VTT);
  assert.equal(vtt.length, 2);
  assert.deepEqual(cueAt(vtt, 2.5), ['Hello viewer', 'Overlapping cue']);
  assert.deepEqual(plainLines('<script>danger()</script><style>font</style>{\\pos(0,0)}A\\N B<br/>C\nD'), ['A', 'B', 'C']);
  assert.equal(plainLines('x'.repeat(1000))[0].length, 200);
  assert.equal(plainLines('&#0;&#xD800;&#x110000;Valid &#x1f44b;')[0], 'Valid 👋');
});

test('unknown formats, unsupported ASS, invalid times, cue counts and byte size fail clearly', () => {
  for (const value of ['', '<html>Not a subtitle</html>', '[Script Info]\nTitle: ASS\n[Events]\nDialogue: text'])
    assert.throws(() => parseSubtitle(value), /SRT or WebVTT/);
  for (const times of ['00:00:03,000 --> 00:00:02,000', '25:00:00,000 --> 25:00:01,000', '00:60:00,000 --> 01:00:01,000'])
    assert.throws(() => parseSubtitle('1\n' + times + '\nText'), /cue times/);
  const cue = '00:00:01,000 --> 00:00:02,000\nText\n\n';
  assert.throws(() => parseSubtitle(cue.repeat(MAX_CUES + 1)), /too many cues/);
  assert.throws(() => parseSubtitle('x'.repeat(MAX_BYTES + 1)), /size limit/);
  assert.throws(() => parseSubtitle(SRT, {maxCues: 1}), /too many cues/);
});

test('local HTTP subtitle fixtures support redirects and UTF-8 without exposing URL tokens', async t => {
  const logs = [], seen = [];
  const base = await server(t, (request, response) => {
    seen.push(request);
    if (request.url.startsWith('/redirect')) response.writeHead(302, {location: '/captions.vtt?key=PRIVATE'}).end();
    else response.writeHead(200, {'content-type': 'text/vtt; charset=utf-8'}).end(VTT);
  });
  const cues = await loadSubtitle({url: base + '/redirect?key=SECRET'}, {onLog: message => logs.push(message)});
  assert.equal(cues.length, 2); assert.equal(seen.length, 2);
  assert.equal(seen[0].headers.authorization, undefined);
  assert.equal(seen[0].headers.accept, 'text/vtt, application/x-subrip, text/plain');
  assert.ok(logs.every(message => !/SECRET|PRIVATE/.test(message)));
});

test('subtitle requests bound redirects, streamed bytes, encodings, timeouts and cancellation', async t => {
  const base = await server(t, (request, response) => {
    if (request.url === '/loop') response.writeHead(302, {location: '/loop'}).end();
    else if (request.url === '/large-header') response.writeHead(200, {'content-length': MAX_BYTES + 1}).end();
    else if (request.url === '/large-chunk') { response.writeHead(200); response.write('x'.repeat(40)); response.end('x'.repeat(40)); }
    else if (request.url === '/legacy') response.writeHead(200, {'content-type': 'text/plain; charset=windows-1252'}).end(SRT);
    else if (request.url === '/invalid-utf8') response.end(Buffer.from([0xc0, 0xaf]));
    else if (request.url === '/slow') setTimeout(() => response.end(SRT), 100).unref();
    else response.writeHead(503).end('https://secret:token@example.invalid/PRIVATE');
  });
  await assert.rejects(loadSubtitle({url: base + '/loop'}), /redirected too many/);
  await assert.rejects(loadSubtitle({url: base + '/large-header'}), /size limit/);
  await assert.rejects(loadSubtitle({url: base + '/large-chunk'}, {maxBytes: 64}), /size limit/);
  await assert.rejects(loadSubtitle({url: base + '/legacy'}), /UTF-8/);
  await assert.rejects(loadSubtitle({url: base + '/invalid-utf8'}), /UTF-8/);
  await assert.rejects(loadSubtitle({url: base + '/slow'}, {timeoutMs: 20}), /timed out/);
  const abort = new AbortController();
  const pending = loadSubtitle({url: base + '/slow'}, {signal: abort.signal});
  abort.abort(); await assert.rejects(pending, /cancelled/);
  await assert.rejects(loadSubtitle({url: base + '/error'}), error => /HTTP 503/.test(error.message) && !/PRIVATE|secret|token/.test(error.message));
});

test('URL and redirect policy never fetches local files, embedded credentials or insecure HTTPS redirects', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('', {status: 302, headers: {location: 'http://fixture.invalid/subtitle.srt?private=SECRET'}}); };
  for (const url of ['file:///private/subtitles.srt', 'https://user:password@fixture.invalid/subtitle.srt'])
    await assert.rejects(loadSubtitle({url}, {fetchImpl}), /HTTP\(S\).*embedded/);
  await assert.rejects(loadSubtitle({url: 'https://fixture.invalid/subtitle.ass'}, {fetchImpl}), /SRT or WebVTT/);
  assert.equal(calls, 0);
  await assert.rejects(loadSubtitle({url: 'https://fixture.invalid/subtitle.srt'}, {fetchImpl}), /insecure connection/);
  assert.equal(calls, 1);
  await assert.rejects(loadSubtitle({url: 'https://fixture.invalid/subtitle.srt'}, {fetchImpl: async () => { throw Error('PRIVATE URL SECRET'); }}),
    error => /could not be reached/.test(error.message) && !/SECRET|PRIVATE/.test(error.message));
});

test('timeouts and cancellation settle even if an injected transport ignores abort', async () => {
  const forever = async () => new Promise(() => {});
  await assert.rejects(loadSubtitle({url: 'https://fixture.invalid/subtitle.srt'}, {fetchImpl: forever, timeoutMs: 10}), /timed out/);
  const abort = new AbortController();
  const pending = loadSubtitle({url: 'https://fixture.invalid/subtitle.srt'}, {fetchImpl: forever, signal: abort.signal});
  abort.abort(); await assert.rejects(pending, /cancelled/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const decoder = require('./decoder.cjs');

const streams = [
  {index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080},
  {index: 2, codec_type: 'audio', codec_name: 'aac', tags: {language: 'jpn', title: 'Original'}, disposition: {default: 0}},
  {index: 4, codec_type: 'audio', codec_name: 'aac', tags: {language: 'eng', title: 'English Dub'}, disposition: {default: 1}},
  {index: 6, codec_type: 'subtitle', codec_name: 'srt', tags: {language: 'eng'}}
];

async function fixture(t, data = {streams, format: {duration: '240'}}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mac2jb-decoder-tracks-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const ffprobe = path.join(directory, 'ffprobe'), ffmpeg = path.join(directory, 'ffmpeg');
  const probeArgs = path.join(directory, 'probe-args.json'), decodeArgs = path.join(directory, 'decode-args.json');
  const writeTool = (name, source) => fs.writeFile(name, '#!' + process.execPath + '\n' + source + '\n', {mode: 0o700});
  await writeTool(ffprobe, `require('node:fs').writeFileSync(${JSON.stringify(probeArgs)}, JSON.stringify(process.argv.slice(2))); process.stdout.write(${JSON.stringify(JSON.stringify(data))});`);
  await writeTool(ffmpeg, `require('node:fs').writeFileSync(${JSON.stringify(decodeArgs)}, JSON.stringify(process.argv.slice(2)));`);
  return {config: {ffprobe, ffmpeg}, probeArgs, decodeArgs};
}

test('probe preserves original audio stream indexes, language, title and disposition default', async t => {
  const tool = await fixture(t);
  const info = await decoder.probe({url: 'https://fixture.invalid/movie'}, tool.config);
  assert.equal(info.hasAudio, true); assert.equal(info.audioTrackId, 4);
  assert.deepEqual(info.audioTracks.map(track => ({id: track.id, language: track.language, title: track.title, default: track.default})),
    [{id: 2, language: 'jpn', title: 'Original', default: false}, {id: 4, language: 'eng', title: 'English Dub', default: true}]);
  assert.equal(info.audioTracks[1].label, 'English — English Dub');
  const args = JSON.parse(await fs.readFile(tool.probeArgs, 'utf8'));
  assert.match(args[args.indexOf('-show_entries') + 1], /stream=index.*stream_tags=language,title:stream_disposition=default/);
});

test('decoder maps a selected numeric original stream index, and defaults to the disposition track', async t => {
  const tool = await fixture(t);
  for (const selection of [undefined, 2]) {
    const playback = await decoder.create({url: 'https://fixture.invalid/movie'}, {config: tool.config, audioTrackId: selection, position: 12.5, quality: '720p'});
    await playback.done;
    const args = JSON.parse(await fs.readFile(tool.decodeArgs, 'utf8'));
    const maps = args.flatMap((value, index) => value === '-map' ? [args[index + 1]] : []);
    assert.deepEqual(maps, ['0:v:0', selection === undefined ? '0:4' : '0:2']);
    assert.equal(playback.info.audioTrackId, selection ?? 4);
    assert.equal(args[args.indexOf('-ss') + 1], '12.5');
    assert.ok(args.includes(`fps=${decoder.FPS},scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:720:(ow-iw)/2:(oh-ih)/2`));
  }
  await assert.rejects(decoder.create({url: 'https://fixture.invalid/movie'}, {config: tool.config, audioTrackId: 6}), /unavailable/);
  await assert.rejects(decoder.create({url: 'https://fixture.invalid/movie'}, {config: tool.config, audioTrackId: 1}), /unavailable/);
  for (const audioTrackId of ['2', '0:a:0', -1, 1.5, Infinity, null])
    await assert.rejects(decoder.create({url: 'https://fixture.invalid/movie'}, {audioTrackId}), /Invalid audio track/);
});

test('video-only sources omit audio maps and malformed audio stream metadata is bounded', async t => {
  const tool = await fixture(t, {streams: [streams[0]], format: {duration: '30'}});
  const playback = await decoder.create({url: 'https://fixture.invalid/movie'}, {config: tool.config});
  await playback.done;
  assert.equal(playback.info.hasAudio, false); assert.deepEqual(playback.info.audioTracks, []); assert.equal(playback.info.audioTrackId, null);
  const args = JSON.parse(await fs.readFile(tool.decodeArgs, 'utf8'));
  assert.equal(args.filter(value => value === '-map').length, 1);
  const tracks = decoder.audioTracks([
    {index: '1', codec_type: 'audio'}, {index: -2, codec_type: 'audio'},
    {index: 3, codec_type: 'audio', tags: {title: 'x\n'.repeat(200), language: 'invalid{}'}},
    {index: 3, codec_type: 'audio'}, {index: 8, codec_type: 'audio'}
  ]);
  assert.equal(tracks.length, 2); assert.equal(tracks[0].title.length, 120); assert.equal(tracks[1].language, 'und');
  assert.equal(decoder.selectAudioTrack({audioTracks: tracks}), 3);
});

test('real FFmpeg switches between generated language tones using the original audio stream index', async t => {
  let tools;
  try { tools = await decoder.tools(); } catch { t.skip('Install Stremio to run the real decoder check.'); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mac2jb-language-tones-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'languages.mp4');
  await run(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=160x90:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
    '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-t', '0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-metadata:s:a:0', 'language=jpn', '-metadata:s:a:1', 'language=eng',
    '-disposition:a:0', '0', '-disposition:a:1', 'default', '-movflags', 'faststart', file]);
  const bytes = await fs.readFile(file);
  const instance = http.createServer((request, response) => response.writeHead(200,
    {'content-type': 'video/mp4', 'content-length': bytes.length}).end(bytes));
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  const source = {url: `http://127.0.0.1:${instance.address().port}/languages.mp4`};
  const info = await decoder.probe(source);
  assert.deepEqual(info.audioTracks.map(track => track.language), ['jpn', 'eng']);
  assert.equal(info.audioTrackId, info.audioTracks[1].id);
  for (const [audioTrackId, expectedTone] of [[info.audioTracks[0].id, 440], [undefined, 880]]) {
    const pieces = [];
    const playback = await decoder.create(source, {quality: '180p', audioTrackId,
      onAudio: pcm => { if (pieces.length < 3) pieces.push(Buffer.from(pcm)); }});
    await playback.done;
    const pcm = Buffer.concat(pieces);
    assert.equal(pcm.length, 3 * 19200);
    let crossings = 0, previous = pcm.readInt16LE(0);
    for (let offset = 4; offset < pcm.length; offset += 4) {
      const sample = pcm.readInt16LE(offset);
      if (sample >= 0 && previous < 0 || sample < 0 && previous >= 0) crossings++;
      previous = sample;
    }
    const frequency = crossings / 2 / (pcm.length / 4 / 48000);
    assert.ok(Math.abs(frequency - expectedTone) < 30, `selected ${audioTrackId ?? 'default'} produced ${frequency.toFixed(1)} Hz`);
  }
});

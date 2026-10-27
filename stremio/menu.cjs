'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {prepareArtwork, closeArtworkCache} = require('./artwork.cjs');
const root = path.resolve(__dirname, '..');
const WIDTH = 1280, HEIGHT = 720;
const {PROFILES} = require('./quality.cjs');
const {buildNavigation} = require('./navigation.cjs');

function prepare(model, {python, fontPath, width = WIDTH, height = HEIGHT, timeoutMs = 10000,
  posterPaths, fetchImages = false, onArtworkReady, overlay = false} = {}) {
  if (!Object.values(PROFILES).some(profile => profile.width === width && profile.height === height))
    throw Error('Unsupported menu dimensions.');
  if (!model.navigation && !overlay) {
    const view = model.view || (model.cards ? 'catalog' : 'sources');
    model = {...model, navigation: buildNavigation({...model, view})};
  }
  const bundledPython = path.join(root, 'homebrew/python/bin/python3');
  const bundledFont = path.join(root, 'homebrew/fonts/DejaVuSans.ttf');
  python ||= fs.existsSync(bundledPython) ? bundledPython : 'python3';
  fontPath ||= process.env.MAC2JB_HBLAUNCHER_FONT || (fs.existsSync(bundledFont) ? bundledFont : '');
  const original = JSON.stringify(model);
  if (Buffer.byteLength(original) > 65536) throw Error('The menu model exceeds the size limit.');
  let input;
  try {input = JSON.stringify(prepareArtwork(model, {posterPaths, fetchImages, onArtworkReady}));}
  catch {throw Error('The menu artwork could not be prepared.');}
  if (Buffer.byteLength(input) > 65536) throw Error('The menu model exceeds the size limit.');
  const env = {...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1'};
  delete env.PYTHONHOME;
  return {python, fontPath, width, height, timeoutMs, overlay, input, env};
}
async function renderMenu(model, options = {}) {
  const {python, fontPath, width, height, timeoutMs, overlay, input, env} = prepare(model, options);
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(__dirname, 'menu.py'), '--font', fontPath,
      '--width', String(width), '--height', String(height), ...(overlay ? ['--overlay'] : [])], {env, stdio: ['pipe', 'pipe', 'pipe']});
    const parts = []; let length = 0, timedOut = false;
    const timer = setTimeout(() => {timedOut = true; child.kill('SIGTERM');}, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', bytes => {
      length += bytes.length;
      if (length > width * height * 4) child.kill('SIGTERM');
      else parts.push(bytes);
    });
    child.stderr.resume();
    child.once('error', error => {clearTimeout(timer); reject(Error('The bundled menu renderer could not start: ' + error.code));});
    child.stdin.on('error', () => {});
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) {reject(Error('The menu renderer timed out.')); return;}
      if (code !== 0 || length !== width * height * 4) {reject(Error('The menu renderer did not return a complete RGBA frame.')); return;}
      resolve(Buffer.concat(parts));
    });
    child.stdin.end(input);
  });
}

// One owned interpreter per menu/overlay geometry retains Pillow and font caches
// between button presses. Requests remain serial and complete fixed-size frames.
function createMenuRenderer(defaults = {}) {
  const workers = new Map(); let tail = Promise.resolve(), closed = false;
  function workerFor(config) {
    const key = JSON.stringify([config.python, config.fontPath, config.width, config.height, config.overlay]);
    if (workers.has(key)) return workers.get(key);
    if (workers.size >= 2) throw Error('Too many menu renderer geometries.');
    const {python, fontPath, width, height, overlay, env} = config;
    const child = spawn(python, [path.join(__dirname, 'menu.py'), '--worker', '--font', fontPath,
      '--width', String(width), '--height', String(height), ...(overlay ? ['--overlay'] : [])],
      {env, stdio: ['pipe', 'pipe', 'pipe']});
    let active, failure, exited = false;
    const ended = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
    function fail(error) {
      failure ||= error;
      if (active) { clearTimeout(active.timer); active.reject(failure); active = undefined; }
      if (!exited) child.kill('SIGTERM');
    }
    child.stderr.resume();
    child.on('error', error => fail(Error('The bundled menu renderer could not start: ' + error.code)));
    child.on('close', () => { if (active || !closed) fail(Error('The menu renderer ended before returning a complete RGBA frame.')); });
    child.stdin.on('error', () => fail(Error('The menu renderer input closed.')));
    child.stdout.on('data', bytes => {
      if (!active) { fail(Error('Unexpected menu renderer output.')); return; }
      active.length += bytes.length;
      if (active.length > width * height * 4) { fail(Error('The menu renderer returned an oversized frame.')); return; }
      active.parts.push(bytes);
      if (active.length === width * height * 4) {
        const request = active; active = undefined; clearTimeout(request.timer);
        request.resolve(Buffer.concat(request.parts, request.length));
      }
    });
    const worker = {
      render(input, timeoutMs) {
        if (failure) return Promise.reject(failure);
        return new Promise((resolve, reject) => {
          active = {parts: [], length: 0, resolve, reject,
            timer: setTimeout(() => fail(Error('The menu renderer timed out.')), timeoutMs)};
          active.timer.unref?.(); child.stdin.write(input + '\n');
        });
      },
      async close() {
        fail(Error('The menu renderer is closed.'));
        const kill = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 1000); kill.unref?.();
        await ended; clearTimeout(kill);
      }
    };
    workers.set(key, worker); return worker;
  }
  const render = (model, options = {}) => {
    let config;
    try { config = prepare(model, {...defaults, ...options}); } catch (error) { return Promise.reject(error); }
    const result = tail.then(() => {
      if (closed) throw Error('The menu renderer is closed.');
      return workerFor(config).render(config.input, config.timeoutMs);
    });
    tail = result.catch(() => {}); return result;
  };
  render.close = async () => { closed = true; await Promise.all([...workers.values()].map(worker => worker.close())); await tail; };
  return render;
}
module.exports = {WIDTH, HEIGHT, renderMenu, createMenuRenderer, closeArtworkCache};

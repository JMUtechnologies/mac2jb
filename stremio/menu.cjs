'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');

function renderMenu(model, {python, fontPath, timeoutMs = 10000} = {}) {
  const bundledPython = path.join(root, 'homebrew/python/bin/python3');
  const bundledFont = path.join(root, 'homebrew/fonts/DejaVuSans.ttf');
  python ||= fs.existsSync(bundledPython) ? bundledPython : 'python3';
  fontPath ||= process.env.MAC2JB_HBLAUNCHER_FONT || (fs.existsSync(bundledFont) ? bundledFont : '');
  const input = JSON.stringify(model);
  if (Buffer.byteLength(input) > 65536) return Promise.reject(Error('The menu model exceeds the size limit.'));
  const env = {...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1'};
  delete env.PYTHONHOME;
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(__dirname, 'menu.py'), '--font', fontPath], {env, stdio: ['pipe', 'pipe', 'pipe']});
    const parts = []; let length = 0, diagnostic = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', bytes => {
      length += bytes.length;
      if (length > 320 * 180 * 4) child.kill('SIGTERM');
      else parts.push(bytes);
    });
    child.stderr.on('data', bytes => { if (diagnostic.length < 2048) diagnostic += bytes.toString(); });
    child.once('error', error => { clearTimeout(timer); reject(Error('The bundled menu renderer could not start: ' + error.code)); });
    child.stdin.on('error', () => {});
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) { reject(Error('The menu renderer timed out.')); return; }
      if (code !== 0 || length !== 320 * 180 * 4) { reject(Error('The menu renderer did not return a complete RGBA frame.')); return; }
      resolve(Buffer.concat(parts));
    });
    child.stdin.end(input);
  });
}

module.exports = {renderMenu};

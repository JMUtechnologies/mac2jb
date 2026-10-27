const fs = require('node:fs/promises');
const path = require('node:path');

async function inspectOwner(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || process.platform !== 'linux') return null;
  try {
    const root = await fs.realpath('/proc/' + pid + '/cwd');
    const args = (await fs.readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\0');
    if (!args.some(arg => arg && path.resolve(root, arg) === path.join(root, 'start.cjs'))) return null;
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const state = JSON.parse(await fs.readFile(path.join(root, 'data/state/window.json'), 'utf8'));
    if (manifest.name !== 'iz2s-platform' || state.pid !== pid || state.preview) return null;
    return { root, version: state.version };
  } catch { return null; }
}

async function handover({ root, port, probe = async () => {
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}, inspect = inspectOwner, stop = pid => process.kill(pid, 'SIGTERM'),
alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } },
sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 20000 }) {
  const health = await probe();
  if (!health) return false;
  const owner = await inspect(health.pid);
  if (!owner || owner.version !== health.version || health.preview)
    throw Error('The panel port is occupied by an unverified process. Close that application before starting IZ2S Platform.');
  if (path.resolve(owner.root) === path.resolve(root)) return false;
  console.log('Stopping the preceding IZ2S Platform panel before starting this release.');
  try { stop(health.pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let elapsed = 0; alive(health.pid); elapsed += 100) {
    if (elapsed >= timeout) throw Error('The preceding panel is still stopping. Wait before retrying.');
    await sleep(100);
  }
  return true;
}

module.exports = { handover, inspectOwner };

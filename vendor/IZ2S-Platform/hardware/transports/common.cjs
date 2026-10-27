const fs = require('node:fs/promises'),
  path = require('node:path'),
  { spawn } = require('node:child_process');
function invoke(
  file,
  args,
  { input, env = process.env, timeout = 30000, onEvent } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '',
      errors = '',
      tail = '',
      done = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(Error('Input service timed out; commands were not retried'));
    }, timeout);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    }
    child.stdout.on('data', (part) => {
      output += part;
      tail += part;
      let at;
      while ((at = tail.indexOf('\n')) >= 0) {
        const line = tail.slice(0, at);
        tail = tail.slice(at + 1);
        if (onEvent && line)
          try {
            onEvent(JSON.parse(line));
          } catch (e) {
            child.kill('SIGTERM');
            finish(e);
          }
      }
    });
    child.stderr.on('data', (b) => (errors = (errors + b).slice(-4000)));
    child.on('error', finish);
    child.on('close', (code) =>
      finish(
        code ? Error(errors.trim() || 'Input service stopped') : null,
        output,
      ),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
async function bundle(root) {
  return require('../agents.cjs').files(root);
}
async function plan(root, value) {
  if (
    !value ||
    !/^[a-f\d-]{36}$/.test(value.id || '') ||
    !Array.isArray(value.steps) ||
    value.steps.length > 4096
  )
    throw Error('Invalid input plan');
  const allowed = new Set([
    'enter',
    'escape',
    'f4',
    'f7',
    'f8',
    'home',
    'end',
    'left',
    'right',
    'up',
    'down',
    'backspace',
    'delete',
    'capslock',
    'tab',
  ]);
  const steps = value.steps.map((step) => {
    if (!step || !['line', 'key', 'sleep'].includes(step.type))
      throw Error('Invalid input plan step');
    if (
      step.type === 'line' &&
      (typeof step.text !== 'string' ||
        step.text.length > 2048 ||
        /[^\x20-\x7e]/.test(step.text))
    )
      throw Error('A typed line must be printable ASCII');
    if (step.type === 'key' && !allowed.has(step.key))
      throw Error('Unsupported input key');
    const delay = step.type === 'sleep' ? step.ms : (step.delayMs ?? 500);
    if (!Number.isInteger(delay) || delay < 0 || delay > 120000)
      throw Error('Invalid input delay');
    return { ...step, [step.type === 'sleep' ? 'ms' : 'delayMs']: delay };
  });
  let source = null;
  if (value.sourceFile) {
    const absolute = await fs.realpath(path.resolve(root, value.sourceFile));
    if (!absolute.startsWith(path.resolve(root) + path.sep))
      throw Error('Input source must belong to this IZlauncher directory');
    source = (await fs.readFile(absolute)).toString('utf8');
    if (
      Buffer.byteLength(source) > 131072 ||
      /[^\x09\x0a\x0d\x20-\x7e]/.test(source)
    )
      throw Error('Bootstrap source must be bounded ASCII text');
  }
  const sourceAfter = value.sourceAfter ?? steps.length;
  if (
    !Number.isInteger(sourceAfter) ||
    sourceAfter < 0 ||
    sourceAfter > steps.length
  )
    throw Error('Invalid source insertion point');
  return { requestId: value.id, action: 'plan', steps, source, sourceAfter };
}
module.exports = { invoke, bundle, plan };

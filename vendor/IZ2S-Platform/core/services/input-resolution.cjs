// Resolve lazy HID imports through the SDK signatures already used by the SDK.
const signatures = Object.values(require('../console/abi/hid-functions.json'));
const signature = name => signatures.find(entry => entry.symbol === name);

async function resolveInput(rpc, name, slot) {
  const importTarget = Number((await rpc.read(rpc.a.main + slot, 8)).readBigUInt64LE());
  if (!Number.isSafeInteger(importTarget) || !importTarget) throw Error('Invalid input import: ' + name);
  const lazy = importTarget === rpc.a.main + 0x29b850;
  const known = lazy && signature(name);
  if (lazy && !known) return {slot, target: importTarget, unresolved: true};
  const target = known ? rpc.a.sdk + known.offset : importTarget;
  const region = await rpc.query(target);
  if (!Number.isSafeInteger(target) || region.result || region.permissions !== 5 || region.ipcReferences ||
      target < region.address || target >= region.address + region.size)
    throw Error('Input import is not in executable memory: ' + name);
  const bytes = await rpc.read(target, Math.min(256, region.address + region.size - target));
  if (known) {
    const expected = Buffer.from(known.hex, 'hex');
    if (bytes.length < expected.length || !bytes.subarray(0, expected.length).equals(expected))
      throw Error('SDK input signature differs: ' + name);
    await rpc.request({command: 'verify-function', address: target, hex: known.hex});
  }
  return {slot, target, region, bytes: bytes.toString('hex'),
    ...(known ? {importTarget, resolution: 'verified-sdk', sdkOffset: known.offset} : {})};
}

async function verifyInput(rpc, name, input) {
  if (!input?.bytes) throw Error('Input inspection is incomplete: ' + name);
  const current = Number((await rpc.read(rpc.a.main + input.slot, 8)).readBigUInt64LE());
  let hex = input.bytes.slice(0, 64);
  if (input.resolution === 'verified-sdk') {
    const known = signature(name);
    if (!known || input.sdkOffset !== known.offset || input.target !== rpc.a.sdk + known.offset ||
        input.importTarget !== rpc.a.main + 0x29b850 ||
        (current !== input.importTarget && current !== input.target))
      throw Error('SDK input function or import changed: ' + name);
    hex = known.hex;
  } else if (current !== input.target) throw Error('Input function changed: ' + name);
  await rpc.request({command: 'verify-function', address: input.target, hex});
}

module.exports = {resolveInput, verifyInput};

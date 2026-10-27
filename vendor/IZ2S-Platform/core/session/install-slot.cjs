// Installation slots are panel settings; they never change an engine's START ABI.
function validate(value) {
  if (!Number.isInteger(value) || value < 0 || value > 3)
    throw Error('Choose an installation slot from 0 to 3');
  return value;
}
function resolve(value, fallback = 0) {
  return validate(value === undefined ? fallback : value);
}
function commands(name, slot) {
  validate(slot);
  if (!/^[A-Z0-9_]{1,16}$/.test(name))
    throw Error('Invalid bootstrap save name');
  return { list: `LIST ${slot}:1`, save: `SAVE "TXT:${name}",${slot}` };
}
module.exports = { validate, resolve, commands };

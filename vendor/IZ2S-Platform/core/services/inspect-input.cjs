// Resolve input imports afresh for the connected console session.
const fs = require('node:fs/promises');
const path = require('node:path');
const {resolveInput} = require('./input-resolution.cjs');
async function main(directory) {
  directory = path.resolve(directory);
  const rpc = require(path.join(directory, 'shared/rpc.cjs'));
  const imports = require('./input-imports.json');
  const report = {session: rpc.a.session, started: new Date().toISOString(), imports: {}};
  for (const [name, {slot}] of Object.entries(imports)) {
    report.imports[name] = await resolveInput(rpc, name, slot);
  }
  for (const name of [
    '_ZN2nn3hid12GetNpadStateEPNS0_17NpadHandheldStateERKj',
    '_ZN2nn3hid19GetTouchScreenStateILm16EEEvPNS0_16TouchScreenStateIXT_EEE'
  ]) if (!report.imports[name].bytes) throw Error('Required input import unresolved: ' + name);
  report.completed = new Date().toISOString();
  await fs.writeFile(path.join(directory, 'input-inspection.json'), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
  console.log('Resolved input imports for ' + rpc.a.session);
}
if (require.main === module) main(process.argv[2]).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

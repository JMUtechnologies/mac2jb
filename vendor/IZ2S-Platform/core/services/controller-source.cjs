// Compatibility import; resolve the verified controller module, including package-only installs.
module.exports=require(require('../module-files.cjs').resolve('controllers','server/controller-source.cjs'));

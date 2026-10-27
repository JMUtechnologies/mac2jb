const path=require('node:path');
function createInputLink(options){const device=options.configuration.hardware?.input,entry=device?.transport.entry;
 if(entry){if(typeof entry!=='string'||path.isAbsolute(entry)||entry.split(/[\\/]/).includes('..'))throw Error('Device adapter must stay in its module');return require(path.join(device.folder,entry)).create(options);}
 return require('./transports/index.cjs').create(options);
}
module.exports={createInputLink,createChecks:options=>require('./checks.cjs').create(options)};

const fs=require('node:fs'),path=require('node:path');
function create(options){
 const id=options.configuration.inputAdapter;
 if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id))throw Error('Invalid input transport');
 const folder=path.join(__dirname,id),file=path.join(folder,'transport.json');
 if(!fs.existsSync(file))throw Error('Install an input transport for '+id);
 const d=JSON.parse(fs.readFileSync(file,'utf8'));
 if(d.format!=='iz2s.input-transport'||d.apiVersion!==1||d.id!==id)throw Error('Invalid input transport descriptor');
 const target=require('../../core/descriptors.cjs').local(folder,d.entry);
 return require(target).create(options);
}
module.exports={create,plan:require('./common.cjs').plan};

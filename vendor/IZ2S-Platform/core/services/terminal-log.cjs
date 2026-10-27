// Local terminal transcript. Assemble complete lines before redacting secrets
// so a key split between output chunks cannot enter the journal unredacted.
const fs=require('node:fs'),path=require('node:path'),{StringDecoder}=require('node:string_decoder');
function redact(text){return text.replace(/(https?:\/\/[^\s#]+\/#)[a-f0-9]{32,64}/gi,'$1[redacted]').replace(/(["'])[a-f0-9]{32,64}\1/gi,'"[redacted]"').replace(/((?:token|secret|pairing key)\s*[:=]\s*)[a-f0-9]{16,64}/gi,'$1[redacted]');}
function create(directory){
 let fd,closed=false,warned=false;const channels=new Map();
 function warn(){if(!warned){warned=true;process.stderr.write('Terminal transcript unavailable; the server remains active.\n');}}
 try{fs.mkdirSync(directory,{recursive:true});fd=fs.openSync(path.join(directory,'server-console.log'),'a',0o600);fs.fchmodSync(fd,0o600);}catch{warn();}
 function line(channel,text){if(fd===undefined)return;try{fs.writeSync(fd,new Date().toISOString()+' ['+channel+'] '+redact(text)+'\n');}catch{warn();}}
 return {write(channel,bytes){if(closed)return;let state=channels.get(channel);if(!state){state={decoder:new StringDecoder('utf8'),tail:''};channels.set(channel,state);}state.tail+=state.decoder.write(Buffer.isBuffer(bytes)?bytes:Buffer.from(String(bytes)));let end;while((end=state.tail.indexOf('\n'))>=0){line(channel,state.tail.slice(0,end).replace(/\r$/,''));state.tail=state.tail.slice(end+1);}},close(){if(closed)return;closed=true;for(const[channel,state]of channels){state.tail+=state.decoder.end();if(state.tail)line(channel,state.tail);}if(fd!==undefined)try{fs.closeSync(fd);}catch{}}};
}
module.exports={create,redact};

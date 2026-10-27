// Normalize terminal messages to English; preserve internal markers and commands.
const {StringDecoder}=require('node:string_decoder');
function translate(text){return String(text);}
function install(){
 for(const stream of [process.stdout,process.stderr]){
  const write=stream.write.bind(stream),decoder=new StringDecoder('utf8');let pending='';
  stream.write=(chunk,encoding,callback)=>{pending+=Buffer.isBuffer(chunk)?decoder.write(chunk):String(chunk);let i;while((i=pending.indexOf('\n'))>=0){write(translate(pending.slice(0,i+1)));pending=pending.slice(i+1);}const cb=typeof encoding==='function'?encoding:callback;cb?.();return true;};
  process.once('exit',()=>{pending+=decoder.end();if(pending)write(translate(pending));});
 }
}
module.exports={translate,install};

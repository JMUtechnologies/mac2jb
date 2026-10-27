// Initialize only caller-owned allocations while their render/receiver is stopped.
const definition=require('../console/abi/memory-functions.json').memset;
const verified=new WeakMap();
async function initialize(rpc,address,bytes,initial=Buffer.alloc(0)){
 if(!Number.isSafeInteger(address)||address<4096||!Number.isInteger(bytes)||bytes<1||bytes>32*1024*1024||!Buffer.isBuffer(initial)||initial.length>bytes)throw Error('Invalid owned buffer');
 if(!rpc.a?.sdk||!rpc.callAddress||!rpc.query){
  const data=Buffer.alloc(bytes);initial.copy(data);await rpc.write(address,data);return;
 }
 let ready=verified.get(rpc);
 if(!ready){ready=rpc.request({command:'verify-function',address:rpc.a.sdk+definition.offset,hex:definition.hex});verified.set(rpc,ready);}
 await ready;
 for(let at=address;at<address+bytes;){
  const r=await rpc.query(at),end=Number(r.address)+Number(r.size);
  if(Number(r.address)>at||end<=at||(r.permissions&3)!==3||r.ipcReferences)throw Error('Owned buffer is not writable');
  at=end;
 }
 const result=(await rpc.callAddress(rpc.a.sdk+definition.offset,[address,0,bytes])).result;
 if(result!==BigInt(address))throw Error('Owned buffer initialization failed');
 if(initial.length)await rpc.write(address,initial);
}
module.exports={initialize};

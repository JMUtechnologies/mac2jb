// An independent qualified native sampler: potentially blocking network IPC
// must never be inserted in the presentation worker or depend on host polling.
const L=require('./layout.cjs'),services=require('../abi/service-functions.json');
const OFFSET=544,BYTES=64,MAGIC=0x495a534e;
const mode=require('../../services/console-state.cjs').OE.operationMode;
const timing=require('../abi/timing-code.json').functions;
function callsFor({base,buffer,mapped,sdk,functions}){
 const target=mapped+L.OFFSET+OFFSET,snapshot=buffer+0x200,status=buffer+0x100,results=base+0x320000,copy=sdk+0x586fb0,calls=[];
 const add=(fn,args=[])=>{const i=calls.length;calls.push({function:fn,args:[...args,...Array(4-args.length).fill(0)]});return i;};
 add(copy,[target,buffer,4]); // Invalidate before publishing a new snapshot.
 const operation=add(functions.operationMode);add(copy,[snapshot+8,results+operation*8,4]);
 const network=add(functions.netStatus,[status]);add(copy,[snapshot+12,results+network*8,4]);
 add(copy,[snapshot+16,status,12]);
 const tick=add(sdk+timing.tick.offset);add(copy,[snapshot+32,results+tick*8,8]);
 add(copy,[target,snapshot,BYTES]); // Snapshot magic remains zero here.
 add(copy,[target,buffer+16,4]); // Commit only after data and timestamp.
 add(sdk+require('../abi/thread-code.json').functions.sleep.offset,[200000000]);
 return calls;
}
async function create({rpc,mapped}){
 if(rpc.a.sdkCrc32!==3925528160)return {supported:false,async close(){}};
 const api=await require('../native/client.cjs').create(rpc,{operationMode:mode,netStatus:services.netStatus},4096);
 await rpc.request({command:'verify-function',address:rpc.a.sdk+timing.tick.offset,hex:timing.tick.bytes.slice(0,512)});
 const worker=await require('../native/repeating.cjs').create(rpc),constants=Buffer.alloc(32),snapshot=Buffer.alloc(BYTES);
 constants.writeUInt32LE(MAGIC,16);snapshot.writeUInt32LE(1,4);
 await api.write(0,constants);await api.write(0x200,snapshot);await rpc.write(mapped+L.OFFSET+OFFSET,Buffer.alloc(BYTES));
 await worker.start(callsFor({base:worker.base,buffer:api.base,mapped,sdk:rpc.a.sdk,functions:api.functions}));
 let closing;
 return {supported:true,intervalMs:200,offset:OFFSET,bytes:BYTES,close(){return closing??=(async()=>{await worker.stop();await rpc.write(mapped+L.OFFSET+OFFSET,Buffer.alloc(4));})();}};
}
module.exports={OFFSET,BYTES,MAGIC,callsFor,create};

'use strict';
const {performance}=require('node:perf_hooks');
const WIDTH=320,HEIGHT=180,BC1_BYTES=28800,HEADER_BYTES=4096,SLOT_BYTES=32768,SLOTS=3;
const MEMORY_BYTES=HEADER_BYTES+SLOT_BYTES*SLOTS,COMMIT_OFFSET=16,ACK_OFFSET=128,RING_OFFSET=256,RING_SIZE=16;
const check=(value,message)=>{if(!value)throw Error(message);};
function initialMemory(){
  const bytes=Buffer.alloc(MEMORY_BYTES);bytes.writeUInt32LE(0x314d5453,0);bytes.writeUInt32LE(1,4);
  bytes.writeUInt32LE(WIDTH,8);bytes.writeUInt32LE(HEIGHT,12);return bytes;
}
function createTransport({rpc,mapped}){
  check(Number.isSafeInteger(mapped)&&mapped>0,'Invalid owned media mapping');
  let queue=Promise.resolve(),sequence=0,pending=0,active=0,inputSequence=0,closed=false,failure;
  const events=[],stats={publishedFrames:0,droppedFrames:0,presentedFrames:0,activeFrameSeq:0,activePtsMs:0,
    inputOverruns:0,uploadLatenciesMs:[],lastUploadMs:0};
  const serial=task=>{
    const result=queue.then(()=>{if(failure)throw failure;return task();}).catch(error=>{failure ||= error;throw error;});
    queue=result.catch(()=>{});return result;
  };
  async function refresh(){
    const bytes=await rpc.read(mapped+ACK_OFFSET,512-ACK_OFFSET);
    check(Buffer.isBuffer(bytes)&&bytes.length===512-ACK_OFFSET,'Media acknowledgement was truncated');
    active=bytes.readUInt32LE(0);
    check(active===0||(active&3)<SLOTS,'Invalid GPU acknowledgement slot');
    if(active===pending)pending=0;
    stats.activeFrameSeq=active>>>2;stats.presentedFrames=bytes.readUInt32LE(4);stats.activePtsMs=bytes.readUInt32LE(16);
    const latest=bytes.readUInt32LE(8);let distance=(latest-inputSequence)>>>0;
    if(distance>RING_SIZE){stats.inputOverruns+=distance-RING_SIZE;inputSequence=(latest-RING_SIZE)>>>0;distance=RING_SIZE;}
    for(let n=0;n<distance;n++){
      const next=(inputSequence+1)>>>0,index=((next-1)>>>0)%RING_SIZE,offset=RING_OFFSET-ACK_OFFSET+index*16;
      if(bytes.readUInt32LE(offset)!==next)break; // A concurrent GPU publication is observed on the next poll.
      events.push({sequence:next,buttons:bytes.readUInt32LE(offset+4),currentButtons:bytes.readUInt32LE(offset+8)});
      inputSequence=next;
    }
  }
  return {
    stats,
    get publishedFrameSeq(){return sequence;},
    publish(bytes,ptsMs){
      check(Buffer.isBuffer(bytes)&&bytes.length===BC1_BYTES,'Expected one 320x180 BC1 frame (28800 bytes)');
      check(Number.isSafeInteger(ptsMs)&&ptsMs>=0&&ptsMs<=0xffffffff,'Frame PTS must fit unsigned milliseconds');
      check(!closed,'Graphics transport is closed');const frame=Buffer.from(bytes);
      return serial(async()=>{
        check(!closed,'Graphics transport is closed');
        if(pending)await refresh();
        if(pending){stats.droppedFrames++;return false;}
        const activeSlot=active===0?-1:active&3;
        let slot=sequence%SLOTS;if(slot===activeSlot)slot=(slot+1)%SLOTS;
        sequence=(sequence+1)&0x3fffffff;if(sequence===0)sequence=1;
        const packet=Buffer.alloc(16+BC1_BYTES);packet.writeUInt32LE(sequence,0);packet.writeUInt32LE(ptsMs,4);frame.copy(packet,16);
        const start=performance.now();
        await rpc.write(mapped+HEADER_BYTES+slot*SLOT_BYTES,packet);
        const commit=(sequence*4+slot)>>>0,word=Buffer.alloc(4);word.writeUInt32LE(commit);
        await rpc.write(mapped+COMMIT_OFFSET,word); // Publish only after the full inactive slot succeeded.
        pending=commit;stats.publishedFrames++;stats.lastUploadMs=performance.now()-start;
        stats.uploadLatenciesMs.push(stats.lastUploadMs);if(stats.uploadLatenciesMs.length>256)stats.uploadLatenciesMs.shift();
        return true;
      });
    },
    poll(){return serial(async()=>{check(!closed,'Graphics transport is closed');await refresh();
      return {...stats,events:events.splice(0)};});},
    close(){closed=true;return queue;}
  };
}
module.exports={WIDTH,HEIGHT,BC1_BYTES,HEADER_BYTES,SLOT_BYTES,SLOTS,MEMORY_BYTES,COMMIT_OFFSET,ACK_OFFSET,RING_OFFSET,RING_SIZE,initialMemory,createTransport};

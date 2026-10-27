'use strict';
const {performance}=require('node:perf_hooks');
const VERSION=4,WIDTH=1280,HEIGHT=720,MENU_WIDTH=1280,MENU_HEIGHT=720;
const FORMATS=Object.freeze([[320,180],[640,360],[960,540],[1280,720],[1920,1080]].map(([width,height])=>Object.freeze({width,height,bytes:width*height/2})));
const BC1_BYTES=WIDTH*HEIGHT/2,MENU_BC1_BYTES=MENU_WIDTH*MENU_HEIGHT/2,HEADER_BYTES=4096,FRAME_HEADER_BYTES=16,SLOT_BYTES=1048576,SLOTS=3,WRITE_BYTES=32768;
const MEMORY_BYTES=HEADER_BYTES+SLOT_BYTES*SLOTS,COMMIT_OFFSET=16,ACK_OFFSET=128,RING_OFFSET=256,RING_SIZE=48,RING_ENTRY_BYTES=32;
const INPUT_BYTES=RING_OFFSET+RING_SIZE*RING_ENTRY_BYTES-ACK_OFFSET,TOUCH_OFFSET=128,RIGHT_STICK_X_OFFSET=192;
const check=(value,message)=>{if(!value)throw Error(message);};
function initialMemory(){
  const bytes=Buffer.alloc(MEMORY_BYTES);bytes.writeUInt32LE(0x314d5453,0);bytes.writeUInt32LE(VERSION,4);
  bytes.writeUInt32LE(WIDTH,8);bytes.writeUInt32LE(HEIGHT,12);return bytes;
}
function createTransport({rpc,mapped,upload}){
  check(Number.isSafeInteger(mapped)&&mapped>0&&Number.isSafeInteger(mapped+MEMORY_BYTES),'Invalid owned media mapping');
  check(upload===undefined||typeof upload==='function','Invalid media upload transport');
  let queue=Promise.resolve(),sequence=0,pending=0,active=0,inputSequence=0,closed=false,failure;
  const events=[],stats={publishedFrames:0,droppedFrames:0,presentedFrames:0,activeFrameSeq:0,activePtsMs:0,
    inputOverruns:0,currentButtons:0,currentButtonsHigh:0,rightStickX:0,touch:{active:false,x:0,y:0,id:0},uploadLatenciesMs:[],lastUploadMs:0};
  const serial=task=>{
    const result=queue.then(()=>{if(failure)throw failure;return task();}).catch(error=>{failure ||= error;throw error;});
    queue=result.catch(()=>{});return result;
  };
  async function refresh(){
    const bytes=await rpc.read(mapped+ACK_OFFSET,INPUT_BYTES);
    check(Buffer.isBuffer(bytes)&&bytes.length===INPUT_BYTES,'Media acknowledgement was truncated');
    active=bytes.readUInt32LE(0);
    check(active===0||(active&3)<SLOTS,'Invalid GPU acknowledgement slot');
    if(active===pending)pending=0;
    stats.activeFrameSeq=active>>>2;stats.presentedFrames=bytes.readUInt32LE(4);stats.activePtsMs=bytes.readUInt32LE(16);
    stats.currentButtons=bytes.readUInt32LE(12);stats.currentButtonsHigh=bytes.readUInt32LE(20);
    stats.rightStickX=Math.max(-1,Math.min(1,bytes.readInt32LE(RIGHT_STICK_X_OFFSET-ACK_OFFSET)/32767));
    // a bulk copy can capture equal old counters around a new payload.
    // re-read the starting counter before accepting its fields.
    if(bytes.readUInt32LE(4)===bytes.readUInt32LE(204-ACK_OFFSET)){
      const after=await rpc.read(mapped+ACK_OFFSET+4,4);
      check(Buffer.isBuffer(after)&&after.length===4,'Media input snapshot counter was truncated');
      if(after.readUInt32LE(0)===bytes.readUInt32LE(4)){
        const down=bytes.readUInt32LE(160-ACK_OFFSET),x=bytes.readUInt32LE(164-ACK_OFFSET),y=bytes.readUInt32LE(168-ACK_OFFSET);
        check(down<=1&&x<MENU_WIDTH&&y<MENU_HEIGHT,'Invalid GPU touchscreen snapshot');
        stats.touch={active:down===1,x,y,id:bytes.readUInt32LE(200-ACK_OFFSET)};
      }
    }
    const latest=bytes.readUInt32LE(8);let distance=(latest-inputSequence)>>>0;
    if(distance>RING_SIZE){stats.inputOverruns+=distance-RING_SIZE;inputSequence=(latest-RING_SIZE)>>>0;distance=RING_SIZE;}
    for(let n=0;n<distance;n++){
      const next=(inputSequence+1)>>>0,index=((next-1)>>>0)%RING_SIZE,offset=RING_OFFSET-ACK_OFFSET+index*RING_ENTRY_BYTES;
      if(bytes.readUInt32LE(offset)!==next)break; // concurrent publications are observed on the next poll.
      const kind=bytes.readUInt32LE(offset+12),event={sequence:next,buttons:bytes.readUInt32LE(offset+4),currentButtons:bytes.readUInt32LE(offset+8)};
      check(kind>=1&&kind<=4,'Invalid GPU input event kind');
      const buttonsHigh=bytes.readUInt32LE(offset+24),currentButtonsHigh=bytes.readUInt32LE(offset+28);
      if(buttonsHigh)event.buttonsHigh=buttonsHigh;
      if(currentButtonsHigh)event.currentButtonsHigh=currentButtonsHigh;
      if(kind>=2){
        const x=bytes.readUInt32LE(offset+16),y=bytes.readUInt32LE(offset+20);
        check(x<MENU_WIDTH&&y<MENU_HEIGHT,'Invalid GPU touchscreen coordinates');
        event.touch={x,y,phase:kind===2?'start':kind===3?'move':'end'};
      }
      events.push(event);
      inputSequence=next;
    }
  }
  return {
    stats,
    get publishedFrameSeq(){return sequence;},
    publish(bytes,ptsMs,format={width:WIDTH,height:HEIGHT}){
      check(format&&typeof format==='object'&&!Array.isArray(format),'Expected a supported BC1 frame format');
      const {width,height}=format;
      const supported=FORMATS.find(row=>row.width===width&&row.height===height);
      check(supported,'Expected a supported BC1 frame format');
      const frameBytes=supported.bytes;
      check(Buffer.isBuffer(bytes)&&bytes.length===frameBytes&&FRAME_HEADER_BYTES+frameBytes<=SLOT_BYTES,
        `Expected one ${width}x${height} BC1 frame (${frameBytes} bytes)`);
      check(Number.isSafeInteger(ptsMs)&&ptsMs>=0&&ptsMs<=0xffffffff,'Frame PTS must fit unsigned milliseconds');
      check(!closed,'Graphics transport is closed');const frame=Buffer.from(bytes);
      return serial(async()=>{
        check(!closed,'Graphics transport is closed');
        if(pending)await refresh();
        if(pending){stats.droppedFrames++;return false;}
        const activeSlot=active===0?-1:active&3;
        let slot=sequence%SLOTS;if(slot===activeSlot)slot=(slot+1)%SLOTS;
        sequence=(sequence+1)&0x3fffffff;if(sequence===0)sequence=1;
        const packet=Buffer.alloc(FRAME_HEADER_BYTES+frameBytes);packet.writeUInt32LE(sequence,0);packet.writeUInt32LE(ptsMs,4);
        packet.writeUInt32LE(width,8);packet.writeUInt32LE(height,12);frame.copy(packet,FRAME_HEADER_BYTES);
        const start=performance.now();
        // a failed chunk latches the transport before publication or replay.
        const address=mapped+HEADER_BYTES+slot*SLOT_BYTES;
        if(upload)await upload({address,packet,sequence});
        else for(let offset=0;offset<packet.length;offset+=WRITE_BYTES)
          await rpc.write(address+offset,packet.subarray(offset,offset+WRITE_BYTES));
        const commit=(sequence*4+slot)>>>0,word=Buffer.alloc(4);word.writeUInt32LE(commit);
        await rpc.write(mapped+COMMIT_OFFSET,word); // publish only after the full inactive slot succeeded.
        pending=commit;stats.publishedFrames++;stats.lastUploadMs=performance.now()-start;
        stats.uploadLatenciesMs.push(stats.lastUploadMs);if(stats.uploadLatenciesMs.length>256)stats.uploadLatenciesMs.shift();
        return true;
      });
    },
    poll(){return serial(async()=>{check(!closed,'Graphics transport is closed');await refresh();
      return {...stats,touch:{...stats.touch},events:events.splice(0)};});},
    close(){closed=true;return queue;}
  };
}
module.exports={VERSION,WIDTH,HEIGHT,MENU_WIDTH,MENU_HEIGHT,FORMATS,BC1_BYTES,MENU_BC1_BYTES,HEADER_BYTES,FRAME_HEADER_BYTES,SLOT_BYTES,SLOTS,WRITE_BYTES,MEMORY_BYTES,COMMIT_OFFSET,ACK_OFFSET,RING_OFFSET,RING_SIZE,RING_ENTRY_BYTES,INPUT_BYTES,TOUCH_OFFSET,RIGHT_STICK_X_OFFSET,initialMemory,createTransport};

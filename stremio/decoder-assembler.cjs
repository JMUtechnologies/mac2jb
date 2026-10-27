'use strict';
// Assemble exactly one owned frame at a time. The decoder pipe remains
// backpressured while its consumer handles a frame or waits at a pause gate.
async function consume(stream,size,callback,{allowPartial=false,beforeFrame,isStopped=()=>false}={}){
 if(!Number.isSafeInteger(size)||size<1)throw Error('Invalid decoder frame size.');
 let frame,used=0,index=0;
 for await(const bytes of stream){
  if(isStopped())return;
  let offset=0;
  while(offset<bytes.length){
   frame ||= Buffer.allocUnsafe(size);
   const count=Math.min(size-used,bytes.length-offset);
   frame.set(bytes.subarray(offset,offset+count),used);used+=count;offset+=count;
   if(used===size){
    if(beforeFrame)await beforeFrame();
    if(isStopped())return;
    await callback?.(frame,index++);
    frame=undefined;used=0;
    if(isStopped())return;
   }
  }
 }
 if(used&&!isStopped()){
  if(!allowPartial||used%4!==0)throw Error('Decoder returned a truncated media frame.');
  const tail=Buffer.alloc(size);frame.copy(tail,0,0,used);
  await callback?.(tail,index++);
 }
}
module.exports={consume};

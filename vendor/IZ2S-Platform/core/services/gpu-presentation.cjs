// Presentation does not need a CPU-readable copy of every 1080p image.
// Opt into the old screenshot readback only for explicit diagnostics.
const struct=(size,type,words={},pointers={})=>{const b=Buffer.alloc(size);b.writeUInt32LE(type);for(const[a,v]of Object.entries(words))b.writeUInt32LE(v,+a);for(const[a,v]of Object.entries(pointers))b.writeBigUInt64LE(BigInt(v),+a);return b;};
async function recordPresentation({capture=false,command,image,previewBuffer,p,put,call,memoryBarrier,barrier}){
 if(capture){
  await barrier(2,6,0x400,0x100,0x1000,0x800);
  await put(0x1400,struct(72,1000337009,{32:1,44:1,60:1920,64:1080,68:1}));
  await put(0x1500,struct(56,1000337003,{24:6,40:1},{16:image,32:previewBuffer,48:p+0x1400}));
  await call('vkCmdCopyImageToBuffer2',command,p+0x1500);
  await memoryBarrier(0x1000,0x1000,0x4000,0x2000);
  await barrier(6,1000001002,0x1000,0x800,0,0);
 }else{
  await barrier(2,1000001002,0x400,0x100,0,0);
 }
}
module.exports={recordPresentation};

'use strict';
// BC1/DXT1 frames are uploaded as bounded native chunks by the media transport.
const rgb565=(r,g,b)=>((r>>3)<<11)|((g>>2)<<5)|(b>>3);
function expand(c){const r=c>>11,g=(c>>5)&63,b=c&31;return [(r<<3)|(r>>2),(g<<2)|(g>>4),(b<<3)|(b>>2)];}
function dimensions(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width>1920||height>1080)throw Error('Invalid BC1 dimensions');return Math.ceil(width/4)*Math.ceil(height/4)*8;}
function encode(rgba,width,height){
 const output=Buffer.alloc(dimensions(width,height));if(!Buffer.isBuffer(rgba)||rgba.length!==width*height*4)throw Error('Invalid RGBA frame');
 // Reuse the block scratch across the frame; scalar palettes preserve the exact
 // endpoint, interpolation and weighted-error choices without per-pixel arrays.
 const pixels=new Uint8Array(48);let offset=0;
 for(let y=0;y<height;y+=4)for(let x=0;x<width;x+=4){
  let minR=255,minG=255,minB=255,maxR=0,maxG=0,maxB=0,pixel=0;
  for(let j=0;j<4;j++){
   const row=Math.min(y+j,height-1)*width*4;
   for(let i=0;i<4;i++){
    const at=row+Math.min(x+i,width-1)*4,r=rgba[at],g=rgba[at+1],b=rgba[at+2];
    pixels[pixel++]=r;pixels[pixel++]=g;pixels[pixel++]=b;
    minR=Math.min(minR,r);minG=Math.min(minG,g);minB=Math.min(minB,b);
    maxR=Math.max(maxR,r);maxG=Math.max(maxG,g);maxB=Math.max(maxB,b);
   }
  }
  let c0=rgb565(maxR,maxG,maxB),c1=rgb565(minR,minG,minB);if(c0<c1){const swap=c0;c0=c1;c1=swap;}
  if(c0===c1){if(c0<65535)c0++;else c1--;}
  const r0b=c0>>11,g0b=(c0>>5)&63,b0b=c0&31,r1b=c1>>11,g1b=(c1>>5)&63,b1b=c1&31;
  const r0=(r0b<<3)|(r0b>>2),g0=(g0b<<2)|(g0b>>4),b0=(b0b<<3)|(b0b>>2);
  const r1=(r1b<<3)|(r1b>>2),g1=(g1b<<2)|(g1b>>4),b1=(b1b<<3)|(b1b>>2);
  const r2=Math.floor((2*r0+r1)/3),g2=Math.floor((2*g0+g1)/3),b2=Math.floor((2*b0+b1)/3);
  const r3=Math.floor((r0+2*r1)/3),g3=Math.floor((g0+2*g1)/3),b3=Math.floor((b0+2*b1)/3);
  let indices=0;
  for(let i=0;i<16;i++){
   const at=i*3,r=pixels[at],g=pixels[at+1],b=pixels[at+2];
   let dr=r0-r,dg=g0-g,db=b0-b,best=0,score=dr*dr*2+dg*dg*4+db*db;
   dr=r1-r;dg=g1-g;db=b1-b;let error=dr*dr*2+dg*dg*4+db*db;
   if(error<score){best=1;score=error;}
   dr=r2-r;dg=g2-g;db=b2-b;error=dr*dr*2+dg*dg*4+db*db;
   if(error<score){best=2;score=error;}
   dr=r3-r;dg=g3-g;db=b3-b;error=dr*dr*2+dg*dg*4+db*db;
   if(error<score)best=3;
   indices|=best<<(i*2);
  }
  output.writeUInt16LE(c0,offset);output.writeUInt16LE(c1,offset+2);output.writeUInt32LE(indices>>>0,offset+4);offset+=8;
 }
 return output;
}
function decode(blocks,width,height){
 if(blocks.length!==dimensions(width,height))throw Error('Invalid BC1 frame');const rgba=Buffer.alloc(width*height*4);let offset=0;
 for(let y=0;y<height;y+=4)for(let x=0;x<width;x+=4){
  const c0=blocks.readUInt16LE(offset),c1=blocks.readUInt16LE(offset+2),a=expand(c0),b=expand(c1),indices=blocks.readUInt32LE(offset+4);
  const colors=c0>c1?[a,b,a.map((n,i)=>Math.floor((2*n+b[i])/3)),a.map((n,i)=>Math.floor((n+2*b[i])/3))]:[a,b,a.map((n,i)=>Math.floor((n+b[i])/2)),[0,0,0]];
  for(let j=0;j<4;j++)for(let i=0;i<4;i++)if(x+i<width&&y+j<height){const at=((y+j)*width+x+i)*4,c=colors[(indices>>>((j*4+i)*2))&3];rgba[at]=c[0];rgba[at+1]=c[1];rgba[at+2]=c[2];rgba[at+3]=255;}offset+=8;
 }
 return rgba;
}
module.exports={encode,decode,dimensions};

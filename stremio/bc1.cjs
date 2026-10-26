'use strict';
// BC1/DXT1 blocks fit a 320x180 video frame in one native 32 KiB write.
const rgb565=(r,g,b)=>((r>>3)<<11)|((g>>2)<<5)|(b>>3);
function expand(c){const r=c>>11,g=(c>>5)&63,b=c&31;return [(r<<3)|(r>>2),(g<<2)|(g>>4),(b<<3)|(b>>2)];}
function dimensions(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width>1920||height>1080)throw Error('Invalid BC1 dimensions');return Math.ceil(width/4)*Math.ceil(height/4)*8;}
function encode(rgba,width,height){
 const output=Buffer.alloc(dimensions(width,height));if(!Buffer.isBuffer(rgba)||rgba.length!==width*height*4)throw Error('Invalid RGBA frame');
 let offset=0;
 for(let y=0;y<height;y+=4)for(let x=0;x<width;x+=4){
  let minR=255,minG=255,minB=255,maxR=0,maxG=0,maxB=0;const pixels=[];
  for(let j=0;j<4;j++)for(let i=0;i<4;i++){
   const at=(Math.min(y+j,height-1)*width+Math.min(x+i,width-1))*4,r=rgba[at],g=rgba[at+1],b=rgba[at+2];pixels.push([r,g,b]);
   minR=Math.min(minR,r);minG=Math.min(minG,g);minB=Math.min(minB,b);maxR=Math.max(maxR,r);maxG=Math.max(maxG,g);maxB=Math.max(maxB,b);
  }
  let c0=rgb565(maxR,maxG,maxB),c1=rgb565(minR,minG,minB);if(c0<c1)[c0,c1]=[c1,c0];
  if(c0===c1){if(c0<65535)c0++;else c1--;}
  const a=expand(c0),b=expand(c1),colors=[a,b,a.map((n,i)=>Math.floor((2*n+b[i])/3)),a.map((n,i)=>Math.floor((n+2*b[i])/3))];
  let indices=0;
  for(let i=0;i<16;i++){let best=0,score=Infinity;for(let k=0;k<4;k++){const d=colors[k].reduce((s,n,j)=>s+(n-pixels[i][j])**2*[2,4,1][j],0);if(d<score){best=k;score=d;}}indices=(indices|(best<<(i*2)))>>>0;}
  output.writeUInt16LE(c0,offset);output.writeUInt16LE(c1,offset+2);output.writeUInt32LE(indices,offset+4);offset+=8;
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

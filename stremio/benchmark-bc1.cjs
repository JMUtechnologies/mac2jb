#!/usr/bin/env node
'use strict';
// Host CPU only: node stremio/benchmark-bc1.cjs [--reference /absolute/legacy.cjs]
// Does not load playback, networking, USB or native-console modules.
const path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const current=require('./bc1.cjs'),args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--reference'&&path.isAbsolute(args[1])))throw Error('Usage: benchmark-bc1.cjs [--reference /absolute/legacy.cjs]');
const reference=args.length?require(args[1]):null;
function image(width,height){
 const pixels=Buffer.alloc(width*height*4);
 for(let i=0;i<pixels.length;i+=4){pixels[i]=(i/4)%256;pixels[i+1]=(i/(width*4))%256;pixels[i+2]=((i/4)*13)%256;pixels[i+3]=255;}
 return pixels;
}
function measure(encoder,pixels,width,height){
 for(let i=0;i<3;i++)encoder.encode(pixels,width,height);
 const samples=[];let output;
 for(let i=0;i<7;i++){const start=performance.now();output=encoder.encode(pixels,width,height);samples.push(performance.now()-start);}
 const sorted=[...samples].sort((a,b)=>a-b);
 return {output,medianMs:+sorted[3].toFixed(2),samplesMs:samples.map(value=>+value.toFixed(2))};
}
const results=[];
for(const [width,height]of [[1280,720],[1920,1080]]){
 const pixels=image(width,height),optimized=measure(current,pixels,width,height),result={width,height,bc1Bytes:optimized.output.length,optimized:{medianMs:optimized.medianMs,samplesMs:optimized.samplesMs}};
 if(reference){const legacy=measure(reference,pixels,width,height);assert.deepEqual(optimized.output,legacy.output);result.reference={medianMs:legacy.medianMs,samplesMs:legacy.samplesMs};result.speedup=+(legacy.medianMs/optimized.medianMs).toFixed(2);result.byteIdentical=true;}
 results.push(result);
}
console.log(JSON.stringify({scope:'host BC1 encoding only; excludes decoding, USB upload and display',platform:process.platform,arch:process.arch,node:process.version,results},null,2));

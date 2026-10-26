'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
const codec=require('./bc1.cjs'),decoder=require('./decoder.cjs');
test('BC1 encodes one complete frame inside a native chunk with measured loss bounds',()=>{
 const image=Buffer.alloc(320*180*4);for(let y=0;y<180;y++)for(let x=0;x<320;x++){const at=(y*320+x)*4;image[at]=x*255/319;image[at+1]=y*255/179;image[at+2]=(x+y)*255/498;image[at+3]=255;}
 const start=performance.now(),blocks=codec.encode(image,320,180);assert.equal(blocks.length,28800);const decoded=codec.decode(blocks,320,180);
 let squared=0;for(let i=0;i<image.length;i++)if(i%4!==3)squared+=(image[i]-decoded[i])**2;
 const psnr=10*Math.log10(255**2/(squared/(320*180*3)));assert.ok(psnr>25,'PSNR '+psnr);
 console.log('BC1 gradient quality '+psnr.toFixed(1)+'dB; encode '+(performance.now()-start).toFixed(1)+'ms');
 assert.throws(()=>codec.encode(Buffer.alloc(3),320,180),/Invalid/);
});
test('independent BC1 reference blocks decode endpoint colors and all four selectors',()=>{
 const b=Buffer.alloc(8);b.writeUInt16LE(0xf800);b.writeUInt16LE(0x001f,2);b.writeUInt32LE(0xe4e4e4e4,4);
 const out=codec.decode(b,4,4);assert.deepEqual([...out.subarray(0,16)],[255,0,0,255,0,0,255,255,170,0,85,255,85,0,170,255]);
});
test('media input rejects command-style values and header injection',()=>{
 assert.throws(()=>decoder.mediaURL('file:///etc/passwd'),/HTTP/);assert.throws(()=>decoder.mediaURL('https://user:pass@example.com/a'),/password/);
 assert.throws(()=>decoder.headerArgs({'X-Test':'ok\r\nBad: yes'}),/header/);
 assert.deepEqual(decoder.headerArgs({Authorization:'Bearer abc'}),['-headers','Authorization: Bearer abc\r\n']);
});
test('real FFmpeg decodes a generated HTTP video into matched frames and PCM without console access',async t=>{
 let tools;try{tools=await decoder.tools();}catch{t.skip('Install Stremio to run the real decoder check.');return;}const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mac2jb-stremio-media-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'test.mp4');await run(tools.ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.23','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','faststart',file]);
 const bytes=await fs.readFile(file),server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'video/mp4','content-length':bytes.length});res.end(bytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 let frames=0,audio=0;const stream=await decoder.create({url:'http://127.0.0.1:'+server.address().port+'/test.mp4'},{onVideo:async frame=>{assert.equal(codec.encode(frame,320,180).length,28800);frames++;},onAudio:async pcm=>{assert.equal(pcm.length,19200);audio++;}});
 await stream.done;assert.ok(frames>=18&&frames<=20,'frames='+frames);assert.ok(audio>=12&&audio<=14,'audio='+audio);assert.equal(stream.info.hasAudio,true);
});

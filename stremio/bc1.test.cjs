'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const codec=require('./bc1.cjs');
// Captured from the original array/reduce encoder before the scalar rewrite.
// Seeded random RGB covers interpolation, weighted-error ties, selector order,
// edge padding and every transport resolution without keeping a second encoder.
const legacyFixtures=[
 [4,4,'20c1ce1ef3c56c603cd7a426c998f14244d0df6df2e65a2f8098519f2b79386c'],
 [5,5,'c5e3474cbecedb68e0e02f6350f192ceb2a56e60b033ea017f06fc7d09c8b6d9'],
 [7,9,'1cd067960a611ead17f0c8072f2f8693f3cc8910368dd544b97d2f0418825f1c'],
 [31,23,'4b34bfd9ce038b6b36219f276ac115d098fbd657ff5d71e6b5157ad1d2ddf6d7'],
 [320,180,'7a93955a13ca3696a16e5c255906ed2e892d717315c0daabeedf0b7a7f2a9395'],
 [640,360,'cceb6b1048034c6e20520b6c7f58589d6fa47cda6cc85b208b835eab33415e69'],
 [960,540,'49a3e3f5226d8d5552f2804e526da046725e1ba0d3ebc26dcb277db201caff6a'],
 [1280,720,'6ccd0d481e65634c80417fa70e91cd66c7fc211ead78b8cb90c3be4da0e75f7e'],
 [1920,1080,'3aa9a0b6255324b4e8275c48f248cc32639b015cf17af19d60098348e6c6807b']
];
for(const [width,height,expected]of legacyFixtures)test(`BC1 ${width}x${height} remains byte-identical to the captured legacy encoder`,()=>{
 let seed=((width*65537+height)^0x171204)>>>0;const rgba=Buffer.alloc(width*height*4);
 for(let i=0;i<rgba.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;rgba[i]=seed&255;}
 const blocks=codec.encode(rgba,width,height);
 assert.equal(blocks.length,Math.ceil(width/4)*Math.ceil(height/4)*8);
 assert.equal(crypto.createHash('sha256').update(blocks).digest('hex'),expected);
});
test('BC1 solid endpoint adjustment and first-minimum selector choices remain exact',()=>{
 const fixtures=[[[0,0,0],'0100000055555555'],[[255,255,255],'fffffeff00000000'],
  [[255,0,0],'01f800f855555555'],[[0,255,0],'e107e00755555555'],[[0,0,255],'20001f0055555555']];
 for(const [color,expected]of fixtures){
  const pixels=Buffer.alloc(64);for(let i=0;i<64;i+=4)pixels.set([...color,255],i);
  assert.equal(codec.encode(pixels,4,4).toString('hex'),expected);
  for(let i=3;i<64;i+=4)pixels[i]=(i*17)&255;
  assert.equal(codec.encode(pixels,4,4).toString('hex'),expected,'RGBA alpha remains irrelevant to opaque BC1');
 }
});

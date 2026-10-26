'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {create}=require('./builtin.cjs'),{AddonCollection}=require('./addons.cjs'),decoder=require('./decoder.cjs');
test('bundled Stremio sample serves metadata, ranges and real media',async t=>{
 const provider=await create({root:path.resolve(__dirname,'..')});t.after(()=>provider.close());
 const addons=new AddonCollection({addonUrls:[provider.manifestURL]});await addons.init();const catalog=addons.catalogs()[0],items=await catalog.client.catalog(catalog);assert.equal(items.length,1);
 const meta=await addons.meta('movie',items[0].id,catalog.client);assert.match(meta.description,/Blender Foundation/);
 const sources=await addons.streams('movie',meta.id);assert.equal(sources.length,1);assert.equal(sources[0].playable,true);
 const partial=await fetch(sources[0].url,{headers:{Range:'bytes=0-63'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,64);
 const missing=await fetch(new URL('/missing',provider.manifestURL));assert.equal(missing.status,404);
 const info=await decoder.probe(sources[0]);assert.equal(info.hasAudio,true);assert.ok(info.duration>=29.9&&info.duration<31);
});

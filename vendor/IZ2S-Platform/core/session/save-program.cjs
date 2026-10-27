// SmileBASIC save container. Public format/footer reference:
// https://github.com/plutooo/smilehax/blob/master/scripts/make_script.py
// Header and text encoding are checked against this console's original NS2.
const crypto=require('node:crypto'),zlib=require('node:zlib');
const PUBLIC_FORMAT_KEY=`nqmby+e9S?{%U*-V]51n%^xZMk8>b{?x]&?(NmmV[,g85:%6Sqd"'U")/8u77UL2`;
const footer=bytes=>crypto.createHmac('sha1',PUBLIC_FORMAT_KEY).update(bytes).digest();
function decode(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<132||bytes.length>1048576)throw Error('Invalid SmileBASIC program size');
 if(bytes.readUInt16LE(0)!==4||bytes.readUInt16LE(2)!==0||bytes.readUInt16LE(4)!==1)throw Error('Expected a compressed SmileBASIC 4 TXT program');
 if(bytes.readUInt32LE(8)!==bytes.length-132)throw Error('SmileBASIC payload size differs');
 if(!crypto.timingSafeEqual(footer(bytes.subarray(0,-20)),bytes.subarray(-20)))throw Error('SmileBASIC program footer differs');
 return {header:Buffer.from(bytes.subarray(0,112)),source:zlib.inflateSync(bytes.subarray(112,-20),{maxOutputLength:1048576})};
}
function encode(template,source){
 const {header}=decode(template);if(!Buffer.isBuffer(source)||!source.length||source.length>1048576||source.some(b=>b>127||b===0))throw Error('Expected bounded ASCII BASIC source');
 const compressed=zlib.deflateSync(source,{level:9});header.writeUInt32LE(compressed.length,8);const bytes=Buffer.concat([header,compressed]);return Buffer.concat([bytes,footer(bytes)]);
}
module.exports={decode,encode};

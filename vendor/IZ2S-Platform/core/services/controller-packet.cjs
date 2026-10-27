function decode(packet){
 if(![340,396].includes(packet.length))throw Error('Invalid input packet');let buttons=0,lx=0,ly=0,rx=0,ry=0;
 for(let i=0;i<5;i++){const p=8+i*64;if(!(packet.readUInt32LE(p+32)&1))continue;buttons|=packet.readUInt32LE(p+8);const a=[16,20,24,28].map(o=>packet.readInt32LE(p+o));if(Math.abs(a[0])>Math.abs(lx))lx=a[0];if(Math.abs(a[1])>Math.abs(ly))ly=a[1];if(Math.abs(a[2])>Math.abs(rx))rx=a[2];if(Math.abs(a[3])>Math.abs(ry))ry=a[3];}
 const mode=packet.readUInt32LE(328),flags=packet.readUInt32LE(332),menu=packet.readUInt32LE(336);let keys=0;const set=(i,yes)=>{if(yes)keys|=1<<i;},b=n=>(buttons&(1<<n))!==0;
 if(mode===2&&menu===0&&(flags&2)){
  set(0,ly>10000);set(1,ly< -10000);set(2,lx< -10000);set(3,lx>10000);set(4,rx< -10000||b(12));set(5,rx>10000||b(14));set(6,ly>10000||b(13));set(7,ly< -10000||b(15));set(8,b(7)||b(9));set(9,b(0));set(10,b(6)||b(8));set(11,b(2));set(12,b(1));set(13,b(3));
 }
 return {buttons:buttons>>>0,axes:[lx,ly,rx,ry],mode,menu,flags,keys};
}

module.exports={decode,BYTES:396};

const path=require('node:path'),net=require('node:net'),{extendNative}=require('../extend-native.cjs');
function create({host,port=39395}={}){
 if(!net.isIPv4(host||'')||!Number.isInteger(port)||port<1024||port>65535)throw Error('Expected reachable IPv4 address and port');
 const upstream=path.join(__dirname,'upstream/engine/lib'),connection=require(path.join(upstream,'connection.cjs')),{NativeClient}=require(path.join(upstream,'native.cjs')),{qualify}=require(path.join(upstream,'qualify.cjs'));
 const token=connection.pairingCode(),command=`V=START(${[port,...host.split('.'),...token].join(',')})`;
 return {id:'pepsipu',command,protocol:1,resumable:false,bootstrap:{file:path.join(__dirname,'upstream/bootstrap.bas'),saveName:'NS2P',arity:9,loaderId:'pepsipu',recovery:false},listen:options=>connection.listen({...options,host,port,token}),native:connected=>extendNative(new NativeClient(connected.connection,connected.addresses)),qualify};
}
module.exports={create};

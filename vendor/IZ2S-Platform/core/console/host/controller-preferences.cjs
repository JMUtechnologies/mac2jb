// Session-local resolution: no package rescans in the controller polling loop.
// A shell without the optional module uses SDK defaults.
const ROOT=require('../../root.cjs'),path=require('node:path'),stores=new Map();
const defaults=()=>({get:()=>({source:'auto',controllerId:null,profile:'pro-controller'}),hubActive:()=>false});
async function open(root=ROOT){
 root=path.resolve(root);if(stores.has(root))return stores.get(root);
 const pending=(async()=>{const provider=await require('../../components.cjs').create(root).provider('controller-preferences',{optional:true});return provider?provider.open(root):defaults();})();
 stores.set(root,pending);try{return await pending;}catch(error){stores.delete(root);throw error;}
}
module.exports={open};

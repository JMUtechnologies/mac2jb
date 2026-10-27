// Activate only the owned game, once per activation request, on real player input.
function create({target,onResult=()=>{},now=Date.now,retryMs=2000}){
 let armed=null,pending=null,lastAttempt=-Infinity,closed=false;
 function arm(){armed=target();lastAttempt=-Infinity;}
 async function focus(){
  if(closed)throw Error('Controller focus is closed');
  const own=target();if(!own?.focus)throw Error('The game window is not ready');
  if(pending)return pending;
  lastAttempt=now();pending=Promise.resolve().then(()=>own.focus()).then(result=>{
   if(result?.focused!==true)throw Error(result?.error||'The game window could not be activated');
   if(target()===own){if(armed===own)armed=null;onResult({focused:true,title:result.title});}return result;
  }).catch(error=>{if(target()===own)onResult({focused:false,error:error.message});throw error;}).finally(()=>pending=null);
  return pending;
 }
 function input(state){
  if(closed||!armed||armed!==target()||pending||now()-lastAttempt<retryMs||!state?.enabled||state.inputBlocked)return;
  if(!state.buttons&&!state.axes?.some(value=>Math.abs(value)>8192))return;
  focus().catch(()=>{});
 }
 return {arm,input,focus,close(){closed=true;armed=null;}};
}
module.exports={create};

const MENU_CHORD=2048,DOUBLE_PRESS_MS=250;
const GPU_GESTURE=0x80000000,GPU_MINUS_HELD=0x20000000;
// Current shaders classify Minus against console monotonic time. The host-only
// fallback is for older input producers; it never delays other buttons or axes.
function createGate({now=()=>performance.now(),doublePressMs=DOUBLE_PRESS_MS}={}){
 if(!Number.isFinite(doublePressMs)||doublePressMs<=0)throw Error('Invalid double-press window');
 let previousMenu=0,suppressed=0,ready=false,previousMinus=false,pending=null,held=false,doubleHeld=false,lastTime=0,gpuSeen=false,lastSingle=null;
 return state=>{
  const time=Number(now());lastTime=Number.isFinite(time)?Math.max(lastTime,time):lastTime;
  const rawMinus=(state.buttons&MENU_CHORD)!==0,rising=rawMinus&&!previousMinus;previousMinus=rawMinus;
  const marker=((state.flags??0)&GPU_GESTURE)!==0;if(marker)gpuSeen=true;
  let minus=false,menuGesture=false;
  if(gpuSeen){
   pending=null;held=false;doubleHeld=false;
   if(marker){const sequence=(state.flags>>>16)&255;minus=(lastSingle!==null&&sequence!==lastSingle)||!!(state.flags&GPU_MINUS_HELD);lastSingle=sequence;}
   // Missing marker after an options write is not permission to forward raw
   // Minus. The next GPU render restores its authoritative classification.
  }else{
   if(pending&&lastTime-pending.at>=doublePressMs){minus=true;held=rawMinus&&!pending.released;pending=null;}
   if(rising){if(pending?.released){pending=null;held=false;doubleHeld=true;menuGesture=true;}else if(!held&&!doubleHeld)pending={at:lastTime,released:false};}
   if(!rawMinus){if(pending)pending.released=true;held=false;doubleHeld=false;}
   minus=minus||held;
  }
  if(state.buttons===0)ready=true;
  if(previousMenu!==0&&state.menu===0)suppressed|=state.buttons&~MENU_CHORD;
  suppressed&=state.buttons;previousMenu=state.menu;
  const inputBlocked=!ready||suppressed!==0||state.mode!==2||state.menu!==0;
  if(inputBlocked){pending=null;held=false;doubleHeld=false;return {...state,buttons:0,axes:[0,0,0,0],keys:0,inputBlocked:true,menuGesture};}
  return {...state,buttons:((state.buttons&~MENU_CHORD)|(minus?MENU_CHORD:0))>>>0,inputBlocked:false,menuGesture};
 };
}
module.exports={MENU_CHORD,DOUBLE_PRESS_MS,createGate};

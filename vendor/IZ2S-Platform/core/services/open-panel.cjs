// Open only the loopback panel after its listener is ready; never start capture.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
function openPanel(url,{env=process.env,launch=spawn,exists=fs.existsSync,main=false}={}){
 const u=new URL(url);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/'||!/^#[a-f0-9]{48}$/.test(u.hash))throw Error('Invalid local panel URL');
 if(env.HB_OPEN_PANEL==='0')return false;
 const chrome=[env.HB_CHROME,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&exists(p));
 if(!chrome){
  if(!main){console.error('Chrome was not found. Open the capture link manually.');return false;}
  const child=launch('xdg-open',[u.href],{env,detached:true,stdio:'ignore'});
  child.once('error',error=>console.error('Could not open the panel: '+error.message));child.unref();return true;
 }
 const child=launch(chrome,['--user-data-dir='+(env.HB_BROWSER_PROFILE||path.resolve(__dirname,'../../data/state/browser-profile')),main?'--new-window':'--new-tab',u.href],{env,detached:true,stdio:'ignore'});
 child.once('error',error=>console.error('Could not open PC Screen: '+error.message));child.unref();return true;
}
module.exports={openPanel};

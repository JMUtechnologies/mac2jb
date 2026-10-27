// Count GPU-rendered frames over the observation window. A host poll can skip
// many native six-frame cycles, so it must never count each poll as one cycle.
function create({windowMs=1000,maxGapMs=3000}={}){
 let samples=[];
 return {reset(){samples=[];},sample(counter,now){
  if(!Number.isInteger(counter)||counter<0||counter>0xffffffff||!Number.isFinite(now))return null;
  const previous=samples.at(-1);
  if(previous){const elapsed=now-previous.at,frames=(counter-previous.counter)>>>0;if(elapsed<=0||elapsed>maxGapMs||frames>240*elapsed/1000+2)samples=[];}
  samples.push({counter,at:now});while(samples.length>2&&samples[1].at<=now-windowMs)samples.shift();
  if(samples.length<2)return null;const start=samples[0],interval=(now-start.at)/1000,frames=(counter-start.counter)>>>0;
  return {frames,interval,fps:frames/interval,metric:'GPU frame counter / host observation time'};
 }};
}
module.exports={create};

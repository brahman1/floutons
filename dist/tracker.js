const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const center=r=>[r.x+r.w/2,r.y+r.h/2];
export function manualAt(mask,time){
 const keys=mask.keys;if(!keys.length||time<keys[0].time-.02)return null;
 let a=keys[0],b=null;for(const key of keys){if(key.time<=time)a=key;else{b=key;break;}}
 if(!b)return a;const f=clamp((time-a.time)/(b.time-a.time),0,1);
 return{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,w:a.w+(b.w-a.w)*f,h:a.h+(b.h-a.h)*f};
}
export function putKey(mask,rect,time){const existing=mask.keys.findIndex(k=>Math.abs(k.time-time)<.05);const key={...rect,time};if(existing>=0)mask.keys[existing]=key;else mask.keys.push(key);mask.keys.sort((a,b)=>a.time-b.time);}
export class FaceTracker{
 constructor(){this.reset();}
 reset(){this.tracks=[];this.previous=null;this.time=-1;this.next=0;}
 update(detections,gray,width,height,time){
  const dt=time-this.time;
  if(dt<0||dt>.6||this.previous?.length!==gray.length){this.reset();}
  if(this.previous&&dt>0){let change=0,n=0;for(let i=0;i<gray.length;i+=37){change+=Math.abs(gray[i]-this.previous[i]);n++;}if(change/n>42)this.reset();}
  const step=Math.max(.001,time-this.time),used=new Set(),matched=new Set();
  // Match detections to existing trajectories, using predicted position and size.
  for(const box of detections){let best=null,bestCost=1.4;for(const track of this.tracks){if(used.has(track.id))continue;const a=center(track.box),b=center(box),size=Math.max(track.box.w,box.w,track.box.h,box.h);const dx=(b[0]-a[0]-track.vx*step)/size,dy=(b[1]-a[1]-track.vy*step)/size;const cost=Math.hypot(dx,dy)+Math.abs(Math.log(box.w/track.box.w))*.3;if(cost<bestCost){bestCost=cost;best=track;}}
   if(best){const a=center(best.box),b=center(box);best.vx=clamp((b[0]-a[0])/step,-2,2);best.vy=clamp((b[1]-a[1])/step,-2,2);best.box=box;best.lastSeen=time;used.add(best.id);matched.add(best.id);}
   else{const track={id:++this.next,box,vx:0,vy:0,lastSeen:time};this.tracks.push(track);used.add(track.id);matched.add(track.id);}
  }
  this.tracks=this.tracks.filter(t=>time-t.lastSeen<=.8);
  for(const track of this.tracks){if(matched.has(track.id))continue;const r=track.box;
   const shift=this.previous?this.matchPatch(this.previous,gray,width,height,r,track.vx*step,track.vy*step):null;
   const dx=shift?shift.x:track.vx*step,dy=shift?shift.y:track.vy*step;
   track.box={...r,x:clamp(r.x+dx,0,1-r.w),y:clamp(r.y+dy,0,1-r.h)};
  }
  this.previous=gray;this.time=time;
  return this.tracks.map(t=>({...t.box,held:!matched.has(t.id),gap:time-t.lastSeen,id:t.id}));
 }
 matchPatch(before,after,width,height,rect,pdx,pdy){
  const x=Math.round(rect.x*width),y=Math.round(rect.y*height),w=Math.max(4,Math.round(rect.w*width)),h=Math.max(4,Math.round(rect.h*height));
  if(x<0||y<0||x+w>=width||y+h>=height)return null;
  const samples=[];let mean=0;for(let j=1;j<h-1;j+=Math.max(1,Math.floor(h/10)))for(let i=1;i<w-1;i+=Math.max(1,Math.floor(w/10))){const v=before[(y+j)*width+x+i];samples.push([i,j,v]);mean+=v;}mean/=samples.length;
  let variance=0;for(const s of samples)variance+=Math.abs(s[2]-mean);if(variance/samples.length<5)return null;
  const px=Math.round(pdx*width),py=Math.round(pdy*height),radius=Math.min(20,Math.max(6,Math.round(w*.6)));let best=Infinity,shift=null;
  for(let dy=py-radius;dy<=py+radius;dy+=2)for(let dx=px-radius;dx<=px+radius;dx+=2){if(x+dx<0||y+dy<0||x+dx+w>=width||y+dy+h>=height)continue;let error=0;for(const [i,j,v] of samples)error+=Math.abs(v-after[(y+j+dy)*width+x+i+dx]);error/=samples.length;error+=Math.hypot(dx-px,dy-py)*.03;if(error<best){best=error;shift={x:dx/width,y:dy/height};}}
  return best<30?shift:null;
 }
}

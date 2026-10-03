export class CenterFaceDetector{
 constructor(){this.worker=new Worker('./detector-worker.js');this.pending=new Map();this.next=0;this.threshold=.3;this.input=document.createElement('canvas');this.ctx=this.input.getContext('2d',{willReadFrequently:true});this.worker.onmessage=({data})=>{const item=this.pending.get(data.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(data.id);data.error?item.reject(new Error(data.error)):item.resolve(data);};this.worker.onerror=()=>{for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('Le détecteur a été interrompu'));}this.pending.clear();};}
 call(data,transfer=[]){return new Promise((resolve,reject)=>{const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Délai de détection dépassé'));},60000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({...data,id},transfer);});}
 async init(){await this.call({type:'init'});return this;}
 async setOptions({minDetectionConfidence}){this.threshold=minDetectionConfidence;}
 async detect(frame){
  const factor=Math.min(1,960/Math.max(frame.width,frame.height));
  const width=Math.ceil(frame.width*factor/32)*32,height=Math.ceil(frame.height*factor/32)*32;
  this.input.width=width;this.input.height=height;this.ctx.drawImage(frame,0,0,width,height);
  const pixels=this.ctx.getImageData(0,0,width,height).data.buffer;
  const result=await this.call({type:'detect',width,height,pixels,threshold:this.threshold},[pixels]);
  return{detections:result.boxes.map(b=>({boundingBox:{originX:b.x*frame.width/width,originY:b.y*frame.height/height,width:b.w*frame.width/width,height:b.h*frame.height/height},score:b.score}))};
 }
 close(){this.worker.terminate();for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('Détecteur fermé'));}this.pending.clear();}
}

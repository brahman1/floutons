importScripts('./assets/ort.wasm.min.js');
ort.env.wasm.wasmPaths=new URL('./assets/',self.location.href).href;
ort.env.wasm.numThreads=1;
ort.env.logLevel='error';
let session;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){session=await ort.InferenceSession.create('./assets/centerface.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'});postMessage({id:data.id,ready:true});return;}
  const {width,height,pixels,threshold}=data,size=width*height,rgb=new Uint8ClampedArray(pixels),input=new Float32Array(size*3);
  for(let i=0;i<size;i++){input[i]=rgb[i*4];input[size+i]=rgb[i*4+1];input[size*2+i]=rgb[i*4+2];}
  const outputs=await session.run({'input.1':new ort.Tensor('float32',input,[1,3,height,width])});
  const heat=outputs['537'],scale=outputs['538'].data,offset=outputs['539'].data,rows=heat.dims[2],cols=heat.dims[3],count=rows*cols,boxes=[];
  for(let i=0;i<count;i++){
   const score=heat.data[i];if(score<threshold)continue;
   const h=Math.exp(scale[i])*4,w=Math.exp(scale[count+i])*4;
   const x=Math.max(0,Math.min(width,(i%cols+offset[count+i]+.5)*4-w/2));
   const y=Math.max(0,Math.min(height,(Math.floor(i/cols)+offset[i]+.5)*4-h/2));
   boxes.push({x,y,w:Math.min(w,width-x),h:Math.min(h,height-y),score});
  }
  boxes.sort((a,b)=>b.score-a.score);const kept=[];
  for(const box of boxes){if(box.w<2||box.h<2)continue;if(kept.some(b=>{const area=Math.max(0,Math.min(box.x+box.w,b.x+b.w)-Math.max(box.x,b.x))*Math.max(0,Math.min(box.y+box.h,b.y+b.h)-Math.max(box.y,b.y));return area/(box.w*box.h+b.w*b.h-area)>.3;}))continue;kept.push(box);}
  Object.values(outputs).forEach(t=>t.dispose());postMessage({id:data.id,boxes:kept});
 }catch(e){postMessage({id:data.id,error:e.message||'Erreur de détection'});}
};

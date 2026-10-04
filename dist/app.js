import { CenterFaceDetector } from './detector.js';
import { FaceTracker, manualAt, putKey } from './tracker.js';
import {Input, Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, Conversion, ALL_FORMATS, BlobSource} from './assets/mediabunny.mjs';
const $=id=>document.getElementById(id);
const video=$('source'),canvas=$('canvas'),ctx=canvas.getContext('2d'),scratch=document.createElement('canvas'),sc=scratch.getContext('2d');
let detector,modelPromise,fileURL,outputURL,fileName='video',masks=[],drawing=false,start=null,draft=null,busy=false,conversion=null,sourceFile=null,aborted=false,lastTime=-1,loopToken=0;
let exportInput=null,exportBlob=null;
const mobileDevice=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const supportsCanvasBlur='filter' in ctx;
let previewReleased=false,previewResumeTime=0;
if(mobileDevice)$('resolution').value='1920';
let completionAudio=null;
function prepareCompletionSound(){
 try{
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return;
  if(!completionAudio||completionAudio.state==='closed')completionAudio=new Audio();
  // Unlock playback during the export button gesture, before processing starts.
  completionAudio.resume().catch(()=>{});
 }catch{}
}
function playCompletionSound(){
 try{
  if(!completionAudio||completionAudio.state!=='running')return;
  const now=completionAudio.currentTime;
  [660,880].forEach((frequency,index)=>{
   const tone=completionAudio.createOscillator(),volume=completionAudio.createGain(),start=now+index*.18;
   tone.type='sine';tone.frequency.value=frequency;
   volume.gain.setValueAtTime(0,start);volume.gain.linearRampToValueAtTime(.08,start+.015);volume.gain.exponentialRampToValueAtTime(.001,start+.22);
   tone.connect(volume);volume.connect(completionAudio.destination);tone.start(start);tone.stop(start+.24);
   tone.onended=()=>{tone.disconnect();volume.disconnect();};
  });
 }catch{}
}
const frame=document.createElement('canvas'),frameContext=frame.getContext('2d');
let renderTask=null,renderAgain=false;
const tracker=new FaceTracker(),grayCanvas=document.createElement('canvas'),grayContext=grayCanvas.getContext('2d',{willReadFrequently:true});
let maskHistory=[];
function syncMaskList(){const selected=$('mask-select').value;$('mask-select').replaceChildren(new Option('Nouvelle zone',''));masks.forEach((m,i)=>$('mask-select').add(new Option(`Zone ${i+1} · ${m.keys.length} position${m.keys.length>1?'s':''}`,String(i))));$('mask-select').value=selected;}

const message=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
const clock=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const chosenMode=()=>document.querySelector('[name=mode]:checked').value;
function invalidate(){exportBlob=null;if(outputURL){URL.revokeObjectURL(outputURL);outputURL=null;}$('output').removeAttribute('src');$('result').hidden=true;$('reviewed').checked=false;$('download').removeAttribute('href');$('open-output').removeAttribute('href');}
async function loadModel(){
 if(detector)return detector;
 if(!modelPromise)modelPromise=(async()=>{message('Préparation du détecteur sur votre appareil…');const engine=new CenterFaceDetector();try{await engine.init();await engine.setOptions({minDetectionConfidence:Number($('sensitivity').value)/100});detector=engine;return detector;}catch(e){engine.close();throw e;}})().catch(e=>{modelPromise=null;throw e;});
 return modelPromise;
}
function controls(){for(const id of ['play','seek','sensitivity','addmask','replace','export'])$(id).disabled=busy||!detector||!fileURL;for(const id of ['resolution','keep-audio','mask-select'])$(id).disabled=busy;document.querySelectorAll('[name=mode]').forEach(e=>e.disabled=busy);$('file').disabled=busy;$('undo').disabled=busy||!maskHistory.length;$('cancel').hidden=!busy;}
function resizeCanvas(){
 const limit=Number($('resolution').value),longEdge=Math.max(video.videoWidth,video.videoHeight);
 const scale=limit?Math.min(1,limit/longEdge):1;
 canvas.width=Math.max(2,Math.round(video.videoWidth*scale/2)*2);canvas.height=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
 $('resolution-info').textContent=`${canvas.width} × ${canvas.height} pixels · aucun agrandissement de la source`;
}
async function cleanupExport(){
 exportInput?.dispose();exportInput=null;conversion=null;video.pause();
 if(previewReleased&&fileURL){
  previewReleased=false;
  try{const ready=once(video,'loadedmetadata');video.src=fileURL;video.load();await ready;video.currentTime=Math.min(previewResumeTime,video.duration);}catch{}
 }
 busy=false;controls();$('progress').hidden=true;
}
function region(r,mode){
 const x=Math.max(0,Math.floor(r.x)),y=Math.max(0,Math.floor(r.y)),w=Math.min(canvas.width-x,Math.ceil(r.w)),h=Math.min(canvas.height-y,Math.ceil(r.h));if(w<=0||h<=0)return;
 // Safari versions without canvas filters must never export an unmasked face.
 if(mode==='solid'||!supportsCanvasBlur){ctx.fillStyle='#101915';ctx.fillRect(x,y,w,h);return;}
 // Replicate the patch edges before blurring so original facial edges cannot bleed in.
 scratch.width=w+80;scratch.height=h+80;const rx=frame.width/canvas.width,ry=frame.height/canvas.height;sc.drawImage(frame,x*rx,y*ry,w*rx,h*ry,40,40,w,h);sc.drawImage(scratch,40,40,1,h,0,40,40,h);sc.drawImage(scratch,w+39,40,1,h,w+40,40,40,h);sc.drawImage(scratch,0,40,w+80,1,0,0,w+80,40);sc.drawImage(scratch,0,h+39,w+80,1,0,h+40,w+80,40);
 ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.filter=`blur(${Math.max(12,w*.18)}px)`;ctx.drawImage(scratch,x-40,y-40);ctx.restore();
}
function render(){
 renderAgain=true;
 if(!renderTask)renderTask=(async()=>{while(renderAgain){renderAgain=false;await renderFrame();}})().finally(()=>{renderTask=null;});
 return renderTask;
}
async function renderFrame(){
 if(busy||!detector||video.readyState<2)return;
 // Detect BEFORE drawing: if detection fails, no raw frame reaches the recording canvas.
 const snapshotTime=video.currentTime,snapshotURL=fileURL;
 frame.width=video.videoWidth;frame.height=video.videoHeight;frameContext.drawImage(video,0,0);
 const result=await detector.detect(frame);
 if(busy||snapshotURL!==fileURL)return;
 if(video.paused&&Math.abs(video.currentTime-snapshotTime)>.1){renderAgain=true;return;}
 paintFrame(result,snapshotTime);
}
function paintFrame(result,snapshotTime){
 ctx.drawImage(frame,0,0,canvas.width,canvas.height);const sx=canvas.width/frame.width,sy=canvas.height/frame.height,mode=chosenMode();
 grayCanvas.width=320;grayCanvas.height=Math.max(1,Math.round(frame.height/frame.width*320));grayContext.drawImage(frame,0,0,grayCanvas.width,grayCanvas.height);
 const rgba=grayContext.getImageData(0,0,grayCanvas.width,grayCanvas.height).data,gray=new Uint8Array(rgba.length/4);for(let i=0;i<gray.length;i++)gray[i]=(rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114)|0;
 const boxes=result.detections.map(d=>({x:d.boundingBox.originX/frame.width,y:d.boundingBox.originY/frame.height,w:d.boundingBox.width/frame.width,h:d.boundingBox.height/frame.height}));
 const tracked=tracker.update(boxes,gray,grayCanvas.width,grayCanvas.height,snapshotTime),held=tracked.filter(t=>t.held).length;
 for(const b of tracked){const margin=.25+(b.held?b.gap*.35:0);region({x:(b.x-b.w*margin)*canvas.width,y:(b.y-b.h*(margin+.05))*canvas.height,w:b.w*(1+2*margin)*canvas.width,h:b.h*(1.1+2*margin)*canvas.height},mode);}
 for(const m of masks){const r=manualAt(m,snapshotTime);if(r)region({x:r.x*canvas.width,y:r.y*canvas.height,w:r.w*canvas.width,h:r.h*canvas.height},mode);}
 // Small proportional signature, visible in both the preview and every exported frame.
 ctx.save();
 const watermarkSize=Math.min(canvas.width*.032,Math.min(canvas.width,canvas.height)*.024),watermarkMargin=Math.min(canvas.width,canvas.height)*.018;
 ctx.font=`500 ${watermarkSize}px Arial, sans-serif`;ctx.textAlign='right';ctx.textBaseline='top';
 ctx.globalAlpha=.7;ctx.lineWidth=watermarkSize*.15;ctx.lineJoin='round';ctx.strokeStyle='rgba(0,0,0,.65)';ctx.fillStyle='#fff';
 ctx.strokeText('floutons.com',canvas.width-watermarkMargin,watermarkMargin);
 ctx.fillText('floutons.com',canvas.width-watermarkMargin,watermarkMargin);ctx.restore();
 if(draft){ctx.save();ctx.strokeStyle='#d7f67c';ctx.lineWidth=3;ctx.strokeRect(draft.x*canvas.width,draft.y*canvas.height,draft.w*canvas.width,draft.h*canvas.height);ctx.restore();}
 $('facecount').textContent=`${result.detections.length} visage${result.detections.length>1?'s':''} détecté${result.detections.length>1?'s':''} · ${masks.length} zone${masks.length>1?'s':''} manuelle${masks.length>1?'s':''} · ${held} masque${held>1?'s':''} maintenu${held>1?'s':''}`;
 $('seek').value=snapshotTime;$('time').textContent=`${clock(snapshotTime)} / ${clock(video.duration)}`;
}
async function safeRender(){try{await render();return true;}catch(e){video.pause();message('La détection a échoué. Aucun export valide n’a été conservé. Rechargez la vidéo pour réessayer.',true);if(busy){aborted=true;conversion?.cancel().catch(()=>{});}return false;}}
async function playbackLoop(token){if(token!==loopToken||video.paused||video.ended)return;if(video.currentTime!==lastTime){lastTime=video.currentTime;if(!await safeRender())return;}if(token!==loopToken||video.paused||video.ended)return;if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(()=>playbackLoop(token));else requestAnimationFrame(()=>playbackLoop(token));}
video.addEventListener('play',()=>{lastTime=-1;$('play').textContent='Pause';playbackLoop(++loopToken);});
video.addEventListener('pause',()=>{$('play').textContent='Lire';loopToken++;});
video.addEventListener('seeked',()=>{lastTime=-1;safeRender();});
video.addEventListener('ended',()=>safeRender());
function once(target,event,timeout=15000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(new Error('Délai dépassé')),timeout);const ok=()=>finish();const fail=()=>finish(new Error('Format vidéo non pris en charge'));function finish(error){clearTimeout(timer);target.removeEventListener(event,ok);target.removeEventListener('error',fail);error?reject(error):resolve();}target.addEventListener(event,ok,{once:true});target.addEventListener('error',fail,{once:true});});}
async function openFile(file){
 if(!file||busy)return;if(file.size>200*1024*1024){message('Cette version accepte des fichiers de 200 Mo maximum.',true);return;}
 video.pause();invalidate();drawing=false;canvas.classList.remove('drawing');$('addmask').textContent='Ajouter une zone à masquer';masks=[];maskHistory=[];syncMaskList();tracker.reset();
 if(fileURL)URL.revokeObjectURL(fileURL);fileURL=URL.createObjectURL(file);sourceFile=file;fileName=file.name.replace(/\.[^.]+$/,'');$('filename').textContent=file.name;$('stage').hidden=true;$('dropzone').hidden=false;message('Ouverture de la vidéo…');$('export').disabled=true;
 try{const metadata=once(video,'loadedmetadata');video.src=fileURL;video.load();await metadata;if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>180)throw new Error('Choisissez une vidéo de 3 minutes maximum.');if(video.readyState<2)await once(video,'loadeddata');$('seek').max=video.duration;resizeCanvas();await loadModel();$('dropzone').hidden=true;$('stage').hidden=false;await render();message('Vidéo prête. Relisez l’aperçu et ajoutez des zones si nécessaire.');controls();}
 catch(e){URL.revokeObjectURL(fileURL);fileURL=null;video.removeAttribute('src');video.load();$('stage').hidden=true;$('dropzone').hidden=false;message(e.message==='Choisissez une vidéo de 3 minutes maximum.'?e.message:'Impossible de préparer cette vidéo. Essayez un MP4 dans Chrome ou Edge récent.',true);controls();}
}
$('file').addEventListener('change',e=>{openFile(e.target.files[0]);e.target.value='';});$('replace').onclick=()=>$('file').click();
const dz=$('dropzone');['dragenter','dragover'].forEach(type=>dz.addEventListener(type,e=>{e.preventDefault();dz.classList.add('dragging');}));['dragleave','drop'].forEach(type=>dz.addEventListener(type,e=>{e.preventDefault();dz.classList.remove('dragging');}));dz.addEventListener('drop',e=>openFile(e.dataTransfer.files[0]));
$('play').onclick=async()=>{if(video.paused){try{await video.play();}catch{message('La lecture n’a pas démarré. Réessayez.',true);}}else video.pause();};
$('seek').oninput=()=>{video.pause();video.currentTime=Number($('seek').value);};
$('sensitivity').onchange=async()=>{video.pause();tracker.reset();invalidate();$('sensitivity-value').textContent=Number($('sensitivity').value)<=35?'Élevée':'Modérée';if(detector){await detector.setOptions({minDetectionConfidence:Number($('sensitivity').value)/100});safeRender();}};
document.querySelectorAll('[name=mode]').forEach(el=>el.onchange=()=>{invalidate();safeRender();if(el.value==='blur'&&!supportsCanvasBlur)message('Ce navigateur ne prend pas en charge le flou : un masque opaque protège les visages à la place.');});
$('resolution').onchange=()=>{video.pause();invalidate();if(fileURL&&video.videoWidth){resizeCanvas();safeRender();}};
$('keep-audio').onchange=()=>invalidate();
$('addmask').onclick=()=>{video.pause();drawing=!drawing;canvas.classList.toggle('drawing',drawing);$('addmask').textContent=drawing?'Terminer l’ajout de zones':'Ajouter une zone à masquer';message(drawing?'Tracez une zone. Pour la déplacer ensuite, changez la position dans la vidéo puis retracez cette même zone.':'Relisez l’aperçu avant de créer la vidéo.');};
const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
canvas.onpointerdown=e=>{if(!drawing||busy)return;start=point(e);canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(!start)return;const p=point(e);draft={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)};safeRender();};
canvas.onpointerup=()=>{if(draft&&draft.w>.01&&draft.h>.01){maskHistory.push(structuredClone(masks));let selected=$('mask-select').value;let mask=selected!==''?masks[Number(selected)]:null;if(!mask){mask={keys:[]};masks.push(mask);selected=String(masks.length-1);}putKey(mask,draft,video.currentTime);syncMaskList();$('mask-select').value=selected;invalidate();}start=null;draft=null;safeRender();controls();};canvas.onpointercancel=()=>{start=null;draft=null;safeRender();};
$('undo').onclick=()=>{masks=maskHistory.pop()||[];syncMaskList();invalidate();safeRender();controls();};
$('export').onclick=async()=>{
 if(busy)return;
 if(!window.VideoEncoder||!window.VideoDecoder){message('L’export nécessite Chrome ou Edge récent.',true);return;}
 prepareCompletionSound();
 const keepAudio=$('keep-audio').checked;
 video.pause();invalidate();drawing=false;start=null;draft=null;canvas.classList.remove('drawing');$('addmask').textContent='Ajouter une zone à masquer';busy=true;aborted=false;controls();$('progress').hidden=false;$('progress').value=0;
 try{
  await renderTask;tracker.reset();resizeCanvas();
  // Release the preview decoder before opening the export decoder (limited on iOS).
  previewResumeTime=video.currentTime;previewReleased=true;video.removeAttribute('src');video.load();
  exportInput=new Input({formats:ALL_FORMATS,source:new BlobSource(sourceFile)});
  let output,mime,extension;
  for(const format of [new Mp4OutputFormat(),new WebMOutputFormat()]){
   if(aborted)break;
   output=new Output({format,target:new BufferTarget()});
   conversion=await Conversion.init({input:exportInput,output,tracks:'primary',video:{forceTranscode:true,allowTransformationMetadata:false,processedWidth:canvas.width,processedHeight:canvas.height,process:async sample=>{
    if(aborted)throw new Error('cancelled');
    frame.width=sample.displayWidth;frame.height=sample.displayHeight;sample.draw(frameContext,0,0);
    const result=await detector.detect(frame);
    if(aborted)throw new Error('cancelled');
    paintFrame(result,sample.timestamp);return canvas;
   }},audio:{discard:!keepAudio}});
   const videoUsed=conversion.utilizedTracks.some(t=>t.type==='video');
   const lost=conversion.discardedTracks.some(t=>!['discarded_by_user','max_track_count_reached','not_primary_track'].includes(t.reason));
   if(conversion.isValid&&videoUsed&&!lost){mime=format instanceof Mp4OutputFormat?'video/mp4':'video/webm';extension=mime==='video/mp4'?'mp4':'webm';break;}
   await conversion.cancel();conversion=null;
  }
  if(aborted)throw new Error('cancelled');
  if(!conversion)throw new Error('Ce navigateur ne peut pas encoder cette vidéo avec les options choisies. Essayez Chrome ou Edge récent.');
  conversion.onProgress=p=>{$('progress').value=p;message(`Traitement des images : ${Math.round(p*100)} % · la cadence d’origine sera conservée.`);};
  message('Traitement de toutes les images avant reconstruction de la vidéo…');
  await conversion.execute();
  if(aborted)throw new Error('cancelled');
  const blob=new Blob([output.target.buffer],{type:mime});if(!blob.size)throw new Error('Le fichier créé est vide.');
  exportBlob=blob;outputURL=URL.createObjectURL(blob);$('open-output').href=outputURL;$('output').src=outputURL;$('download').href=outputURL;$('download').download=`${fileName}-masquee.${extension}`;
  $('result').hidden=false;message(`Vidéo créée ${keepAudio?'avec le son':'sans son'}, à la cadence d’origine. Vérifiez le résultat avant de télécharger.`);playCompletionSound();$('result').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){
  if(conversion)await conversion.cancel().catch(()=>{});
  const decoding=/decoder|decode|decoding|codec/i.test(e.message||'');
  message(aborted?'Traitement interrompu. Vous pouvez recommencer.':decoding?'Le navigateur n’a pas pu décoder cette vidéo. Sur iPhone, gardez Safari au premier plan et réessayez. Si l’erreur revient, utilisez une copie MP4 encodée en H.264 ; le format HEVC/HDR de certaines vidéos peut ne pas être pris en charge.':`L’export a échoué. ${e.message}`,!aborted);
 }
 finally{await cleanupExport();}
};
$('cancel').onclick=()=>{aborted=true;conversion?.cancel().catch(()=>{});};
$('reviewed').onchange=()=>{const enabled=$('reviewed').checked;$('download').classList.toggle('disabled',!enabled);$('download').setAttribute('aria-disabled',String(!enabled));};$('download').onclick=async e=>{
 if(!$('reviewed').checked){e.preventDefault();message('Cochez « J’ai vérifié la vidéo » pour activer le téléchargement.');return;}
 if(!exportBlob){e.preventDefault();message('Créez d’abord la vidéo masquée.',true);return;}
 if(window.showSaveFilePicker&&window.top===window){
  e.preventDefault();
  try{const ext=exportBlob.type==='video/mp4'?'.mp4':'.webm';const handle=await window.showSaveFilePicker({suggestedName:$('download').download,types:[{description:'Vidéo masquée',accept:{[exportBlob.type]:[ext]}}]});const writable=await handle.createWritable();await writable.write(exportBlob);await writable.close();message('Vidéo enregistrée sur votre appareil.');}
  catch(error){if(error.name==='AbortError')return;message('Le navigateur a bloqué l’enregistrement. Utilisez « Ouvrir la vidéo » puis le menu du lecteur pour l’enregistrer.',true);}
 }else message('Téléchargement demandé. S’il ne démarre pas, utilisez « Ouvrir la vidéo » puis le menu du lecteur pour l’enregistrer.');
};
window.addEventListener('beforeunload',()=>{if(fileURL)URL.revokeObjectURL(fileURL);if(outputURL)URL.revokeObjectURL(outputURL);detector?.close();});
if(!window.VideoEncoder||!window.VideoDecoder)message('Pour l’export vidéo, utilisez de préférence Chrome ou Edge récent.',true);

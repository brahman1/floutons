// Screen protection and estimates depend on capabilities, not the device brand.
export class ExportActivity {
 constructor(element){
  this.element=element;this.active=false;this.session=0;this.lock=null;this.pending=false;
  document.addEventListener('visibilitychange',()=>{
   if(!this.active)return;
   if(document.visibilityState==='visible')this.acquire();
   this.paint();
  });
 }
 start(){
  this.active=true;this.session++;this.progress=0;this.started=null;this.lockMessage='Demande de maintien de l’écran allumé…';
  this.element.hidden=false;this.paint();this.timer=setInterval(()=>this.paint(),1000);this.acquire();
 }
 beginProcessing(){this.started=performance.now();this.paint();}
 update(progress){if(Number.isFinite(progress))this.progress=Math.max(this.progress,Math.min(1,Math.max(0,progress)));this.paint();}
 async acquire(){
  if(!this.active||document.visibilityState!=='visible'||this.lock||this.pending)return;
  if(!navigator.wakeLock?.request){this.lockMessage='Maintien automatique de l’écran indisponible : évitez le verrouillage pendant le traitement.';this.paint();return;}
  this.pending=true;const session=this.session;
  try{
   const lock=await navigator.wakeLock.request('screen');
   if(!this.active||session!==this.session){await lock.release();return;}
   this.lock=lock;this.lockMessage='Écran maintenu allumé pendant le traitement. Gardez cette page visible.';
   lock.addEventListener('release',()=>{
    if(this.lock!==lock)return;
    this.lock=null;
    if(this.active){this.lockMessage='Maintien de l’écran interrompu : évitez le verrouillage et gardez cette page visible.';this.paint();}
   });
  }catch{
   if(this.active&&session===this.session)this.lockMessage='Maintien de l’écran refusé : gardez l’écran allumé et vérifiez le mode économie d’énergie.';
  }finally{
   this.pending=false;
   if(this.active&&session!==this.session)this.acquire();
   this.paint();
  }
 }
 paint(){
  if(!this.active)return;
  let timing='Préparation de l’export · estimation après les premières images…';
  if(this.started!==null){
   const elapsed=(performance.now()-this.started)/1000;
   let remaining='Calcul du temps restant…';
   if(this.progress>=.995)remaining='Finalisation de la vidéo…';
   else if(elapsed>=5&&this.progress>=.005){
    const seconds=elapsed*(1-this.progress)/this.progress;
    remaining=`Temps restant estimé : ${formatWait(seconds)}`;
   }
   timing=`Temps écoulé : ${formatWait(elapsed)} · ${remaining}`;
  }
  const screen=document.visibilityState==='visible'?this.lockMessage:'Page en arrière-plan : le traitement peut être interrompu. Revenez sur cette page.';
  this.element.textContent=`${timing}\n${screen}`;
 }
 async finish(){
  this.active=false;this.session++;clearInterval(this.timer);this.element.hidden=true;
  const lock=this.lock;this.lock=null;
  if(lock)await lock.release().catch(()=>{});
 }
}
function formatWait(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return 'quelques instants';
 const rounded=Math.ceil(seconds);
 if(rounded<60)return `${rounded} s`;
 const minutes=Math.floor(rounded/60),rest=rounded%60;
 return `${minutes} min${rest?` ${rest} s`:''}`;
}

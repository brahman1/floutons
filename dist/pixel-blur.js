// Three separable box passes approximate a Gaussian with replicated borders.
// Work stays bounded by the small face patch, not the full video resolution.
let first=new Float32Array(0),second=new Float32Array(0);
export function gaussianBlurPixels(pixels,width,height,sigma){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||pixels.length!==width*height*4||!Number.isFinite(sigma)||sigma<0)throw new Error('Invalid blur patch');
 if(sigma===0)return pixels;
 if(first.length<pixels.length){first=new Float32Array(pixels.length);second=new Float32Array(pixels.length);}
 first.set(pixels);
 const ideal=Math.sqrt(4*sigma*sigma+1);
 let lower=Math.floor(ideal);if(lower%2===0)lower--;lower=Math.max(1,lower);
 const upper=lower+2;
 const count=Math.max(0,Math.min(3,Math.round((12*sigma*sigma-3*lower*lower-12*lower-9)/(-4*lower-4))));
 for(let pass=0;pass<3;pass++){
  const radius=((pass<count?lower:upper)-1)/2;
  boxPass(first,second,width,height,radius,true);
  boxPass(second,first,width,height,radius,false);
 }
 for(let i=0;i<pixels.length;i++)pixels[i]=Math.round(first[i]);
 return pixels;
}
function boxPass(source,target,width,height,radius,horizontal){
 const length=horizontal?width:height,lines=horizontal?height:width;
 const step=horizontal?4:width*4,divisor=radius*2+1;
 for(let line=0;line<lines;line++){
  const base=horizontal?line*width*4:line*4;
  for(let channel=0;channel<4;channel++){
   let sum=0;
   for(let offset=-radius;offset<=radius;offset++)sum+=source[base+Math.max(0,Math.min(length-1,offset))*step+channel];
   for(let position=0;position<length;position++){
    target[base+position*step+channel]=sum/divisor;
    const leaving=Math.max(0,position-radius),entering=Math.min(length-1,position+radius+1);
    sum+=source[base+entering*step+channel]-source[base+leaving*step+channel];
   }
  }
 }
}

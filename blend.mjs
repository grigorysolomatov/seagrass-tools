// Display only: normalized sRGB blending; never participates in height math.
// Two-pass 8-neighbour chamfer distance to transparent support, capped at 32
// preview pixels. Outer image edges are also boundaries, including raw photos.
export function featherWeights(rgba,w,h){
 const d=new Float32Array(w*h),root=Math.SQRT2;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;d[i]=rgba[i*4+3]?Math.min(32,x+1,y+1,w-x,h-y):0;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!d[i])continue;if(x)d[i]=Math.min(d[i],d[i-1]+1);if(y){d[i]=Math.min(d[i],d[i-w]+1);if(x)d[i]=Math.min(d[i],d[i-w-1]+root);if(x+1<w)d[i]=Math.min(d[i],d[i-w+1]+root);}}
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(!d[i])continue;if(x+1<w)d[i]=Math.min(d[i],d[i+1]+1);if(y+1<h){d[i]=Math.min(d[i],d[i+w]+1);if(x)d[i]=Math.min(d[i],d[i+w-1]+root);if(x+1<w)d[i]=Math.min(d[i],d[i+w+1]+root);}}
 for(let i=0;i<d.length;i++)d[i]*=rgba[i*4+3]/255;
 return d;
}
export function blendPixels(sources,lo,extent,width,height){
 const out=new Uint8ClampedArray(width*height*4);
 // Stable source identity order makes fixed-pose reordering bit-identical.
 const prepared=[...sources].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>{const a=s.pose.matrix,det=a[0][0]*a[1][1]-a[0][1]*a[1][0];return {...s,inv:[a[1][1]/det,-a[0][1]/det,-a[1][0]/det,a[0][0]/det]};});
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const wx=lo[0]+(x+.5)*extent[0]/width,wy=lo[1]+(y+.5)*extent[1]/height;let total=0,r=0,g=0,b=0,alpha=0;
  for(const s of prepared){const dx=wx-s.pose.shift[0],dy=wy-s.pose.shift[1],a=s.inv;
   const u=Math.floor((a[0]*dx+a[1]*dy)*s.width/s.dimensions[0]),v=Math.floor((a[2]*dx+a[3]*dy)*s.height/s.dimensions[1]);
   if(u<0||v<0||u>=s.width||v>=s.height)continue;const i=v*s.width+u,k=i*4,w=s.weights[i];if(!w)continue;
   total+=w;r+=w*s.rgba[k];g+=w*s.rgba[k+1];b+=w*s.rgba[k+2];alpha=Math.max(alpha,s.rgba[k+3]);
  }
  if(total){const k=(y*width+x)*4;out[k]=Math.round(r/total);out[k+1]=Math.round(g/total);out[k+2]=Math.round(b/total);out[k+3]=alpha;}
 }
 return out;
}
export function photoCompositor(){
 const decoded=new Map();let previous='',mosaic=null,compositions=0,lastMilliseconds=0;
 return {
  get(items){
   const key=JSON.stringify(items.map(s=>[s.id,s.url,s.pose,s.dimensions]).sort((a,b)=>a[0].localeCompare(b[0])));
   if(key===previous)return mosaic;
   if(!items.length)return null;const start=performance.now();
   const active=new Set(items.map(s=>s.url));for(const key of decoded.keys())if(!active.has(key))decoded.delete(key);
   const points=items.flatMap(s=>[[0,0],[s.dimensions[0],0],s.dimensions,[0,s.dimensions[1]]].map(p=>[s.pose.matrix[0][0]*p[0]+s.pose.matrix[0][1]*p[1]+s.pose.shift[0],s.pose.matrix[1][0]*p[0]+s.pose.matrix[1][1]*p[1]+s.pose.shift[1]]));
   const lo=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...points.map(p=>p[k]))),extent=hi.map((v,k)=>v-lo[k]);
   const scale=1800/Math.max(...extent),width=Math.max(1,Math.round(extent[0]*scale)),height=Math.max(1,Math.round(extent[1]*scale));
   const sources=items.map(s=>{if(!decoded.has(s.url)){const c=document.createElement('canvas');c.width=s.image.width;c.height=s.image.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(s.image,0,0);const rgba=ctx.getImageData(0,0,c.width,c.height).data;decoded.set(s.url,{rgba,width:c.width,height:c.height,weights:featherWeights(rgba,c.width,c.height)});}return {...s,...decoded.get(s.url)};});
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(blendPixels(sources,lo,extent,width,height),width,height),0,0);
   previous=key;mosaic={canvas,lo,extent};compositions++;lastMilliseconds=performance.now()-start;return mosaic;
  },
  debug:()=>({compositions,lastMilliseconds,decoded:decoded.size,width:mosaic?.canvas.width,height:mosaic?.canvas.height})
 };
}

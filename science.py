"""Pure numerical operations; native (column,row) coordinates, raw Z in mm."""
import math, struct
import numpy as np
from PIL import Image, ImageDraw


def decode(path):
 raw=path.read_bytes(); sig=b'Binary TrueMap Data File v2.0\r\n\0'
 if not raw.startswith(sig): raise ValueError('Unsupported TMD signature')
 off=raw.index(b'\0',len(sig))+1
 w,h,lx,ly,ox,oy=struct.unpack_from('<II4f',raw,off)
 if len(raw)!=off+24+w*h*4 or min(w,h,lx,ly)<=0: raise ValueError('Invalid TMD geometry or length')
 z=np.frombuffer(raw,dtype='<f4',offset=off+24).reshape(h,w)
 if not np.isfinite(z).all(): raise ValueError('TMD contains non-finite heights')
 return z,[lx/w,ly/h]


def foreground_selection(z,mask,percent):
 """Shared inclusive top-Z selection over finite prepared foreground only."""
 if isinstance(percent,bool) or not math.isfinite(percent) or not 0<percent<=100:
  raise ValueError('Top percentage must be >0 and ≤100')
 z=np.asarray(z);mask=np.asarray(mask,bool)
 if z.ndim!=2 or mask.shape!=z.shape:raise ValueError('Height/mask shape mismatch')
 valid=mask & np.isfinite(z)
 count=int(valid.sum())
 if not count:raise ValueError('Source has no finite prepared foreground')
 cutoff=float(np.quantile(z[valid],1-percent/100,method='linear'))
 selected=valid & (z>=cutoff);n=int(selected.sum())
 return selected,dict(cutoff_mm=cutoff,valid_pixels=count,selected_pixels=n,
  selected_percent=100*n/count,population='finite prepared foreground raw Z; inclusive linear quantile')


def fit_curve(z,percent,degree,mask=None):
 if not isinstance(degree,int) or not 1<=degree<=8 or not math.isfinite(percent) or not 0<percent<=100: raise ValueError('Top percentage must be >0 and ≤100; degree must be integer 1–8')
 selected,selection=foreground_selection(z,np.ones(z.shape,bool) if mask is None else mask,percent)
 rows,cols=np.nonzero(selected); points=np.column_stack((cols,rows)).astype(float)
 if len(points)<degree+1: raise ValueError('Insufficient selected pixels for degree')
 center=points.mean(0); delta=points-center
 _,vectors=np.linalg.eigh(delta.T@delta/len(points)); axis=vectors[:,-1]
 if axis[0]<0:axis=-axis
 s=delta@axis; mid=float((s.min()+s.max())/2); half=float((s.max()-s.min())/2)
 if half<=0:raise ValueError('Selected pixels have no longitudinal support')
 t=(s-mid)/half
 coef,stats=np.polynomial.polynomial.polyfit(t,points,degree,full=True)
 if stats[1]!=degree+1 or not np.isfinite(coef).all():raise ValueError('Polynomial fit is rank deficient')
 return dict(**selection,center=center.tolist(),axis=axis.tolist(),mid=mid,half=half,coefficients=coef.tolist(),rank=int(stats[1]),degree=degree,top=percent),selected


def clip_curve(fit,mask):
 h,w=mask.shape; c=np.array(fit['coefficients']); center=np.array(fit['center']); axis=np.array(fit['axis'])
 corners=np.array([[0,0],[w-1,0],[0,h-1],[w-1,h-1]])
 limits=((corners-center)@axis-fit['mid'])/fit['half']
 ts=np.linspace(limits.min(),limits.max(),int(np.ceil((limits.max()-limits.min())*fit['half']*4))+1)
 xy=np.column_stack([np.polynomial.polynomial.polyval(ts,c[:,k]) for k in range(2)])
 ix=np.rint(xy[:,0]).astype(int); iy=np.rint(xy[:,1]).astype(int)
 ok=(ix>=0)&(iy>=0)&(ix<w)&(iy<h); inside=np.zeros(len(ts),bool);inside[ok]=mask[iy[ok],ix[ok]]
 anchor=int(np.argmin(abs(ts)))
 if not inside[anchor]:raise ValueError('Curve center lies outside mask; try different top percentage or degree')
 a=b=anchor
 while a>0 and inside[a-1]:a-=1
 while b+1<len(ts) and inside[b+1]:b+=1
 if b-a<2:raise ValueError('No usable connected curve interval')
 ends=xy[[a,b]]; tangents=np.array([[np.polynomial.polynomial.polyval(t,np.polynomial.polynomial.polyder(c[:,k])) for k in range(2)] for t in ts[[a,b]]])
 if np.any(np.linalg.norm(tangents,axis=1)<1e-9):raise ValueError('Singular endpoint tangent')
 stroke=Image.new('L',(w,h)); d=ImageDraw.Draw(stroke);dist=0
 for j in range(a,b):
  if (-1<=ts[j]<=1 and -1<=ts[j+1]<=1) or int(dist//28)%2==0:d.line([tuple(xy[j]),tuple(xy[j+1])],fill=255,width=10)
  dist+=float(np.linalg.norm(xy[j+1]-xy[j]))
 return dict(ends=ends.tolist(),tangents=tangents.tolist(),interval=ts[[a,b]].tolist()),(np.asarray(stroke)>0)&mask


def placement(geometry,spacing,angle=0,mirror_h=False,mirror_v=False,reverse=False,previous=None,overlap=0):
 ends=np.array(geometry['ends']); tangents=np.array(geometry['tangents'])
 if reverse:ends=ends[::-1];tangents=-tangents[::-1]
 D=np.diag(spacing); M=np.diag([-1 if mirror_h else 1,-1 if mirror_v else 1]); local=M@D
 incoming=local@tangents[0]
 auto=0 if previous is None else math.atan2(previous['direction'][1],previous['direction'][0])-math.atan2(incoming[1],incoming[0])
 # The first slice anchors global orientation; following slices solve tangency.
 theta=-math.radians(angle) if previous is None else auto;R=np.array([[math.cos(theta),-math.sin(theta)],[math.sin(theta),math.cos(theta)]]);A=R@local
 target=np.zeros(2) if previous is None else np.array(previous['end'])-overlap*np.array(previous['direction'])/np.linalg.norm(previous['direction'])
 shift=target-A@ends[0];out=A@tangents[1]
 return dict(matrix=A.tolist(),shift=shift.tolist(),start=target.tolist(),end=(A@ends[1]+shift).tolist(),direction=out.tolist())
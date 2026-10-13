"""Hand-drawn slice stems: a polyline in native (column,row) pixel centres, y down.

Fallback where the automatic Top % stem fails. For Align the line itself is the
slice's stem (ends and end-segment tangents, see hand_stem.mjs). For the
combined stem the line REPLACES that slice's Top % cohort by the same number of
observations, spaced at equal arclength along the line, so the slice keeps the
weight its automatic cohort would have had. No smoothing or fitting here.
"""
import math
import numpy as np

MAX_POINTS=500


def validate(points,shape):
 """Return points as float [x,y] lists inside the native scan rectangle."""
 h,w=shape
 if not isinstance(points,list) or not 2<=len(points)<=MAX_POINTS:raise ValueError(f'A hand-drawn stem needs 2–{MAX_POINTS} points')
 out=[]
 for p in points:
  if not isinstance(p,list) or len(p)!=2 or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in p):
   raise ValueError('Hand-drawn stem points must be finite [x, y] pixel pairs')
  x,y=float(p[0]),float(p[1])
  if not (-.5<=x<=w-.5 and -.5<=y<=h-.5):raise ValueError('Hand-drawn stem point lies outside its scan')
  out.append([x,y])
 if np.any(np.hypot(*np.diff(np.asarray(out),axis=0).T)==0):raise ValueError('Hand-drawn stem repeats a point; move or remove it')
 return out


def samples(points,n):
 """n>=2 positions at equal arclength along the polyline, both ends included."""
 if isinstance(n,bool) or not isinstance(n,int) or n<2:raise ValueError('Need at least two samples')
 a=np.asarray(points,float);seg=np.hypot(*np.diff(a,axis=0).T);cum=np.r_[0.,np.cumsum(seg)]
 s=np.linspace(0.,cum[-1],n)
 i=np.clip(np.searchsorted(cum,s,side='right')-1,0,len(seg)-1)
 f=(s-cum[i])/seg[i]
 return a[i]+f[:,None]*(a[i+1]-a[i])


def request_lines(value,sources):
 """Validate {slice path: points} against THIS merge's sources; merge order."""
 if value is None or value=={}:return {}
 if not isinstance(value,dict):raise ValueError('Hand-drawn stems must map slice paths to points')
 shapes={s['path']:s['shape'] for s in sources}
 for path in value:
  if path not in shapes:raise ValueError('Hand-drawn stem belongs to a slice outside this merge; Merge again')
 return {s['path']:validate(value[s['path']],shapes[s['path']]) for s in sources if s['path'] in value}

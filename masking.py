"""Experimental calibration-assisted foreground mask.
Always recomputed for unseen source hashes; seed stays full-image top 5%.
"""
import hashlib
import numpy as np
from PIL import Image
import cv2
from scipy import ndimage as ndi
from skimage import morphology

def improved_mask(folder,scan,cal,z,params=None):
 params=params or dict(threshold=99,closing=4,core=16,halo=8,iterations=6)
 cv2.setNumThreads(2);cv2.setRNGSeed(0)
 h,w=z.shape;ff=cal['flatfield'];calpng=folder/ff['modelfile']
 sw,sh=(int(x.strip()) for x in str(ff['modelsize']).strip('()').split(',')); full=tuple(int(x.strip()) for x in str(ff['size']).strip('()').split(','));assert full==(w,h)
 flat=np.asarray(Image.open(calpng));assert flat.dtype==np.uint16 and flat.shape==(sh*2,sw*3) and len(scan['images'])==6
 corrected=[];channel_hashes={}
 for k,name in enumerate(scan['images']):
  channel_hashes[name]=hashlib.sha256((folder/name).read_bytes()).hexdigest()
  tile=flat[(k//3)*sh:(k//3+1)*sh,(k%3)*sw:(k%3+1)*sw].astype(np.float32)/65535
  enlarged=np.asarray(Image.fromarray(tile).resize(full,Image.Resampling.BICUBIC));assert (enlarged>0).all()
  image=np.asarray(Image.open(folder/name)).astype(np.float32)/255
  corrected_image=np.clip(image*ff['scale'][k]/enlarged,0,1)
  corrected.append(np.asarray(Image.fromarray(corrected_image).resize((sw,sh),Image.Resampling.BOX)))
 C=np.stack(corrected,axis=-1); yy,xx=np.mgrid[-1:1:complex(sh),-1:1:complex(sw)]
 V=np.stack([np.ones_like(xx),xx,yy,xx*xx,xx*yy,yy*yy],axis=-1).reshape(-1,6);border=(abs(xx)>.9)|(abs(yy)>.9)
 ix=np.flatnonzero(border.ravel())[::4];X=V[ix];Y=C.reshape(-1,6)[ix];coef=np.linalg.lstsq(X,Y,rcond=None)[0]
 for _ in range(8):
  residual=Y-X@coef;norm=np.sqrt(np.mean(residual**2,axis=1));med=np.median(norm);mad=1.4826*np.median(abs(norm-med))+1e-6
  weights=np.minimum(1,2.5*mad/np.maximum(abs(norm-med),1e-9));coef=np.linalg.lstsq(X*np.sqrt(weights[:,None]),Y*np.sqrt(weights[:,None]),rcond=None)[0]
 residual=C-(V@coef).reshape(sh,sw,6);sigma=np.maximum(1.4826*np.median(abs(residual[border]-np.median(residual[border],axis=0)),axis=0),.001)
 score=ndi.gaussian_filter(np.sqrt(np.mean((residual/sigma)**2,axis=2)),1);threshold=float(np.quantile(score[border],params["threshold"]/100))
 seed=np.asarray(Image.fromarray((z>=float(np.quantile(z,.95))).astype('uint8')).resize((sw,sh),Image.Resampling.NEAREST))>0
 def main_component(mask):
  lab,n=ndi.label(mask);overlap=np.bincount(lab[seed],minlength=n+1);overlap[0]=0;idx=int(np.argmax(overlap));assert idx>0;return lab==idx
 initial=ndi.binary_closing(score>threshold,structure=morphology.disk(params["closing"]));initial=ndi.binary_fill_holes(main_component(initial));initial=ndi.binary_fill_holes(ndi.binary_closing(initial,structure=morphology.disk(2)))
 photo=Image.open(folder/'thumbnail.jpg').convert('RGB');assert photo.size==full
 small=np.array(photo.resize((sw,sh),Image.Resampling.LANCZOS));core=ndi.binary_erosion(initial,structure=morphology.disk(params["core"]));allowed=ndi.binary_dilation(initial,structure=morphology.disk(params["halo"]))
 gc=np.full((sh,sw),cv2.GC_BGD,dtype=np.uint8);gc[allowed]=cv2.GC_PR_BGD;gc[initial]=cv2.GC_PR_FGD;gc[core]=cv2.GC_FGD
 cv2.grabCut(small,gc,None,np.zeros((1,65),np.float64),np.zeros((1,65),np.float64),params["iterations"],cv2.GC_INIT_WITH_MASK)
 working=ndi.binary_fill_holes(main_component((gc==cv2.GC_FGD)|(gc==cv2.GC_PR_FGD)));working=ndi.binary_fill_holes(ndi.binary_closing(working,structure=morphology.disk(1)))
 assert ndi.label(working)[1]==1 and np.array_equal(working,ndi.binary_fill_holes(working))
 assert not (working[0,:].any() or working[-1,:].any() or working[:,0].any() or working[:,-1].any())
 native=np.asarray(Image.fromarray((working*255).astype('uint8')).resize(full,Image.Resampling.NEAREST))>0
 return native

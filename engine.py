"""Local-only Seagrass Stitcher server. Sources are read-only; cache is derived."""
from pathlib import Path
import os
import argparse, errno, hashlib, json, math, mimetypes, socket, threading, traceback, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import numpy as np
import yaml
from PIL import Image
from science import decode, fit_curve, clip_curve
from masking import improved_mask

HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('SEAGRASS_DATA_ROOT',str(Path.cwd()))).expanduser().resolve()
DEFAULT=ROOT
CACHE=Path(os.environ.get('SEAGRASS_CACHE',str(Path(os.environ.get('XDG_CACHE_HOME',str(Path.home()/'.cache')))/'seagrass-tools'))).expanduser().resolve()
STATE={'busy':False,'message':'Ready','results':{},'error':None,'job':0}
LOCK=threading.Lock()
REGISTERED=set()


def safe_path(value):
 p=Path(value)
 if not p.is_absolute() or '..' in p.parts:raise ValueError('Choose an absolute folder under the configured data root')
 resolved=p.resolve()
 if not resolved.is_relative_to(ROOT) or 'z.hide' in p.parts or 'z.hide' in resolved.parts:raise ValueError('Folder is outside allowed data root or archived')
 if not resolved.is_dir():raise ValueError('Folder does not exist')
 return resolved


def file_in(folder,name):
 if not isinstance(name,str):raise ValueError('Invalid filename in scan metadata')
 p=(folder/name).resolve()
 if not p.is_relative_to(folder) or not p.is_file():raise ValueError('Missing or unsafe file: '+name)
 return p


def inspect_source(path):
 folder=safe_path(path);scan=yaml.safe_load(file_in(folder,'scan.yaml').read_text())
 if not isinstance(scan,dict) or not isinstance(scan.get('images'),list) or not isinstance(scan.get('calib'),str):raise ValueError('scan.yaml must specify acquisition images and calibration file')
 photo=file_in(folder,'thumbnail.jpg');tmds=list(folder.glob('*.tmd'))
 if len(tmds)!=1:raise ValueError('Expected exactly one TMD height file')
 height=file_in(folder,tmds[0].name)
 calpath=file_in(folder,scan['calib']);cal=yaml.safe_load(calpath.read_text())
 if not isinstance(cal,dict) or not isinstance(cal.get('flatfield'),dict) or not all(k in cal['flatfield'] for k in ['modelfile','modelsize','size','scale']):raise ValueError('Calibration YAML is missing required flatfield settings')
 flat=file_in(folder,cal['flatfield']['modelfile'])
 if len(scan['images'])!=6:raise ValueError('Expected six acquisition images')
 files=[file_in(folder,'scan.yaml'),photo,height,calpath,flat]+[file_in(folder,n) for n in scan['images']]
 return folder,scan,cal,files,height


def number(v,lo,hi,label,integer=False,exclusive=False):
 if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or (v<=lo if exclusive else v<lo) or v>hi or (integer and int(v)!=v):raise ValueError(label+' is outside its valid range')
 return int(v) if integer else float(v)


def validate_config(c):
 if not isinstance(c,dict) or c.get('version')!=1:raise ValueError('Unsupported setup version (expected 1)')
 if not isinstance(c.get('shared'),dict) or not isinstance(c.get('layers'),dict):raise ValueError('Shared settings and layers must be objects')
 shared=c.get('shared',{});number(shared.get('top'),0,100,'Top percentage',exclusive=True);number(shared.get('degree'),1,8,'Degree',True);number(shared.get('overlap'),-50,50,'Overlap (mm)')
 slices=c.get('slices');joins=c.get('joins',{});layers=c.get('layers',{})
 if not isinstance(slices,list) or len(slices)>30:raise ValueError('Setup supports up to 30 slices')
 ids=set()
 for s in slices:
  if not isinstance(s,dict):raise ValueError('Invalid slice')
  p=str(safe_path(s.get('path','')))
  if s.get('id')!=p or p in ids:raise ValueError('Slice identity must be its unique full folder path')
  ids.add(p)
  number(s.get('top'),0,100,'Slice top percentage',exclusive=True);number(s.get('degree'),1,8,'Slice degree',True);number(s.get('angle'),-3600,3600,'Rotation (degrees)')
  for k in ['topLocked','degreeLocked','mirrorH','mirrorV','reverse']:
   if type(s.get(k)) is not bool:raise ValueError('Invalid slice flag: '+k)
 if not isinstance(joins,dict):raise ValueError('Invalid joins')
 valid_pairs={json.dumps([slices[i-1]['id'],slices[i]['id']],separators=(',',':')) for i in range(1,len(slices))}
 for key,j in joins.items():
  if key not in valid_pairs or not isinstance(j,dict) or type(j.get('locked')) is not bool:raise ValueError('Invalid adjacent join')
  number(j.get('value'),-50,50,'Join overlap')
 for k in ['photo','highlight','curve','joins']:
  if type(layers.get(k)) is not bool:raise ValueError('Invalid layer: '+k)
 if layers.get('mask') not in ['original','improved']:raise ValueError('Invalid mask display')
 return c


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def signature(obj):return hashlib.sha256(json.dumps(obj,sort_keys=True).encode()).hexdigest()


# Per-artifact locks: different slices compute concurrently, while two requests
# for the same cache key (e.g. step 2 and step 3 racing) publish it only once.
# Slices are independent and the computation is deterministic per slice (OpenCV's
# RNG is per-thread and reseeded in masking), so results are byte-identical to
# serial runs. WORKERS bounds parallel heavy work: each 16 MP scan needs ~0.8 GB.
WORKERS=max(1,int(os.environ.get('SEAGRASS_WORKERS',str(min(4,os.cpu_count() or 1)))))
WORK_SLOTS=threading.BoundedSemaphore(WORKERS)
KEY_LOCKS={};KEY_GUARD=threading.Lock()
def key_lock(kind,key):
 with KEY_GUARD:return KEY_LOCKS.setdefault((kind,key),threading.Lock())


BACKGROUND_DEFAULTS=dict(enabled=False,threshold=99,closing=4,core=16,halo=8,iterations=6)
MASKS=set()
def validate_background(value):
 if not isinstance(value,dict):raise ValueError('Background settings must be an object')
 p={**BACKGROUND_DEFAULTS,**value}
 if type(p['enabled']) is not bool:raise ValueError('Invalid background flag')
 for k,lo,hi,integer in [('threshold',50,99.99,False),('closing',0,30,True),('core',1,40,True),('halo',1,40,True),('iterations',1,20,True)]:
  p[k]=number(p[k],lo,hi,k,integer)
 return {k:p[k] for k in BACKGROUND_DEFAULTS}

def prepare_mask(path,background):
 # This stage deliberately has no fit/clip dependency.
 folder,scan,cal,files,height=inspect_source(path)
 params=validate_background(background)
 deps={'inputs':{p.name:digest(p) for p in files},'algorithm_sha256':digest(HERE/'masking.py'),'parameters':params,'seed_top':5,'asset_version':1}
 key=signature(deps);dest=CACHE/'masks'/key;dest.mkdir(parents=True,exist_ok=True)
 with key_lock('mask',key):
  if not (dest/'meta.json').exists():
   with WORK_SLOTS:_compute_mask(folder,scan,cal,height,params,deps,key,dest)
 MASKS.add(key);return json.loads((dest/'meta.json').read_text())

def _compute_mask(folder,scan,cal,height,params,deps,key,dest):
 from scipy import ndimage as ndi
 z,spacing=decode(height);h,w=z.shape
 mask=improved_mask(folder,scan,cal,z,params)
 Image.fromarray((mask*255).astype('uint8')).save(dest/'mask.png')
 size=(min(1800,w),round(h*min(1800,w)/w))
 photo=Image.open(folder/'thumbnail.jpg').convert('RGBA');photo.putalpha(Image.fromarray((mask*255).astype('uint8')))
 photo.resize(size,Image.Resampling.LANCZOS).save(dest/'photo.png')
 small=np.asarray(Image.fromarray((mask*255).astype('uint8')).resize(size,Image.Resampling.NEAREST))>0
 boundary=small & ~ndi.binary_erosion(small,iterations=2)
 outline=Image.new('RGBA',size,(0,255,200,0));outline.putalpha(Image.fromarray((boundary*255).astype('uint8')));outline.save(dest/'outline.png')
 r=dict(key=key,provenance=deps,assets={k:f'/mask-asset/{key}/{k}.png' for k in ['photo','outline']})
 (dest/'meta.json').write_text(json.dumps(r))

def process_slice(item,shared,background=None):
 folder,scan,cal,files,height=inspect_source(item['path'])
 hashes={p.name:digest(p) for p in files}
 background=validate_background(background or {})
 # Foreground is scientific support, never a display preference. Even direct
 # callers cannot accidentally register the arbitrary scan rectangle.
 background['enabled']=True
 mask_result=prepare_mask(str(folder),background)
 mask_key=mask_result['key']
 md=CACHE/'masks'/mask_key
 top=shared['top'] if item['topLocked'] else item['top'];degree=int(shared['degree'] if item['degreeLocked'] else item['degree'])
 deps={'source':hashes,'mask_key':mask_key,'science_sha256':digest(HERE/'science.py'),'top':top,'degree':degree,'asset_version':4,'selection':'finite-prepared-foreground-linear-inclusive-v1'}
 key=signature(deps);dest=CACHE/'results'/key
 with key_lock('fit',key):return _fit_slice(item,folder,height,mask_result,md,top,degree,deps,key,dest)

def _fit_slice(item,folder,height,mask_result,md,top,degree,deps,key,dest):
 if (dest/'result.json').is_file():
  result=json.loads((dest/'result.json').read_text());result['path']=str(folder);result['id']=item['id'];result['cache_hit']=True;REGISTERED.add(key);return result
 with WORK_SLOTS:return _compute_fit(item,folder,height,mask_result,md,top,degree,deps,key,dest)

def _compute_fit(item,folder,height,mask_result,md,top,degree,deps,key,dest):
 z,spacing=decode(height);h,w=z.shape
 photo=Image.open(folder/'thumbnail.jpg').convert('RGB')
 if photo.size!=(w,h):raise ValueError('Photo and TMD dimensions do not match')
 mask=np.array(Image.open(md/'mask.png'))>0 if mask_result else np.ones(z.shape,dtype=bool)
 STATE['message']='Fitting '+folder.name
 fit,selected=fit_curve(z,top,degree,mask);geometry,curve=clip_curve(fit,mask)
 dest.mkdir(parents=True,exist_ok=True)
 rows,cols=np.nonzero(selected);np.savez_compressed(dest/'native.npz',selected_xy=np.column_stack((cols,rows)),coefficients=np.array(fit['coefficients']),spacing_mm=spacing)
 size=(min(1800,w),round(h*min(1800,w)/w));assets={}
 for name,fg in [('improved',mask),('original',z>0)]:
  assets[name]={}
  for layer in ['photo','highlight','curve']:
   if layer=='photo':im=photo.copy().convert('RGBA');alpha=fg.astype('uint8')*255
   else:
    im=Image.new('RGBA',(w,h),(255,0,136,0) if layer=='highlight' else (255,255,255,0));alpha=((selected if layer=='highlight' else curve)&fg).astype('uint8')*(191 if layer=='highlight' else 255)
   im.putalpha(Image.fromarray(alpha));filename=f'{name}-{layer}.png';(im if layer=='highlight' else im.resize(size,Image.Resampling.LANCZOS)).save(dest/filename);assets[name][layer]=f'/asset/{key}/{filename}'
 result=dict(id=item['id'],path=str(folder),key=key,fit=fit,geometry=geometry,spacing=spacing,dimensions=[w,h],asset_size=list(size),assets=assets,provenance=deps,cache_hit=False)
 (dest/'result.json').write_text(json.dumps(result,indent=2));REGISTERED.add(key)
 return result


def run_job(config):
 try:
  output={}
  for i,item in enumerate(config['slices']):
   STATE['message']=f'{i+1}/{len(config["slices"])} · validating '+Path(item['path']).name
   output[item['id']]=process_slice(item,config['shared'])
  with LOCK:STATE.update(results=output,error=None,message=f'Current · {len(output)} slices')
 except Exception as exc:
  traceback.print_exc();STATE.update(error=str(exc),message='Run failed · last good preview retained')
 finally:STATE['busy']=False


class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def respond(self,status,obj,kind='application/json'):
  raw=json.dumps(obj).encode() if kind=='application/json' else obj
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(raw)
 def do_GET(self):
  try:
   u=urlparse(self.path)
   if u.path=='/api/health':return self.respond(200,{'status':'ok'})
   if u.path=='/api/status':return self.respond(200,STATE)
   if u.path=='/api/browse':
    path=safe_path(parse_qs(u.query).get('path',[str(DEFAULT)])[0]);entries=[]
    for child in sorted(path.iterdir()):
     if child.name.startswith('.') or child.name=='z.hide' or not child.is_dir():continue
     try:p=safe_path(str(child))
     except ValueError:continue
     error=None;valid=False
     if (p/'scan.yaml').is_file() or (p/'thumbnail.jpg').exists() or (p/'image01.png').exists() or any(p.glob('*.tmd')):
      try:inspect_source(str(p));valid=True
      except Exception as exc:error=str(exc)
     entries.append(dict(path=str(p),name=child.name,valid=valid,error=error))
    return self.respond(200,dict(path=str(path),parent=str(path.parent) if path!=ROOT else None,entries=entries))
   if u.path.startswith('/asset/'):
    parts=u.path.split('/')
    if len(parts)!=4 or parts[2] not in REGISTERED or parts[3] not in {f'{m}-{l}.png' for m in ['original','improved'] for l in ['photo','highlight','curve']}:raise ValueError('Unregistered asset')
    return self.respond(200,(CACHE/'results'/parts[2]/parts[3]).read_bytes(),'image/png')
   paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}
   if u.path not in paths:return self.respond(404,{'error':'Not found'})
   file=HERE/paths[u.path];return self.respond(200,file.read_bytes(),mimetypes.guess_type(file.name)[0] or 'text/plain')
  except (ValueError,KeyError,TypeError,FileNotFoundError,PermissionError) as exc:self.respond(400,{'error':str(exc)})
 def do_POST(self):
  try:
   origin=self.headers.get('Origin')
   if origin and origin!=f'http://{self.headers.get("Host")}':raise ValueError('Cross-origin requests are not allowed')
   if self.headers.get_content_type()!='application/json':raise ValueError('JSON required')
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<=1000000:raise ValueError('Setup too large or empty')
   c=validate_config(json.loads(self.rfile.read(length)))
   if self.path=='/api/validate':return self.respond(200,c)
   if self.path!='/api/run':return self.respond(404,{'error':'Not found'})
   with LOCK:
    if STATE['busy']:return self.respond(409,{'error':'A run is already in progress'})
    STATE.update(busy=True,error=None,message='Starting',job=STATE['job']+1)
   threading.Thread(target=run_job,args=(c,),daemon=True).start();self.respond(202,{'job':STATE['job']})
  except (ValueError,TypeError,KeyError) as exc:self.respond(400,{'error':str(exc)})


def main():
 parser=argparse.ArgumentParser();parser.add_argument('--no-browser',action='store_true');parser.add_argument('--port',type=int,default=0);args=parser.parse_args()
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler,bind_and_activate=False)
 try:server.server_address=('127.0.0.1',args.port);server.server_bind()
 except OSError as exc:
  if exc.errno!=errno.EADDRINUSE:raise
  print('Preferred port occupied; using an unused port.',flush=True);server.server_address=('127.0.0.1',0);server.server_bind()
 server.server_activate();url=f'http://127.0.0.1:{server.server_address[1]}'
 print('Seagrass Stitcher: '+url,flush=True)
 if not args.no_browser:
  try:
   if not webbrowser.open(url):print('Browser did not open; use the URL above.',flush=True)
  except Exception as exc:print('Browser opening failed: '+str(exc),flush=True)
 server.serve_forever()

if __name__=='__main__':main()

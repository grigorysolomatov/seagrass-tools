"""v3 local HTTP facade; cheap source display is independent of fitting."""
import os
from pathlib import Path
import argparse
import errno
import json
import mimetypes
import threading
import traceback
import webbrowser
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse
import numpy as np
from PIL import Image
import engine
import merge
import postmerge
import nearest_stem
import leaf_borders
import csv_exports
import curve_edit
import area
from science import decode

HERE=engine.HERE
SCIENCE_LOCK=threading.Lock()  # Post-merge stages are serialized; per-slice mask/fit use engine's bounded workers and per-key locks.
LOAD_LOCK=threading.Lock()
AREA_LOCK=threading.Lock()
LOADS=set()

def load_slice(path):
 folder,scan,cal,files,height=engine.inspect_source(path)
 # No calibration image reads, masking or polynomial fitting on Load.
 key=engine.signature({'path':str(folder),'height':engine.digest(height),'photo':engine.digest(folder/'thumbnail.jpg'),'display':1})
 dest=engine.CACHE/'loads'/key
 with LOAD_LOCK:
  if not (dest/'meta.json').exists():
   z,spacing=decode(height);h,w=z.shape
   with Image.open(folder/'thumbnail.jpg') as photo:
    if photo.size!=(w,h):raise ValueError('Photo and TMD dimensions do not match')
    size=(min(1800,w),round(h*min(1800,w)/w));dest.mkdir(parents=True,exist_ok=True)
    photo.convert('RGB').resize(size,Image.Resampling.LANCZOS).save(dest/'photo.png')
   lo,hi=float(z.min()),float(z.max())
   # Display stretch only; raw Z is never overwritten or quantized for fitting.
   display=np.clip((z-lo)/max(hi-lo,1e-12)*255,0,255).astype('uint8')
   Image.fromarray(display).resize(size,Image.Resampling.BILINEAR).save(dest/'height.png')
   r=dict(id=str(folder),path=str(folder),key=key,dimensions=[w,h],spacing=spacing,asset_size=list(size),height_range_mm=[lo,hi],assets={k:f'/load-asset/{key}/{k}.png' for k in ['photo','height']})
   (dest/'meta.json').write_text(json.dumps(r))
  r=json.loads((dest/'meta.json').read_text());LOADS.add(key);return r

class Handler(engine.Handler):
 def parse_request(self):
  if not super().parse_request():return False
  try:
   host=urlparse('http://'+self.headers.get('Host',''))
   if host.hostname not in {'localhost','127.0.0.1'} or host.username or host.password:
    raise ValueError('Only localhost Host headers are allowed')
  except ValueError:
   self.send_error(403,'Only localhost Host headers are allowed');return False
  return True
 def do_GET(self):
  try:
   path=urlparse(self.path).path
   if path.startswith('/post-asset/'):
    parts=path.split('/')
    if len(parts)!=4 or parts[2] not in postmerge.ARTIFACTS or parts[3] not in postmerge.ASSETS:raise ValueError('Unknown post-merge asset')
    return self.respond(200,(engine.CACHE/'postmerge'/parts[2]/parts[3]).read_bytes(),'image/png' if parts[3].endswith('.png') else 'application/octet-stream')
   if path.startswith('/merge-asset/'):
    parts=path.split('/')
    if len(parts)!=4 or parts[2] not in merge.MERGES or parts[3]!='height.png':raise ValueError('Unknown merge asset')
    return self.respond(200,(engine.CACHE/'merges'/parts[2]/'height.png').read_bytes(),'image/png')
   if path.startswith('/mask-asset/'):
    parts=path.split('/')
    if len(parts)!=4 or parts[2] not in engine.MASKS or parts[3] not in ['photo.png','outline.png']:raise ValueError('Unknown mask asset')
    return self.respond(200,(engine.CACHE/'masks'/parts[2]/parts[3]).read_bytes(),'image/png')
   if path.startswith('/load-asset/'):
    parts=path.split('/')
    if len(parts)!=4 or parts[2] not in LOADS or parts[3] not in ['photo.png','height.png']:raise ValueError('Unknown display asset')
    return self.respond(200,(engine.CACHE/'loads'/parts[2]/parts[3]).read_bytes(),'image/png')
   if path in ['/','/app.js','/post.js','/blend.mjs','/model.mjs','/curve_edit.mjs','/hand_stem.mjs','/plot.mjs','/style.css']:
    file=HERE/('index.html' if path=='/' else path[1:]);kind='text/javascript' if file.suffix in ['.js','.mjs'] else mimetypes.guess_type(file.name)[0]
    return self.respond(200,file.read_bytes(),kind)
   if path in ['/api/health','/api/browse'] or path.startswith('/asset/'):return super().do_GET()
   self.respond(404,{'error':'Not found'})
  except Exception as exc:self.respond(400,{'error':str(exc)})
 def do_POST(self):
  try:
   origin=self.headers.get('Origin')
   if origin and origin!=f'http://{self.headers.get("Host")}':raise ValueError('Cross-origin requests forbidden')
   if self.headers.get_content_type()!='application/json':raise ValueError('JSON required')
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<=1000000:raise ValueError('Invalid request length')
   body=json.loads(self.rfile.read(length))
   if self.path=='/api/curve/edit':
    with SCIENCE_LOCK:r=curve_edit.request(body)
    return self.respond(200,r)
   if self.path=='/api/area':
    with AREA_LOCK:r=area.request(body)  # cached merge only; own lock, never blocks stems/candidates
    return self.respond(200,r)
   if self.path=='/api/area/export':
    with AREA_LOCK:r=area.export(body)
    return self.respond(200,r)
   if self.path=='/api/plot':
    with SCIENCE_LOCK:r=csv_exports.request({**body,'plot':True,'quality':True,'filename':'plot.csv'})
    return self.respond(200,r)
   if self.path=='/api/export':
    with SCIENCE_LOCK:r=csv_exports.request(body)
    return self.respond(200,r)
   if self.path=='/api/post/borders':
    with SCIENCE_LOCK:r=leaf_borders.request(body)
    return self.respond(200,r)
   if self.path=='/api/post/connections':
    with SCIENCE_LOCK:r=nearest_stem.request(body)
    return self.respond(200,r)
   if self.path in ['/api/post/stem','/api/post/residual','/api/post/peaks']:
    with SCIENCE_LOCK:r=postmerge.request(self.path.rsplit('/',1)[-1],body)
    return self.respond(200,r)
   if self.path=='/api/merge':
    with SCIENCE_LOCK:r=merge.merge_request(body)
    return self.respond(200,r)
   if self.path=='/api/load':return self.respond(200,load_slice(body['path']))
   if self.path=='/api/mask':
    params=engine.validate_background(body['background'])
    r=engine.prepare_mask(body['path'],params)  # per-slice parallel; engine bounds workers and locks per cache key
    return self.respond(200,r)
   if self.path=='/api/fit':
    top=engine.number(body['top'],0,100,'Top %',exclusive=True);degree=engine.number(body['degree'],1,8,'Degree',True)
    path=str(engine.safe_path(body['path']))
    r=engine.process_slice(dict(id=path,path=path,topLocked=True,degreeLocked=True),dict(top=top,degree=degree),engine.validate_background(body.get("background",{})))
    return self.respond(200,r)
   self.respond(404,{'error':'Not found'})
  except Exception as exc:
   traceback.print_exc();self.respond(400,{'error':str(exc)})

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--no-browser',action='store_true');parser.add_argument('--port',type=int,default=int(os.environ.get('SEAGRASS_PORT','8000')));parser.add_argument('--host',choices=['127.0.0.1','0.0.0.0'],default='127.0.0.1');parser.add_argument('--data-root',default=str(engine.ROOT));parser.add_argument('--cache-dir',default=str(engine.CACHE));args=parser.parse_args()
 engine.ROOT=Path(args.data_root).expanduser().resolve(strict=True);engine.DEFAULT=engine.ROOT;engine.CACHE=Path(args.cache_dir).expanduser().resolve();engine.CACHE.mkdir(parents=True,exist_ok=True)
 if not engine.ROOT.is_dir():parser.error('Data root must be a directory')
 if engine.CACHE.is_relative_to(engine.ROOT):parser.error('Cache must be outside the read-only data root')
 server=ThreadingHTTPServer((args.host,0),Handler,bind_and_activate=False)
 try:server.server_address=(args.host,args.port);server.server_bind()
 except OSError as exc:
  if exc.errno!=errno.EADDRINUSE:raise
  print('Preferred port occupied; using unused port.',flush=True);server.server_address=(args.host,0);server.server_bind()
 server.server_activate();url=f'http://127.0.0.1:{server.server_address[1]}'
 print('Seagrass Tools: '+url,flush=True)
 if not args.no_browser:
  try:
   if not webbrowser.open(url):print('Browser did not open; use URL above.',flush=True)
  except Exception as exc:print('Browser opening failed: '+str(exc),flush=True)
 server.serve_forever()
if __name__=='__main__':main()

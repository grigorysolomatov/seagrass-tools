"""Generate artificial file-format fixtures, NOT measured or anatomical data.

Usage: uv run --frozen python tests/make_synthetic.py /outside/repository/fixtures
The output folder must not already exist; no user input is overwritten.
"""
import argparse,json,struct
from pathlib import Path
import numpy as np
from PIL import Image
import yaml

def generate(root):
 root=Path(root);root.mkdir(parents=True,exist_ok=False)
 w,h=384,256;sw,sh=192,128;y,x=np.mgrid[:h,:w]
 for index in range(3):
  folder=root/f'synthetic-{index+1}';folder.mkdir()
  center=h/2+5*np.sin(x/w*np.pi);leaf=((x-w/2)/(w*.42))**2+((y-center)/(h*.28))**2<1
  ridge=np.exp(-((y-center)/12)**2)
  z=np.where(leaf,.1+index*.15+.1*ridge+.007*np.sin(x*.6)*np.cos(y*.7),-.1).astype('<f4')
  header=b'Binary TrueMap Data File v2.0\r\n\0'+b'SYNTHETIC SOFTWARE FIXTURE\0'+struct.pack('<II4f',w,h,w*.02,h*.02,0,0)
  (folder/'synthetic.tmd').write_bytes(header+z.tobytes())
  rgb=np.zeros((h,w,3),np.uint8);rgb[:]=[35,35,35];rgb[leaf]=[90,145,55];Image.fromarray(rgb).save(folder/'thumbnail.jpg')
  images=[]
  for k in range(6):
   name=f'image{k+1:02}.png';images.append(name)
   value=np.where(leaf,135+15*np.sin(x*.08+k)+8*ridge,40+.01*x+.01*y)
   Image.fromarray(np.clip(value,0,255).astype('uint8')).save(folder/name)
  Image.fromarray(np.full((sh*2,sw*3),65535,np.uint16)).save(folder/'flatfield.png')
  (folder/'calibration.yaml').write_text(yaml.safe_dump({'flatfield':{'modelfile':'flatfield.png','modelsize':f'({sw}, {sh})','size':f'({w}, {h})','scale':[1]*6}}))
  (folder/'scan.yaml').write_text(yaml.safe_dump({'calib':'calibration.yaml','images':images}))
 (root/'SYNTHETIC.json').write_text(json.dumps({'kind':'artificial software test fixture','physical_validation':False,'sources':3}))
 return root
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output');args=parser.parse_args();print(generate(args.output))

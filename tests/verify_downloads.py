"""Verify actual browser CSV downloads and per-source cohorts independently.
Run inside the tested container with its /cache plus browser outputs mounted /evidence.
"""
import argparse,csv,json
from pathlib import Path
import numpy as np
from PIL import Image
from science import decode

def verify(directory,cache):
 root=Path(directory);cache=Path(cache);state=json.loads((root/'state.json').read_text());post=state['post'];slices=state['slice'];stats=[]
 for source in post['stem']['fit']['sources']:
  z,_=decode(Path(source['height_file']));mask=np.asarray(Image.open(cache/'masks'/source['mask_key']/'mask.png'))>0
  values=np.sort(z[mask&np.isfinite(z)].astype(float));q=(len(values)-1)*.8;i=int(q);cut=values[i]+(q-i)*(values[min(i+1,len(values)-1)]-values[i])
  # NumPy quantile preserves float32 interpolation rounding; scalar reference
  # uses float64. Bound that rounding explicitly, then test the saved cutoff.
  assert abs(cut-source['cutoff_mm'])<=np.finfo(z.dtype).eps*max(1,abs(cut))
  selected=mask&np.isfinite(z)&(z>=source['cutoff_mm']);y,x=np.nonzero(selected)
  assert len(x)==source['selected_pixels']
  single=slices['results'][source['path']]
  with np.load(cache/'results'/single['key']/'native.npz') as a:np.testing.assert_array_equal(a['selected_xy'],np.column_stack((x,y)))
  stats.append({'selected':len(x),'valid':len(values),'cutoff_mm':cut})
 combined=np.load(cache/'postmerge'/post['stem']['key']/'native.npz')['selected_xy'];start=0
 for source in post['stem']['fit']['sources']:
  single=slices['results'][source['path']];xy=np.load(cache/'results'/single['key']/'native.npz')['selected_xy'];pose=source['pose'];mm=slices['merged']
  expected=(xy@np.asarray(pose['matrix']).T+pose['shift']-np.asarray(mm['origin_center_mm']))/np.asarray(mm['spacing_mm'])
  np.testing.assert_array_equal(combined[start:start+len(xy)],expected);start+=len(xy)
 assert start==len(combined)
 points=np.load(cache/'postmerge'/post['peaks']['key']/'points.npy');residual=np.load(cache/'postmerge'/post['residual']['key']/'residual.npy',mmap_mode='r');offset=np.array(post['residual']['offset_xy']);radius=post['peaks']['parameters']['window']//2
 ranges=[]
 for x,y in points-offset:
  region=residual[y-radius:y+radius+1,x-radius:x+radius+1]
  assert np.isfinite(region).all();assert residual[y,x]==region.max()
  ranges.append(float(region.max())-float(region.min()))
 for base in ['a','b']:
  plot=json.loads((root/f'plot-{base}.json').read_text());cand=list(csv.DictReader((root/f'trichomes-{base}.csv').open()));borders=list(csv.DictReader((root/f'borders-{base}.csv').open()))
  assert len(cand)==len(points);assert len(borders)==len(plot['borders']['x'])
  for i,row in enumerate(cand):
   assert int(row['id'])==plot['candidates']['id'][i]
   for column,key in [('x_mm','x'),('y_mm','y'),('height_mm','height')]:assert float(row[column])==plot['candidates'][key][i]
   assert float(row['height_mm'])==ranges[i];assert (row['side_ambiguous']=='true')==plot['candidates']['side_ambiguous'][i]
  for i,row in enumerate(borders):
   assert float(row['x_mm'])==plot['borders']['x'][i]
   for column,key in [('left_y_mm','left'),('right_y_mm','right')]:assert (float(row[column]) if row[column] else None)==plot['borders'][key][i]
   assert (row['break_before']=='true')==plot['borders']['break_before'][i]
 return {'status':'passed','cohorts':stats,'total_selected':start,'all_residual_window_ranges':len(ranges),'border_rows_each_base':len(borders),'csv_plot_bases':['a','b']}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('--cache',default='/cache');args=parser.parse_args();print(json.dumps(verify(args.directory,args.cache),indent=2))

import unittest
import numpy as np
from numpy.testing import assert_allclose

class Borders(unittest.TestCase):
 def module(self):
  import importlib.util
  self.assertIsNotNone(importlib.util.find_spec('leaf_borders'),'Leaf borders operation is missing')
  import leaf_borders
  return leaf_borders
 def test_rectangle_and_world_coordinates(self):
  b=self.module();mask=np.zeros((40,100),bool);mask[10:30,5:95]=1
  r=b.compute(mask,[[10,20],[80,0]],[(0,1)],.1,np.array([2,-3]),.05)
  self.assertTrue(r['valid'].all());assert_allclose(r['left_signed_mm'],1.05);assert_allclose(r['right_signed_mm'],-.95)
  assert_allclose(r['arclength_mm'][-1],8);assert_allclose(r['left_world_mm'][:,1],-2.05)
 def test_hole_first_exit_and_gap(self):
  b=self.module();m=np.ones((50,100),bool);m[10:15,:]=0;m[:,45:55]=0
  r=b.compute(m,[[10,25],[80,0]],[(0,1)],.1,np.array([0,0]),.05)
  self.assertTrue((~r['valid']).any());assert_allclose(r['left_signed_mm'][r['valid']],1.05)
  self.assertTrue(np.isnan(b.first_exit(m,[50,25],[0,-1])))
 def test_rotated_strip(self):
  b=self.module();yy,xx=np.mgrid[:150,:150];m=np.abs((yy-xx)/np.sqrt(2))<10
  r=b.compute(m,[[40,40],[60,60]],[(0,1)],.1,np.array([0,0]),.05)
  assert_allclose(r['left_signed_mm'],1,atol=.1);assert_allclose(r['right_signed_mm'],-1,atol=.1)
 def test_curve_arc_and_boundary(self):
  b=self.module();yy,xx=np.mgrid[:150,:150];m=np.abs(yy-(30+.005*xx**2))<10
  c=[[20,32],[80,16],[0,32]]
  r=b.compute(m,c,[(0,1)],.1,np.array([-8,2]),.05)
  t=np.linspace(0,1,100001);independent=np.trapezoid(np.hypot(80,16+64*t),t)*.1
  assert_allclose(r['arclength_mm'][-1],independent,atol=1e-8)
  for side in ['left','right']:
   for center,end in zip(r['stem_world_mm'],r[side+'_world_mm']):
    if not np.isfinite(end).all():continue
    v=end-center;v/=np.linalg.norm(v);end=(end-np.array([-8,2]))/.1
    for delta,expected in [(-1e-5,True),(1e-5,False)]:
     x,y=np.floor(end+v*delta+.5).astype(int);self.assertEqual(bool(m[y,x]),expected)
 def test_reversed_curve_swaps_signed_sides(self):
  b=self.module();m=np.ones((40,100),bool)
  a=b.compute(m,[[10,20],[80,0]],[(0,1)],.1,np.zeros(2),.05)
  z=b.compute(m,[[90,20],[-80,0]],[(0,1)],.1,np.zeros(2),.05)
  assert_allclose(a['left_signed_mm'],-z['right_signed_mm'][::-1]);assert_allclose(a['left_world_mm'],z['right_world_mm'][::-1])
 def test_subsample_domain_gap_not_bridged(self):
  b=self.module();m=np.ones((40,100),bool)
  r=b.compute(m,[[10,20],[80,0]],[(0,.501),(.502,1)],.1,np.zeros(2),.05)
  self.assertTrue(r['break_before'][81])
 def test_subsample_mask_gap_not_bridged(self):
  b=self.module();m=np.ones((40,100),bool);m[:,45]=False
  r=b.compute(m,[[10,20],[80,0]],[(0,1)],.1,np.zeros(2),1)
  self.assertTrue(r['valid'].all());self.assertTrue(r['break_before'][4])
 def test_degenerate_and_domain_gap(self):
  b=self.module();m=np.ones((40,100),bool)
  with self.assertRaisesRegex(ValueError,'Degenerate'):b.compute(m,[[10,20],[0,0]],[(0,1)],.1,np.zeros(2))
  r=b.compute(m,[[10,20],[80,0]],[(0,.4),(.6,1)],.1,np.zeros(2))
  self.assertTrue((~r['valid']).any());self.assertTrue(np.isnan(r['left_signed_mm'][~r['domain_valid']]).all())
if __name__=='__main__':unittest.main()

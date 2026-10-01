"""Independent scalar quantile and common-cohort regression tests."""
import unittest
import numpy as np
from science import foreground_selection,fit_curve
from postmerge import select_source_points

class ForegroundTests(unittest.TestCase):
 def test_scalar_threshold_background_and_transform(self):
  z=np.arange(120,dtype=float).reshape(10,12)
  mask=np.zeros(z.shape,bool);mask[2:8,1:11]=True;z[3,4]=np.nan
  values=sorted(float(z[y,x]) for y in range(10) for x in range(12) if mask[y,x] and np.isfinite(z[y,x]))
  position=(len(values)-1)*.8;lo=int(position);cut=values[lo]+(position-lo)*(values[lo+1]-values[lo])
  expected=np.array([[mask[y,x] and np.isfinite(z[y,x]) and z[y,x]>=cut for x in range(12)] for y in range(10)])
  fit,selected=fit_curve(z,20,2,mask)
  self.assertEqual(fit['cutoff_mm'],cut);np.testing.assert_array_equal(selected,expected)
  changed=z.copy();changed[~mask]=1e9
  other,meta=foreground_selection(changed,mask,20)
  np.testing.assert_array_equal(other,expected);self.assertEqual(meta['cutoff_mm'],cut)
  pose={'matrix':[[0,-.2],[.3,0]],'shift':[4,7]};grid={'origin_center_mm':[1,2],'spacing_mm':[.1,.1]}
  points,combined=select_source_points(changed,mask,pose,grid,20)
  native=[(x,y) for y in range(10) for x in range(12) if expected[y,x]]
  reference=np.array([[(4-.2*y-1)/.1,(7+.3*x-2)/.1] for x,y in native])
  np.testing.assert_allclose(points,reference,rtol=0,atol=1e-13)
  self.assertEqual(combined['cutoff_mm'],fit['cutoff_mm'])
  self.assertEqual(combined['selected_pixels'],fit['selected_pixels'])
  self.assertEqual(combined['valid_pixels'],len(values))
 def test_inclusive_ties_and_invalid(self):
  z=np.ones((3,4));mask=np.ones(z.shape,bool)
  selected,stats=foreground_selection(z,mask,20)
  self.assertEqual(stats['selected_percent'],100);self.assertTrue(selected.all())
  for percent in [0,-1,101,float('nan'),True]:
   with self.assertRaises(ValueError):foreground_selection(z,mask,percent)
  with self.assertRaises(ValueError):foreground_selection(z,mask[:1],20)
  with self.assertRaises(ValueError):foreground_selection(z,np.zeros(z.shape,bool),20)
if __name__=='__main__':unittest.main()

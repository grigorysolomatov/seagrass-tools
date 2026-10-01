import unittest
import numpy as np
import postmerge as pm

class PerSliceTests(unittest.TestCase):
 def test_offsets_masks_and_transforms(self):
  self.assertTrue(hasattr(pm,'select_source_points'),'missing independent per-slice cohort selector')
  z=np.arange(60,dtype=np.float32).reshape(6,10);mask=np.ones(z.shape,bool);mask[5,9]=False;z[0,0]=np.nan
  grid={'origin_center_mm':[-2.,3.], 'spacing_mm':[.5,.5]}
  pose={'matrix':[[0,-.5],[.5,0]],'shift':[4.,5.]}
  a,meta=pm.select_source_points(z,mask,pose,grid,20)
  b,other=pm.select_source_points(z+100,mask,pose,grid,20)
  good=mask&np.isfinite(z);cut=float(np.quantile(z[good],.8));y,x=np.nonzero(good&(z>=cut))
  expected=np.column_stack(((4-.5*y+2)/.5,(5+.5*x-3)/.5))
  np.testing.assert_array_equal(a,expected);np.testing.assert_array_equal(a,b)
  self.assertEqual(meta['cutoff_mm'],cut);self.assertAlmostEqual(other['cutoff_mm']-cut,100,places=4)
  self.assertEqual(meta['selected_pixels'],len(x));self.assertEqual(meta['valid_pixels'],int(good.sum()))
  fit,_,segments=pm.stem_fit(np.ones((40,40)),np.ones((40,40),bool),20,2,points=np.concatenate([a,b]),source_stats=[meta,other])
  self.assertEqual(fit['selected_pixels'],2*len(x));self.assertEqual(len(fit['sources']),2)

if __name__=='__main__':unittest.main()

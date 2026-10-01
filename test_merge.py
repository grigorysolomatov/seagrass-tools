import unittest
import numpy as np
import merge

class MergeTests(unittest.TestCase):
 def test_python_reference_positive_angle_is_ccw(self):
  from science import placement
  g={'ends':[[0,0],[2,0]],'tangents':[[1,0],[1,0]]}
  p=placement(g,[1,1],angle=90)
  np.testing.assert_allclose(p['end'],[0,-2],atol=1e-12)

 def test_max_negative_mask_and_uncovered(self):
  self.assertTrue(hasattr(merge,'merge_arrays'),'real raw-height merge is not implemented')
  a=np.array([[-4,-2],[-3,-8]],np.float32);b=np.array([[-6,-1],[-9,-7]],np.float32)
  mask=np.array([[1,0],[1,1]],bool)
  sources=[(a,np.ones_like(mask),{'matrix':[[1,0],[0,1]],'shift':[0,0]}),(b,mask,{'matrix':[[1,0],[0,1]],'shift':[1,0]})]
  z,meta=merge.merge_arrays(sources,1)
  np.testing.assert_equal(z,np.array([[-4,-2,np.nan],[-3,-8,-7]],np.float32))
  self.assertEqual(meta['origin_center_mm'],[0.,0.]);self.assertEqual(meta['spacing_mm'],[1.,1.])

 def test_rotation_mirror_physical_grid(self):
  z=np.array([[1,2,3],[4,5,6]],np.float32);mask=np.ones(z.shape,bool)
  # 90° counterclockwise on y-down coordinates, spacing 0.25 mm.
  out,meta=merge.merge_arrays([(z,mask,{'matrix':[[0,.25],[-.25,0]],'shift':[1,2]})],.25)
  np.testing.assert_equal(out,[[3,6],[2,5],[1,4]])
  self.assertEqual(meta['origin_center_mm'],[1.,1.5])
  out,_=merge.merge_arrays([(z,mask,{'matrix':[[-.25,0],[0,.25]],'shift':[0,0]})],.25)
  np.testing.assert_equal(out,[[3,2,1],[6,5,4]])

 def test_nonfinite_and_nearest_mask_boundary(self):
  z=np.array([[np.inf,np.nan,-5,-2]],np.float32)
  out,_=merge.merge_arrays([(z,np.array([[1,1,1,0]],bool),{'matrix':[[1,0],[0,1]],'shift':[.2,0]})],1)
  np.testing.assert_equal(out,[[np.nan,np.nan,-5,np.nan,np.nan]])

 def test_preview_global_stretch_and_alpha(self):
  im,limits,n=merge.preview(np.array([[-10,0,10,np.nan]],np.float32))
  self.assertEqual(limits,[-10.,10.]);self.assertEqual(n,3)
  np.testing.assert_equal(np.asarray(im)[0,:,0],[0,127,255,0])
  np.testing.assert_equal(np.asarray(im)[0,:,3],[255,255,255,0])

 def test_reject_dangerous_geometry(self):
  for pose in [{'matrix':[[1,0],[0,0]],'shift':[0,0]}, {'matrix':[[1,0],[0,1]],'shift':[float('nan'),0]}]:
   with self.assertRaises(ValueError):merge.grid_for([((2,2),pose)],1)
  with self.assertRaises(ValueError):merge.grid_for([((10000,10000),{'matrix':[[1,0],[0,1]],'shift':[0,0]})],1)
  with self.assertRaises(ValueError):merge.merge_arrays([(np.ones((2,2)),np.ones((1,2),bool),{'matrix':[[1,0],[0,1]],'shift':[0,0]})],1)

if __name__=='__main__':unittest.main()

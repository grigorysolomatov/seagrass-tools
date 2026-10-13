import unittest
import numpy as np
import outline
import leaf_borders
import area
import merge


def disk(shape,c,r):
 yy,xx=np.mgrid[:shape[0],:shape[1]];return (xx-c[0])**2+(yy-c[1])**2<=r*r


class OutlineRegion(unittest.TestCase):
 def test_unedited_outline_reproduces_mask_exactly(self):
  rng=np.random.default_rng(3)
  for _ in range(5):
   m=disk((120,160),(80,60),45);m[rng.integers(0,120,300),rng.integers(0,160,300)]^=True  # ragged edge, holes, specks
   rings=outline.trace(m)
   np.testing.assert_array_equal(outline.region(m,rings,rings),m)

 def test_two_separate_pieces_and_holes_preserved(self):
  m=np.zeros((60,100),bool);m[10:50,5:45]=1;m[10:50,55:95]=1;m[25:30,20:25]=0
  rings=outline.trace(m);self.assertEqual(len(rings),2)
  np.testing.assert_array_equal(outline.region(m,rings,rings),m)

 def test_edit_cuts_and_fills(self):
  m=np.zeros((80,80),bool);m[10:70,10:70]=1;m[10:30,38:42]=0  # seam notch from the top edge
  rings=outline.trace(m)
  filled=[np.array([[10,10],[69,10],[69,69],[10,69]],float)]
  reg=outline.region(m,rings,filled)
  self.assertTrue(reg[10:30,38:42].all())  # notch added (no height data there)
  self.assertEqual(int((reg&~m).sum()),20*4)
  cut=[np.array([[10,10],[39.2,10],[39.2,69],[10,69]],float)]
  reg=outline.region(m,rings,cut);self.assertFalse(reg[:,40:].any());self.assertTrue(reg[20:60,12:38].all())

 def test_overlapping_edited_rings_union_not_xor(self):
  a=np.array([[0,0],[20,0],[20,20],[0,20]],float);b=a+10
  reg=outline.inside([a,b],(40,40));self.assertTrue(reg[15,15]);self.assertEqual(int(reg.sum()),21*21*2-11*11)

 def test_borders_follow_edited_region(self):
  m=np.zeros((40,100),bool);m[10:30,5:95]=1;m[10:14,40:60]=0  # dent on the upper side
  z=np.where(m,0.,np.nan)
  orig=leaf_borders.border_support(m,z)
  full=outline.region(m,outline.trace(m),[np.array([[5,10],[94,10],[94,29],[5,29]],float)])
  sup=leaf_borders.border_support(m,z,region=full)
  r0=leaf_borders.compute(orig,[[10,20],[80,0]],[(0,1)],.1,np.zeros(2),.05)
  r1=leaf_borders.compute(sup,[[10,20],[80,0]],[(0,1)],.1,np.zeros(2),.05)
  mid=np.argmin(np.abs(r0['arclength_mm']-4.0))  # x=50, inside the dent
  self.assertAlmostEqual(r1['left_signed_mm'][mid]-r0['left_signed_mm'][mid],.4,places=6)
  # raw-height cutoff removes measured low cells but not added cells without height
  z2=z.copy();z2[20:30,5:95]=-1
  cut=leaf_borders.border_support(m,z2,True,0.,full);self.assertFalse(cut[25,50]);self.assertTrue(cut[12,50])
  np.testing.assert_array_equal(leaf_borders.border_support(m,z2,True,0.),m&(np.nan_to_num(z2,nan=-9)>=0))

 def test_area_uses_region_and_counts_added_cells_flat(self):
  sp=[.01,.01];z=np.zeros((20,30),np.float32);z[:,15:]=np.arange(15)[None,:]*.01  # 45° ramp on right half
  mask=np.ones(z.shape,bool);pose={'matrix':[[.01,0],[0,.01]],'shift':[0,0]}
  out,meta=merge.merge_arrays([(z,mask,pose)],.01)
  flat,surface,cells=area.merged_area(out,meta,[(z,mask,pose,sp)])
  left=np.zeros(out.shape,bool);left[:,:15]=True
  f2,s2,c2=area.merged_area(out,meta,[(z,mask,pose,sp)],left)
  self.assertEqual(c2,300);self.assertAlmostEqual(f2,.03,places=10);self.assertAlmostEqual(s2,f2,places=8)
  self.assertGreater(surface,flat)
  big=np.zeros((out.shape[0]+0,out.shape[1]),bool);big[:]=True;out2=out.copy();out2[:,0]=np.nan  # one column without height
  f3,s3,c3=area.merged_area(out2,meta,[(z,mask,pose,sp)],big)
  self.assertEqual(c3,600)


if __name__=='__main__':unittest.main()

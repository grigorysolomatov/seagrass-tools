import math
import unittest
import numpy as np
import area
import merge


def plane(shape,spacing,sx=0.,sy=0.):
 h,w=shape;yy,xx=np.mgrid[:h,:w]
 return (sx*xx*spacing[0]+sy*yy*spacing[1]).astype(np.float32)


class AreaMath(unittest.TestCase):
 def test_flat_plane_3d_equals_2d(self):
  sp=[.01,.02];z=np.full((30,40),-.3,np.float32);mask=np.ones(z.shape,bool)
  flat,surface=area.native_area(z,mask,sp)
  self.assertAlmostEqual(flat,30*40*.01*.02,places=12);self.assertAlmostEqual(surface,flat,places=12)

 def test_tilted_plane_is_flat_over_cos_theta(self):
  sp=[.005,.005]
  for theta in [10,30,45,60]:
   slope=math.tan(math.radians(theta))
   for sx,sy in [(slope,0),(0,slope),(slope/math.sqrt(2),-slope/math.sqrt(2))]:
    z=plane((50,60),sp,sx,sy);mask=np.ones(z.shape,bool)
    flat,surface=area.native_area(z,mask,sp)
    self.assertAlmostEqual(surface/flat,1/math.cos(math.radians(theta)),places=4)

 def test_mask_edge_wall_and_background_are_excluded(self):
  # A raised 1 mm plateau on deep background: the 1 mm cliff is not leaf surface.
  sp=[.01,.01];z=np.full((40,40),-5,np.float32);mask=np.zeros(z.shape,bool)
  z[10:30,10:30]=1;mask[10:30,10:30]=True
  flat,surface=area.native_area(z,mask,sp)
  self.assertAlmostEqual(flat,400*1e-4,places=12);self.assertAlmostEqual(surface,flat,places=12)

 def test_independent_bump_area(self):
  # Hemisphere-like cap z=sqrt(R²-r²) over r<a: analytic cap area 2πR(R-sqrt(R²-a²)).
  R,a,n=1.,.8,801;sp=[2*1.0/(n-1)]*2;c=np.linspace(-1,1,n);xx,yy=np.meshgrid(c,c)
  r2=xx*xx+yy*yy;mask=r2<a*a;z=np.where(mask,np.sqrt(np.clip(R*R-r2,0,None)),0).astype(np.float32)
  flat,surface=area.native_area(z,mask,sp)
  self.assertAlmostEqual(flat,math.pi*a*a,delta=.01)
  self.assertAlmostEqual(surface,2*math.pi*R*(R-math.sqrt(R*R-a*a)),delta=.02)

 def test_isolated_pixel_counts_flat(self):
  z=np.zeros((5,5),np.float32);z[2,2]=9;mask=np.zeros(z.shape,bool);mask[2,2]=True
  self.assertEqual(area.native_area(z,mask,[1,1]),(1.,1.))


class MergedArea(unittest.TestCase):
 def test_merged_area_matches_native_and_counts_overlap_once(self):
  sp=[.01,.01];slope=math.tan(math.radians(30))
  z=plane((20,30),sp,slope,0);mask=np.ones(z.shape,bool)
  pose={'matrix':[[.01,0],[0,.01]],'shift':[0,0]}
  out,meta=merge.merge_arrays([(z,mask,pose)],.01)
  flat,surface,cells=area.merged_area(out,meta,[(z,mask,pose,sp)])
  nflat,nsurface=area.native_area(z,mask,sp)
  self.assertEqual(cells,600);self.assertAlmostEqual(flat,nflat,places=10);self.assertAlmostEqual(surface,nsurface,places=8)
  # Same source twice at the same pose: identical heights, area unchanged.
  out2,meta2=merge.merge_arrays([(z,mask,pose),(z,mask,pose)],.01)
  self.assertAlmostEqual(area.merged_area(out2,meta2,[(z,mask,pose,sp),(z,mask,pose,sp)])[1],nsurface,places=8)

 def test_rotated_source_keeps_physical_area(self):
  sp=[.01,.01];z=plane((40,60),sp,.5,.2);mask=np.ones(z.shape,bool)
  c,s=math.cos(.7),math.sin(.7);pose={'matrix':[[c*.01,-s*.01],[s*.01,c*.01]],'shift':[1,2]}
  out,meta=merge.merge_arrays([(z,mask,pose)],.01)
  flat,surface,_=area.merged_area(out,meta,[(z,mask,pose,sp)])
  self.assertAlmostEqual(flat,40*60*1e-4,delta=.03*40*60*1e-4)  # nearest resampling, few % cells
  self.assertAlmostEqual(surface/flat,math.sqrt(1+.25+.04),places=4)

 def test_csv_density_rows(self):
  meta=dict(flat_mm2=2.,surface_mm2=4.,ratio=2.,cell_mm=.01,slices=[dict(path='/x/scanA',flat_mm2=2.,surface_mm2=4.)],calibration=[dict(pixel_mm=[.01,.01])])
  text=area.csv_text(meta,10)
  self.assertIn('candidates_per_flat_area,merged,5,1/mm2',text);self.assertIn('candidates_per_3d_area,merged,2.5,1/mm2',text)
  self.assertIn('slice_3d_area,1 scanA,4,mm2',text);self.assertNotIn('candidates',area.csv_text(meta))


if __name__=='__main__':unittest.main()

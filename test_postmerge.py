import unittest
import numpy as np
import postmerge as pm

class MedianTests(unittest.TestCase):
 def test_quantized_full_support(self):
  z=np.array([[-3,-2,-1,0,1],[-2,-1,0,1,2],[-1,0,8,2,3],[0,1,2,3,4],[1,2,3,4,5]],np.float32)
  med,res,meta=pm.median_residual(z,np.ones(z.shape,bool),3,4)
  q=np.clip((z-z.min())/(z.max()-z.min())*15,0,15).astype(np.uint16)
  for y in range(1,4):
   for x in range(1,4):
    expected=np.float32(np.median(q[y-1:y+2,x-1:x+2]))/15*float(z.max()-z.min())+float(z.min())
    self.assertAlmostEqual(float(med[y,x]),float(expected),places=6)
    self.assertEqual(res[y,x],float(z[y,x])-float(med[y,x]))
  self.assertTrue(np.isnan(med[0]).all())
  self.assertEqual(meta['levels'],15)

class PeakTests(unittest.TestCase):
 def test_plateau_negative_constant_and_support(self):
  z=np.full((11,13),-4.,np.float64);z[4:6,5:7]=-2
  np.testing.assert_array_equal(pm.peak_candidates(z,3),[[5,4]])
  self.assertEqual(len(pm.peak_candidates(np.ones((9,9)),3)),0)
  self.assertEqual(len(pm.peak_candidates(z,1)),0)
  z[3,5]=np.nan
  points=pm.peak_candidates(z,3)
  np.testing.assert_array_equal(points,[[5,5]])
 def test_distant_ties_and_higher_window(self):
  z=np.zeros((13,13));z[4,4]=2;z[4,8]=2;z[8,6]=3
  self.assertEqual(len(pm.peak_candidates(z,3)),3)
  np.testing.assert_array_equal(pm.peak_candidates(z,9),[[6,8]])

class StemTests(unittest.TestCase):
 def test_finite_foreground_population_and_gaps(self):
  z=np.full((15,41),np.nan,np.float32);z[5:10,:]=1;z[7,:]=3;z[:,20]=np.nan
  fit,selected,segments=pm.stem_fit(z,np.isfinite(z),10,3)
  self.assertEqual(fit['cutoff_mm'],3)
  self.assertEqual(fit['selected_pixels'],40)
  self.assertGreaterEqual(len(segments),2)
  for seg in segments:
   xy=np.array(seg['xy']);self.assertTrue(np.isfinite(z[np.rint(xy[:,1]).astype(int),np.rint(xy[:,0]).astype(int)]).all())

class RequestTests(unittest.TestCase):
 def test_unregistered_merge_rejected(self):
  with self.assertRaisesRegex(ValueError,'Current registered merge'):
   pm.request('stem',{'merge_key':'../unsafe','top':5,'degree':3})
 def test_parameter_rejections(self):
  for v in [0,2,302,True,3.5]:
   with self.assertRaises(ValueError):pm.odd(v)
  for bits in [0,17,True,1.5]:
   with self.assertRaises(ValueError):pm.median_residual(np.ones((3,3)),np.ones((3,3),bool),1,bits)
 def test_nan_and_constant_median(self):
  z=np.full((9,9),-2,np.float32);z[4,4]=np.nan
  m,r,_=pm.median_residual(z,np.isfinite(z),3,12)
  self.assertTrue(np.isnan(m[3:6,3:6]).all())
  self.assertTrue(np.all(r[np.isfinite(r)]==0))
  m,r,_=pm.median_residual(np.array([[.123,.987]],np.float32),np.ones((1,2),bool),1,4)
  self.assertTrue(np.isfinite(m).all())

class ReferenceTests(unittest.TestCase):
 def test_random_peaks_independent_flood_reference(self):
  from collections import deque
  rng=np.random.default_rng(42)
  for window in [3,5,7]:
   for trial in range(5):
    z=rng.integers(-3,4,(15,17)).astype(float);z[rng.random(z.shape)<.06]=np.nan
    seen=set();expected=[];radius=window//2
    for row in range(z.shape[0]):
     for col in range(z.shape[1]):
      if (row,col) in seen or not np.isfinite(z[row,col]):continue
      plateau=[];queue=deque([(row,col)]);seen.add((row,col));lower=False;higher=False
      while queue:
       y,x=queue.popleft();plateau.append((y,x))
       for dy in [-1,0,1]:
        for dx in [-1,0,1]:
         yy,xx=y+dy,x+dx
         if 0<=yy<z.shape[0] and 0<=xx<z.shape[1] and np.isfinite(z[yy,xx]):
          lower|=z[yy,xx]<z[y,x];higher|=z[yy,xx]>z[y,x]
          if z[yy,xx]==z[y,x] and (yy,xx) not in seen:seen.add((yy,xx));queue.append((yy,xx))
      if higher or not lower:continue
      candidates=[]
      for y,x in plateau:
       if min(y,x)<radius or y+radius>=z.shape[0] or x+radius>=z.shape[1]:continue
       values=z[y-radius:y+radius+1,x-radius:x+radius+1]
       if np.isfinite(values).all() and z[y,x]==values.max():candidates.append((y,x))
      if candidates:
       cy,cx=np.mean(plateau,axis=0);y,x=min(candidates,key=lambda q:((q[0]-cy)**2+(q[1]-cx)**2,q[0],q[1]));expected.append((x,y))
    self.assertEqual(sorted(map(tuple,pm.peak_candidates(z,window))),sorted(expected))
 def test_tiled_median_matches_independent_numpy(self):
  rng=np.random.default_rng(8);z=rng.normal(-2,.7,(520,21)).astype(np.float32);valid=np.ones(z.shape,bool);valid[255,10]=False;z[valid==False]=np.nan
  for window in [1,3,7]:
   m,res,meta=pm.median_residual(z,valid,window,8);radius=window//2;low,high=meta['range_mm']
   q=np.zeros(z.shape,np.uint16);q[valid]=np.clip((z[valid]-low)/(high-low)*255,0,255).astype(np.uint16)
   for y in [0,3,250,254,255,256,257,260,511,515,519]:
    for x in [0,4,9,10,11,16,20]:
     if min(y,x)<radius or y+radius>=len(z) or x+radius>=z.shape[1] or not valid[max(0,y-radius):y+radius+1,max(0,x-radius):x+radius+1].all():self.assertTrue(np.isnan(m[y,x]));continue
     expect=np.float32(np.median(q[y-radius:y+radius+1,x-radius:x+radius+1]))/255*(high-low)+low
     self.assertEqual(m[y,x],expect)
     self.assertEqual(res[y,x],float(z[y,x])-float(m[y,x]))

if __name__=='__main__': unittest.main()

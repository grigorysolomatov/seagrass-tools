"""Hand-drawn slice stems: validation, equal-arclength sampling and cohort replacement."""
import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import hand_stem as hs
import postmerge as pm

class SampleTests(unittest.TestCase):
 def test_equal_arclength_on_L(self):
  # L of total length 4 (3 along x, 1 down): 5 samples every 1 px, ends exact.
  xy=hs.samples([[0,0],[3,0],[3,1]],5)
  np.testing.assert_allclose(xy,[[0,0],[1,0],[2,0],[3,0],[3,1]])
 def test_counts_and_ends(self):
  pts=[[1.5,2],[7,9.25],[2,20]]
  for n in [2,3,17,1000]:
   xy=hs.samples(pts,n);self.assertEqual(len(xy),n)
   np.testing.assert_allclose(xy[[0,-1]],[pts[0],pts[-1]])
 def test_validation(self):
  for bad in [[[0,0]],'x',[[0,0],[0,0]],[[0,0],[1,True]],[[0,0],[1,float('nan')]],[[0,0],[100,0]],[[0,0],[1]]]:
   with self.assertRaises(ValueError):hs.validate(bad,(10,20))
  self.assertEqual(hs.validate([[0,0],[19.5,9.5]],(10,20)),[[0.,0.],[19.5,9.5]])
  with self.assertRaises(ValueError):hs.validate([[0,0]]*(hs.MAX_POINTS+1),(10,20))
 def test_request_lines_scoped_to_merge(self):
  sources=[{'path':'/a','shape':[10,20]},{'path':'/b','shape':[10,20]}]
  self.assertEqual(hs.request_lines(None,sources),{})
  self.assertEqual(list(hs.request_lines({'/b':[[0,0],[5,5]]},sources)),['/b'])
  with self.assertRaisesRegex(ValueError,'outside this merge'):hs.request_lines({'/c':[[0,0],[5,5]]},sources)

class CohortTests(unittest.TestCase):
 def test_hand_replaces_one_slice_cohort_with_same_count(self):
  from tests.make_synthetic import generate
  import engine,merge
  with tempfile.TemporaryDirectory() as temp:
   temp=Path(temp);root=generate(temp/'scans').resolve();cache=temp/'cache'
   paths=sorted(str(p) for p in root.iterdir() if p.is_dir())[:2]
   with patch.object(engine,'ROOT',root),patch.object(engine,'CACHE',cache):
    bg=engine.validate_background({'enabled':True})
    slices=[]
    for i,p in enumerate(paths):
     m=engine.prepare_mask(p,bg);slices.append(dict(path=p,mask_key=m['key'],pose={'matrix':[[.02,0],[0,.02]],'shift':[i*8.,0]}))
    mm=merge.merge_request({'background':bg,'slices':slices})
    auto,auto_stats=pm.source_cohort(mm,20)
    line=[[40,128],[200,120],[340,135]]
    hand,hand_stats=pm.source_cohort(mm,20,hand={paths[1]:line})
    n0=auto_stats[0]['selected_pixels'];n1=auto_stats[1]['selected_pixels']
    self.assertEqual(len(hand),len(auto))
    np.testing.assert_array_equal(hand[:n0],auto[:n0])  # untouched slice identical
    expected=pm.to_grid(hs.samples(line,n1),slices[1]['pose'],mm)
    np.testing.assert_allclose(hand[n0:],expected)
    # Independent check of the grid transform for one point: world=A p + t, grid=(world-origin)/spacing.
    world=np.array([.02*200+8,.02*120]);np.testing.assert_allclose(pm.to_grid([[200,120]],slices[1]['pose'],mm)[0],(world-mm['origin_center_mm'])/mm['spacing_mm'])
    self.assertTrue(hand_stats[1]['hand']) ;self.assertNotIn('hand',hand_stats[0])
    # Full request: the hand line changes the stem key and is recorded in parameters.
    a=pm.request('stem',{'merge_key':mm['key'],'top':20,'degree':3})
    b=pm.request('stem',{'merge_key':mm['key'],'top':20,'degree':3,'hand':{paths[1]:line}})
    self.assertNotEqual(a['key'],b['key']);self.assertEqual(b['parameters']['hand'],{paths[1]:[[float(v) for v in p] for p in line]})
    self.assertTrue(b['fit']['sources'][1]['hand'])
    c=pm.request('stem',{'merge_key':mm['key'],'top':20,'degree':3,'hand':{paths[1]:line}})
    self.assertEqual(c['key'],b['key']);self.assertTrue(c['cache_hit'])

if __name__=='__main__':unittest.main()

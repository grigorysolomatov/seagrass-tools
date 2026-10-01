import unittest
import numpy as np
import csv,io
class BorderControls(unittest.TestCase):
 def test_raw_cutoff_and_margin(self):
  import leaf_borders as b
  mask=np.ones((21,41),bool);z=np.tile((1-np.abs(np.arange(21)-10)/10)[...,None],(1,41))-.5
  c=[[2,10],[36,0]];iv=[[0,1]]
  baseline=b.compute(mask,c,iv,.1,np.zeros(2),.1)
  off=b.compute(mask,c,iv,.1,np.zeros(2),.1,inward_margin_mm=0)
  np.testing.assert_equal(baseline['left_signed_mm'],off['left_signed_mm'])
  narrow=b.compute(b.border_support(mask,z,True,0),c,iv,.1,np.zeros(2),.1,inward_margin_mm=.1)
  self.assertTrue(np.all(narrow['left_signed_mm']<baseline['left_signed_mm']))
  np.testing.assert_allclose(narrow['left_signed_mm'],.45)
  empty=b.compute(b.border_support(mask,z,True,.6),c,iv,.1,np.zeros(2),.1)
  self.assertFalse(empty['valid'].any())
  lost=b.compute(mask,c,iv,.1,np.zeros(2),.1,inward_margin_mm=2)
  self.assertFalse(lost['valid'].any())
  np.testing.assert_equal(b.border_support(mask,z,False,100),mask)
 def test_margin_collapsed_substep_gap_breaks_stroke(self):
  import leaf_borders as b
  mask=np.ones((21,41),bool);mask[:10,6:8]=False;mask[11:,6:8]=False
  result=b.compute(mask,[[2,10],[36,0]],[[0,1]],.1,np.zeros(2),1,inward_margin_mm=.1)
  self.assertTrue(result['valid'][0] and result['valid'][1])
  self.assertTrue(result['break_before'][1])
 def test_simple_csv_preserves_gaps(self):
  from csv_exports import border_csv,candidate_csv
  m=dict(arclength_mm=[0,.1,.2],left_signed_mm=[1,1,None],right_signed_mm=[-1,-1,None],break_before=[True,True,True],length_mm=.2)
  rows=list(csv.reader(io.StringIO(border_csv(m,'a',quality=False))))
  self.assertEqual(rows[0],['x_mm','left_y_mm','right_y_mm']);self.assertEqual(rows[2],['','',''])
  self.assertEqual(rows[-1][1:],['',''])
  text=candidate_csv([1],[.1],[.2],[.3],[True],quality=False)
  self.assertEqual(text.splitlines()[0],'id,x_mm,y_mm,height_mm')
if __name__=='__main__':unittest.main()

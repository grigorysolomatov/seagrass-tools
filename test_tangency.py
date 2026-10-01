"""Keep the Python placement reference consistent with explicit UI Align."""
import unittest
import numpy as np
from science import placement


class TangencyTests(unittest.TestCase):
 def test_prior_angles_mirrors_reversal(self):
  geometry={'ends':[[3,8],[90,24]],'tangents':[[1,.2],[1,-.3]]}
  max_cross=max_gap=0.
  for bits in range(64):
   prev=None
   for i,angle in enumerate([23,-41,72]):
    reverse=bool(bits & (1<<i))
    pose=placement(geometry,[.12,.07],angle=angle,
     mirror_h=bool(bits & (1<<(2*i))),mirror_v=bool(bits & (1<<(2*i+1))),
     reverse=reverse,previous=prev)
    if prev is not None:
     incoming=np.array(pose['matrix'])@np.array(geometry['tangents'][int(reverse)])*(-1 if reverse else 1)
     incoming/=np.linalg.norm(incoming)
     outgoing=np.array(prev['direction']);outgoing/=np.linalg.norm(outgoing)
     cross=abs(outgoing[0]*incoming[1]-outgoing[1]*incoming[0])
     gap=np.linalg.norm(np.array(prev['end'])-pose['start'])
     self.assertLess(cross,1e-12);self.assertAlmostEqual(float(outgoing@incoming),1,places=12)
     self.assertLess(gap,1e-10);max_cross=max(max_cross,cross);max_gap=max(max_gap,gap)
    prev=pose
  print({'cases':64,'max_cross':float(max_cross),'max_gap_mm':float(max_gap)})

if __name__=='__main__':unittest.main()

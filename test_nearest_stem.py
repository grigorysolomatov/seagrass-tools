import unittest
import numpy as np
from scipy.optimize import minimize_scalar
from nearest_stem import nearest_points, curve_domain

class NearestTests(unittest.TestCase):
 def test_projection_not_saved_sample(self):
  r=nearest_points([[0,0],[1,0]],[(-2,2)],[[.371,1],[4,1]])
  np.testing.assert_allclose(r['targets_a'],[[.371,0],[2,0]],atol=1e-12)
  np.testing.assert_allclose(r['targets_a'],r['targets_b'],atol=1e-12)
 def test_base_reverses_only_equidistant(self):
  r=nearest_points([[0,0],[1,0],[0,1]],[(-2,2)],[[0,1],[.4,1]])
  np.testing.assert_allclose(r['targets_a'][0],[-np.sqrt(.5),.5],atol=1e-10)
  np.testing.assert_allclose(r['targets_b'][0],[np.sqrt(.5),.5],atol=1e-10)
  np.testing.assert_allclose(r['targets_a'][1],r['targets_b'][1],atol=1e-12)
 def test_gap_is_not_a_target(self):
  r=nearest_points([[0,0],[1,0]],[(-3,-1),(1,3)],[[0,.3]])
  np.testing.assert_allclose(r['targets_a'],[[-1,0]],atol=1e-12)
  np.testing.assert_allclose(r['targets_b'],[[1,0]],atol=1e-12)
 def test_degenerate_stationary(self):
  r=nearest_points([[0,0],[1,0],[0,1]],[(-2,2)],[[0,.5]])
  np.testing.assert_allclose(r['targets_a'],[[0,0]],atol=1e-9)
 def test_degrees_one_to_eight_against_independent_minimizer(self):
  rng=np.random.default_rng(13)
  for degree in range(1,9):
   c=rng.normal(size=(degree+1,2));c[:,0]=0;c[1,0]=1
   intervals=[(-1.7,-.5),(-.3,1.3)]
   points=rng.normal(size=(20,2))*2
   result=nearest_points(c,intervals,points)
   for p,a in zip(points,result['targets_a']):
    def f(t):
     q=np.polynomial.polynomial.polyval(t,c).T
     return np.sum((q-p)**2)
    ds=[]
    for lo,hi in intervals:
     grid=np.linspace(lo,hi,3001);values=np.array([f(t) for t in grid]);ds.extend([values[0],values[-1]])
     for j in np.flatnonzero((values[1:-1]<=values[:-2])&(values[1:-1]<=values[2:]))+1:
      ds.append(minimize_scalar(f,bounds=(grid[j-1],grid[j+1]),method='bounded',options={'xatol':1e-13}).fun)
    self.assertAlmostEqual(float(np.sum((np.array(a)-p)**2)),min(ds),places=8)
 def test_domain_from_pca_projection(self):
  fit={'center':[3,4],'axis':[1,0],'mid':2,'half':10}
  xy=np.array([[0,1],[5,2],[8,3],[15,4]])
  self.assertEqual(curve_domain(fit,xy,[2,2]),[(-.5,0.),(.3,1.)])

if __name__=='__main__':unittest.main()

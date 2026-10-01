import unittest
import numpy as np
from numpy.polynomial import Polynomial as P

class CurveEditing(unittest.TestCase):
 def test_exact_conversion_all_degrees(self):
  import curve_edit as e
  rng=np.random.default_rng(820)
  worst=0
  for degree in range(1,9):
   c=rng.normal(size=(degree+1,2));domain=[-.7,1.4]
   handles=e.to_bezier(c,domain); back=e.from_bezier(handles)
   u=np.linspace(0,1,101); t=domain[0]+u*(domain[1]-domain[0])
   for k in range(2):
    error=np.max(np.abs(P(c[:,k])(t)-P(back[:,k])(u)));worst=max(worst,error)
    np.testing.assert_allclose(P(c[:,k])(t),P(back[:,k])(u),atol=2e-10)
    np.testing.assert_allclose(P(c[:,k]).deriv()(t)*(domain[1]-domain[0]),P(back[:,k]).deriv()(u),atol=2e-9)
  print('Bezier degree 1–8 maximum position error',worst)
 def test_exact_endpoints_clipping_and_singular_rejection(self):
  import curve_edit as e
  mask=np.ones((40,50),bool);h=[[2.,10],[14,12],[32,15],[47,20]]
  fit,geometry,xy,lengths=e.edited_geometry(h,mask)
  np.testing.assert_allclose(geometry['ends'],[h[0],h[-1]],atol=1e-10)
  np.testing.assert_allclose(geometry['tangents'],[3*(np.array(h[1])-h[0]),3*(np.array(h[-1])-h[-2])],atol=1e-10)
  mask[:,22:26]=False
  fit,g,xy,lengths=e.edited_geometry(h,mask)
  self.assertEqual(len(fit['intervals']),2)
  h[0]=[-10,10];fit,g,xy,lengths=e.edited_geometry(h,mask)
  self.assertTrue(fit['clipped']);self.assertEqual(fit['handles'][0],h[0]);self.assertGreater(g['ends'][0][0],-.5)
  with self.assertRaises(ValueError):e.edited_geometry([[1,1]]*4,mask)
 def test_degree_eight_general_curve_nearest_independent_brackets(self):
  import curve_edit as e
  from nearest_stem import nearest_points
  from scipy.optimize import minimize_scalar
  rng=np.random.default_rng(604);handles=np.column_stack((np.arange(9)*4+rng.normal(0,12,9),rng.normal(15,10,9)))
  c=e.from_bezier(handles);x,y=P(c[:,0]),P(c[:,1]);points=rng.uniform([0,0],[35,30],(60,2));iv=[[0,.35],[.42,1]]
  result=nearest_points(c,iv,points);worst=0
  for point,target,t in zip(points,result['targets_a'],result['parameters_a']):
   distances=[]
   f=lambda u:(x(u)-point[0])**2+(y(u)-point[1])**2
   for a,b in iv:
    grid=np.linspace(a,b,4001);values=f(grid);distances.extend([f(a),f(b)])
    for j in np.flatnonzero((values[1:-1]<=values[:-2])&(values[1:-1]<=values[2:]))+1:
     distances.append(minimize_scalar(f,bounds=(grid[j-1],grid[j+1]),method='bounded',options={'xatol':1e-14}).fun)
   err=abs(np.linalg.norm(np.asarray(target)-point)-np.sqrt(min(distances)));worst=max(worst,err)
   self.assertLess(err,1e-7);np.testing.assert_allclose(target,[x(t),y(t)],atol=1e-8)
  print('General degree8 nearest max pixel error',worst)
 def test_general_curve_export_uses_nearest_parameter(self):
  import curve_edit as e
  from nearest_stem import nearest_points
  from csv_exports import stem_coordinates
  handles=[[2,4],[25,1],[-8,15],[29,21]]
  c=e.from_bezier(handles);fit={'coefficients':c.tolist(),'intervals':[[0,1]],'manual':True}
  points=np.array([[8,8],[12,12],[20,17]])
  n=nearest_points(c,[[0,1]],points)
  self.assertEqual(len(n['parameters_a']),len(points))
  a=stem_coordinates(fit,[[0,1]],points,.1,'a',n['targets_a'],n['parameters_a'])
  b=stem_coordinates(fit,[[0,1]],points,.1,'b',n['targets_b'],n['parameters_b'])
  np.testing.assert_allclose(a[1],-b[1],atol=1e-10)
  self.assertTrue(np.isfinite(a[0]).all())
if __name__=='__main__':unittest.main()

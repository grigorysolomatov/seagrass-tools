import importlib.util
import unittest
import numpy as np

class ExportTests(unittest.TestCase):
    def test_residual_window_range(self):
        self.assertIsNotNone(importlib.util.find_spec('csv_exports'), 'CSV exports not implemented')
        from csv_exports import window_ranges
        residual = np.array([[-9.,-3.,-4.],[-2.,2.,-8.],[-5.,-6.,-7.]])
        np.testing.assert_equal(window_ranges(residual,np.array([[11,21]]),[10,20],3),[11.])
        with self.assertRaises(ValueError): window_ranges(residual,np.array([[10,20]]),[10,20],3)
        residual[0,0]=np.nan
        with self.assertRaises(ValueError): window_ranges(residual,np.array([[11,21]]),[10,20],3)

    def test_coordinates_and_endpoint_side(self):
        import csv_exports as ex
        self.assertTrue(hasattr(ex, 'stem_coordinates'), 'stem coordinates missing')
        # x=t in grid pixels, increasing rightwards; left is negative screen y.
        fit=dict(coefficients=[[0,0],[1,0]],center=[0,0],axis=[1,0],mid=0,half=1)
        points=np.array([[2,-3],[2,3],[-2,0],[12,0]])
        a=ex.stem_coordinates(fit,[(0,10)],points,0.5,'a')
        b=ex.stem_coordinates(fit,[(0,10)],points,0.5,'b')
        np.testing.assert_allclose(a[0],[1,1,0,5]);np.testing.assert_allclose(a[1],[1.5,-1.5,1,1])
        np.testing.assert_allclose(b[0],5-a[0]);np.testing.assert_allclose(b[1],-a[1])
        np.testing.assert_equal(a[2],[False,False,True,True])

    def test_csv_missing_reverse_empty_names(self):
        import csv_exports as ex
        self.assertTrue(hasattr(ex,'border_csv'),'border CSV missing')
        meta=dict(arclength_mm=[0.,1.,2.],length_mm=2.,left_signed_mm=[2.,None,4.],right_signed_mm=[-3.,None,-5.],break_before=[True,True,True])
        import csv,io
        a=list(csv.DictReader(io.StringIO(ex.border_csv(meta,'b'))))
        self.assertEqual(a[0]['left_y_mm'],'5');self.assertEqual(a[0]['right_y_mm'],'-4')
        self.assertEqual(a[1]['left_y_mm'],'');self.assertEqual(a[1]['valid'],'false')
        self.assertEqual(a[0]['x_mm'],'0');self.assertEqual(a[-1]['x_mm'],'2')
        self.assertEqual(ex.candidate_csv([],[],[],[],[]),'id,x_mm,y_mm,height_mm,side_ambiguous\r\n')
        self.assertEqual(ex.filename('  Leaf A.CSV  '),'Leaf A.csv')
        self.assertEqual(ex.filename('leaf'),'leaf.csv')
        for name in ['','../x','a/b','a\\\\b','x\n.csv','CON','a.csv.csv','=cmd','a:bad']:
            with self.assertRaises(ValueError,msg=name): ex.filename(name)

    def test_curved_ties_gaps_and_zero_candidates(self):
        from csv_exports import stem_coordinates
        from scipy.integrate import quad
        fit=dict(coefficients=[[0,0],[1,0],[0,1]],center=[0,0],axis=[1,0],mid=0,half=1)
        a=stem_coordinates(fit,[(-2,2)],[[0,1]],1,'a');b=stem_coordinates(fit,[(-2,2)],[[0,1]],1,'b')
        expected=quad(lambda t:np.sqrt(1+4*t*t),-2,-np.sqrt(.5))[0]
        self.assertAlmostEqual(a[0][0],expected,places=10);self.assertAlmostEqual(b[0][0],expected,places=10)
        self.assertAlmostEqual(a[1][0],-np.sqrt(.75),places=10);self.assertAlmostEqual(b[1][0],np.sqrt(.75),places=10)
        fit['coefficients']=[[0,0],[1,0]]
        a=stem_coordinates(fit,[(-3,-1),(1,3)],[[0,-.3]],1,'a');b=stem_coordinates(fit,[(-3,-1),(1,3)],[[0,-.3]],1,'b')
        self.assertEqual(a[0][0],2.);self.assertEqual(b[0][0],2.)
        self.assertAlmostEqual(a[1][0],np.hypot(1,.3));self.assertAlmostEqual(b[1][0],-np.hypot(1,.3))
        for array in stem_coordinates(fit,[(-3,3)],[],1,'a'):self.assertEqual(len(array),0)

if __name__=='__main__': unittest.main()

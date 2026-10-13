import csv
import io
import json
import math
import unittest
import numpy as np
import csv_exports as ex


class TrichomeCoordinateSystems(unittest.TestCase):
 def test_global_mm_is_grid_centre_transform(self):
  meta=dict(origin_center_mm=[-0.5,-4.25],spacing_mm=[0.002,0.002])
  gx,gy=ex.global_coordinates([[0,0],[10,3],[1000,250]],meta)
  np.testing.assert_allclose(gx,[-0.5,-0.48,1.5]);np.testing.assert_allclose(gy,[-4.25,-4.244,-3.75])

 def test_pca_axes_oriented_from_base_with_left_positive(self):
  # Stem along +x through (10,5); axis given pointing -x must be re-oriented A→B (+x for these ends).
  fit=dict(coefficients=[[10,5],[4,0]],center=[10,5],axis=[-1,0],mid=0,half=4)
  pts=[[14,5],[10,2],[10,8]]  # ahead, screen-up (left of +x in y-down), screen-down
  u,v=ex.pca_coordinates(fit,[(-1,1)],pts,0.5,'a')
  np.testing.assert_allclose(u,[2,0,0]);np.testing.assert_allclose(v,[0,1.5,-1.5])
  ub,vb=ex.pca_coordinates(fit,[(-1,1)],pts,0.5,'b')
  np.testing.assert_allclose(ub,-u);np.testing.assert_allclose(vb,-v)

 def test_pca_left_matches_stem_left_and_is_rotation(self):
  # Rotated straight stem: PCA frame equals stem frame up to the origin shift along the stem.
  a=math.radians(30);d=np.array([math.cos(a),math.sin(a)])
  fit=dict(coefficients=[[0,0],list(5*d)],center=[0,0],axis=list(d),mid=0,half=5)
  rng=np.random.default_rng(1);pts=rng.uniform(-3,3,(40,2))
  u,v=ex.pca_coordinates(fit,[(-1,1)],pts,1.,'a')
  x,y,_=ex.stem_coordinates(fit,[(-1,1)],pts,1.,'a')
  inside=np.abs(pts@d)<4.5
  np.testing.assert_allclose(u[inside]+5,x[inside],atol=1e-9);np.testing.assert_allclose(v[inside],y[inside],atol=1e-9)
  np.testing.assert_allclose(np.hypot(u,v),np.hypot(*pts.T),atol=1e-12)  # distances preserved

 def test_candidate_csv_appends_columns_keeping_old_order(self):
  text=ex.candidate_csv([1,2],[0.,1.],[.5,-.5],[.01,.02],[False,True],True,([1.,2.],[3.,4.],[5.,6.],[7.,8.]))
  rows=list(csv.reader(io.StringIO(text)))
  self.assertEqual(rows[0],['id','x_mm','y_mm','height_mm','side_ambiguous','pca_u_mm','pca_v_mm','global_x_mm','global_y_mm'])
  self.assertEqual(rows[2],['2','1','-0.5','0.02','true','2','4','6','8'])
  self.assertEqual(ex.candidate_csv([],[],[],[],[],False,(np.array([]),)*4),'id,x_mm,y_mm,height_mm,pca_u_mm,pca_v_mm,global_x_mm,global_y_mm\r\n')
  with self.assertRaises(ValueError):ex.candidate_csv([1],[0.],[0.],[0.],[False],True,([1.],[2.],[3.],[]))


class OutlineAndHeightmap(unittest.TestCase):
 def test_outline_csv_rings_and_points(self):
  rows=list(csv.DictReader(io.StringIO(ex.outline_csv([[0,0,1,0,1,1],[5,5,6,5]]))))
  self.assertEqual([(r['ring'],r['point']) for r in rows],[('1','1'),('1','2'),('1','3'),('2','1'),('2','2')])
  self.assertEqual((rows[2]['x_mm'],rows[2]['y_mm']),('1','1'))

 def test_tiff_round_trip_values_nan_and_calibration(self):
  import tifffile
  z=np.arange(12,dtype=np.float32).reshape(3,4)-5;z[0,0]=np.nan
  meta=dict(spacing_mm=[0.0025,0.0025],origin_center_mm=[-0.5,2.0],sources=[{'path':'/x/scan_a'}])
  raw,info=ex.heightmap_tiff(z,meta)
  with tifffile.TiffFile(io.BytesIO(raw)) as t:
   a=t.asarray();ij=t.imagej_metadata;xr=t.pages[0].tags['XResolution'].value
  np.testing.assert_array_equal(np.isnan(a),np.isnan(z));np.testing.assert_array_equal(a[~np.isnan(a)],z[~np.isnan(z)])
  self.assertEqual(a.dtype,np.float32);self.assertEqual(ij['unit'],'mm');self.assertAlmostEqual(xr[1]/xr[0],0.0025,places=9)
  # ImageJ: world = (pixel - origin) * pixel size, equal to origin_center_mm + index * spacing.
  self.assertAlmostEqual((0-ij['xorigin'])*0.0025,-0.5);self.assertAlmostEqual((2-ij['yorigin'])*0.0025,2.005)
  meta_back=json.loads(ij['Info']);self.assertEqual(meta_back['origin_center_mm'],[-0.5,2.0]);self.assertEqual(meta_back['no_data'],'NaN')
  self.assertEqual(meta_back['sources'],['scan_a']);self.assertEqual(info['valid_cells'],11)

 def test_filenames_per_extension(self):
  self.assertEqual(ex.filename('height map.TIF','.tif'),'height map.tif');self.assertEqual(ex.filename('h','.tif'),'h.tif')
  for bad in ['../h','a.tif.tif','']:
   with self.assertRaises(ValueError,msg=bad):ex.filename(bad,'.tif')


if __name__=='__main__':unittest.main()

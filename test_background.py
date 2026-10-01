import unittest
import engine
class BackgroundTest(unittest.TestCase):
 def test_parameter_validation_and_independent_mask_entry(self):
  self.assertTrue(callable(getattr(engine,'prepare_mask',None)), 'background must have an independent entry, not require a curve fit')
  p=engine.validate_background({'enabled':True})
  self.assertEqual(p['threshold'],99)
  self.assertEqual(p['iterations'],6)
  with self.assertRaises(ValueError):engine.validate_background({'enabled':True,'iterations':1.5})
  with self.assertRaises(ValueError):engine.validate_background({'enabled':'yes'})
if __name__=='__main__':unittest.main()

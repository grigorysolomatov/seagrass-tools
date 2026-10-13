"""Saved sessions: scan identity, relocation and mismatch reporting."""
import json,tempfile,unittest
from pathlib import Path
import engine
import session
from tests.make_synthetic import generate


class SessionScanTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();base=Path(self.tmp.name)
  self.root=generate(base/'scans');self.old=engine.ROOT;engine.ROOT=self.root.resolve()
  self.paths=[str(self.root/f'synthetic-{i}') for i in (1,2)]
 def tearDown(self):engine.ROOT=self.old;self.tmp.cleanup()

 def test_describe_is_relative_and_complete(self):
  r=session.describe(self.paths)['sources']
  self.assertEqual([x['folder'] for x in r],['synthetic-1','synthetic-2'])
  files=r[0]['files'];self.assertIn('synthetic.tmd',files);self.assertIn('scan.yaml',files);self.assertEqual(len(files),11)
  tmd=self.root/'synthetic-1'/'synthetic.tmd'
  self.assertEqual(files['synthetic.tmd']['size'],tmd.stat().st_size)
  self.assertEqual(files['synthetic.tmd']['sha256'],engine.digest(tmd))
  self.assertNotIn(str(self.root),json.dumps(r))  # no absolute paths in the file

 def test_round_trip_resolves_same_folders(self):
  r=session.describe(self.paths)['sources']
  self.assertEqual(session.resolve(r)['paths'],[str(Path(p).resolve()) for p in self.paths])

 def test_moved_folder_found_by_name(self):
  r=session.describe(self.paths)['sources']
  (self.root/'moved').mkdir();(self.root/'synthetic-2').rename(self.root/'moved'/'synthetic-2')
  self.assertEqual(session.resolve(r)['paths'][1],str((self.root/'moved'/'synthetic-2').resolve()))

 def test_missing_and_changed_files_are_named(self):
  r=session.describe(self.paths)['sources']
  (self.root/'synthetic-1'/'image03.png').unlink()
  tmd=self.root/'synthetic-2'/'synthetic.tmd';data=bytearray(tmd.read_bytes());data[-1]^=1;tmd.write_bytes(bytes(data))
  with self.assertRaises(ValueError) as e:session.resolve(r)
  msg=str(e.exception)
  self.assertIn('Scan 1 (synthetic-1)',msg);self.assertIn('image03.png',msg)
  self.assertIn('Scan 2 (synthetic-2): synthetic.tmd has different content',msg)

 def test_size_change_and_missing_folder(self):
  r=session.describe(self.paths)['sources']
  tmd=self.root/'synthetic-1'/'synthetic.tmd';tmd.write_bytes(tmd.read_bytes()+b'x')
  with self.assertRaisesRegex(ValueError,'different size'):session.resolve(r[:1])
  gone=[{**r[1],'folder':'nowhere/else','name':'not-here'}]
  with self.assertRaisesRegex(ValueError,'folder not found'):session.resolve(gone)

 def test_rejects_escaping_and_malformed(self):
  r=session.describe(self.paths)['sources']
  with self.assertRaisesRegex(ValueError,'relative'):session.resolve([{**r[0],'folder':'../synthetic-1'}])
  with self.assertRaisesRegex(ValueError,'malformed'):session.resolve([{'folder':'x'}])
  with self.assertRaises(ValueError):session.resolve([])
  with self.assertRaisesRegex(ValueError,'twice'):session.resolve([r[0],r[0]])

 def test_inputs_untouched(self):
  before={p:p.stat().st_mtime_ns for p in self.root.rglob('*')}
  session.resolve(session.describe(self.paths)['sources'])
  self.assertEqual(before,{p:p.stat().st_mtime_ns for p in self.root.rglob('*')})


if __name__=='__main__':unittest.main()

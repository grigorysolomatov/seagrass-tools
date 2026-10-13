"""Parallel per-slice mask/fit must equal the serial path exactly (synthetic fixtures)."""
import hashlib,json,tempfile,threading,unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
import engine
from tests.make_synthetic import generate

def tree(root):
 return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()}

class ParallelSliceTests(unittest.TestCase):
 def run_stage(self,root,cache,paths,parallel):
  bg=engine.validate_background({'enabled':True});shared=dict(top=20,degree=3)
  item=lambda p:dict(id=p,path=p,topLocked=True,degreeLocked=True)
  with patch.object(engine,'ROOT',root),patch.object(engine,'CACHE',cache):
   if parallel:
    with ThreadPoolExecutor(len(paths)) as pool:
     masks=list(pool.map(lambda p:engine.prepare_mask(p,bg),paths))
     # Mask and fit requests for the same slice may race; the per-key lock publishes once.
     fits=list(pool.map(lambda p:engine.process_slice(item(p),shared,bg),paths+paths))[:len(paths)]
   else:
    masks=[engine.prepare_mask(p,bg) for p in paths]
    fits=[engine.process_slice(item(p),shared,bg) for p in paths]
  return masks,fits

 def test_parallel_equals_serial(self):
  with tempfile.TemporaryDirectory() as temp:
   temp=Path(temp);root=generate(temp/'scans').resolve()
   paths=sorted(str(p) for p in root.iterdir() if p.is_dir())
   self.assertEqual(len(paths),3)
   serial=self.run_stage(root,temp/'serial',paths,False)
   parallel=self.run_stage(root,temp/'parallel',paths,True)
   self.assertEqual([m['key'] for m in serial[0]],[m['key'] for m in parallel[0]])
   strip=lambda r:{k:v for k,v in r.items() if k!='cache_hit'}
   self.assertEqual([strip(r) for r in serial[1]],[strip(r) for r in parallel[1]])
   a,b=tree(temp/'serial'),tree(temp/'parallel')
   self.assertTrue(any(k.endswith('mask.png') for k in a) and any(k.endswith('native.npz') for k in a))
   self.assertEqual(a,b)

 def test_worker_bound(self):
  self.assertGreaterEqual(engine.WORKERS,1)
  active=[0];peak=[0];guard=threading.Lock()
  def work():
   with engine.WORK_SLOTS:
    with guard:active[0]+=1;peak[0]=max(peak[0],active[0])
    threading.Event().wait(.02)
    with guard:active[0]-=1
  threads=[threading.Thread(target=work) for _ in range(engine.WORKERS+3)]
  [t.start() for t in threads];[t.join() for t in threads]
  self.assertLessEqual(peak[0],engine.WORKERS)

if __name__=='__main__':unittest.main()

"""Path confinement and HTTP access guards without research data."""
import json,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import engine,server

class AccessTests(unittest.TestCase):
 def test_root_symlink_and_metadata_escape(self):
  with tempfile.TemporaryDirectory() as temp:
   base=Path(temp);root=base/'data';root.mkdir();outside=base/'outside';outside.mkdir();(outside/'secret').write_text('fixture')
   (root/'escape').symlink_to(outside,target_is_directory=True)
   with patch.object(engine,'ROOT',root):
    self.assertEqual(engine.safe_path(str(root)),root)
    for name in [str(outside),str(root/'escape'),str(root/'..'/'outside'),'relative']:
     with self.assertRaises(ValueError):engine.safe_path(name)
    for name in ['../outside/secret',str(outside/'secret'),'escape/secret']:
     with self.assertRaises(ValueError):engine.file_in(root,name)
 def test_host_origin_and_root(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   with patch.object(engine,'ROOT',root),patch.object(engine,'DEFAULT',root):
    http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start();url=f'http://127.0.0.1:{http.server_port}'
    try:
     with urllib.request.urlopen(url+'/api/browse') as response:self.assertEqual(json.load(response)['path'],str(root))
     for headers in [{'Host':'attacker.invalid'},{'Host':'attacker.invalid:8000'}]:
      with self.assertRaises(urllib.error.HTTPError) as exc:urllib.request.urlopen(urllib.request.Request(url+'/api/health',headers=headers))
      self.assertEqual(exc.exception.code,403)
     request=urllib.request.Request(url+'/api/load',data=b'{}',headers={'Content-Type':'application/json','Origin':'http://attacker.invalid'})
     with self.assertRaises(urllib.error.HTTPError) as exc:urllib.request.urlopen(request)
     self.assertEqual(exc.exception.code,400)
    finally:http.shutdown();http.server_close();thread.join()
if __name__=='__main__':unittest.main()

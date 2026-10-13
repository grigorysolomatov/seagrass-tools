"""Saved sessions: identify scan folders portably and check them on reopen.

A session file (built in the browser, see session.mjs) stores each scan folder
by its path RELATIVE to the data root plus the size and SHA-256 of every input
file the tools read. Reopening resolves those folders under the current data
root (falling back to a unique folder of the same name, so a colleague with a
different layout still works) and refuses when any file is missing or differs.
Nothing here writes to the inputs.
"""
import os
import engine

MAX_SOURCES=30
_DIGESTS={}  # (path, size, mtime_ns) -> sha256; avoids re-reading unchanged scans


def _digest(p):
 st=p.stat();key=(str(p),st.st_size,st.st_mtime_ns)
 if key not in _DIGESTS:_DIGESTS[key]=engine.digest(p)
 return _DIGESTS[key]


def _files(folder):
 """{name relative to the scan folder: {size, sha256}} for every input file."""
 folder,_,_,files,_=engine.inspect_source(str(folder))
 return folder,{p.relative_to(folder).as_posix():{'size':p.stat().st_size,'sha256':_digest(p)} for p in files}


def describe(paths):
 """Session records for loaded scan folders (absolute paths under the root)."""
 if not isinstance(paths,list) or not 1<=len(paths)<=MAX_SOURCES:raise ValueError(f'Save needs 1–{MAX_SOURCES} loaded scans')
 out=[]
 for path in paths:
  if not isinstance(path,str):raise ValueError('Invalid scan path')
  folder,files=_files(engine.safe_path(path))
  out.append({'folder':folder.relative_to(engine.ROOT).as_posix() or '.','name':folder.name,'files':files})
 return {'sources':out}


def _candidates(record):
 rel=record['folder']
 parts=rel.split('/')
 if rel.startswith('/') or '..' in parts or '\\' in rel:raise ValueError('Session folder paths must be relative to the data root')
 direct=(engine.ROOT/rel)
 if direct.is_dir():return [direct]
 # Same folder name elsewhere under the root (at most three levels deep).
 found=[]
 for depth in range(3):
  for p in engine.ROOT.glob('/'.join(['*']*depth+[glob_escape(record['name'])])):
   if p.is_dir() and not any(x.startswith('.') or x=='z.hide' for x in p.relative_to(engine.ROOT).parts):found.append(p)
 return found


def glob_escape(name):
 return ''.join('['+c+']' if c in '*?[' else c for c in name)


def _check(record,folder):
 """Problems comparing one saved source with a folder on disk ([] = identical)."""
 try:folder,files=_files(folder)
 except (ValueError,OSError) as exc:return [str(exc)]
 problems=[]
 saved=record['files']
 for name in sorted(saved):
  if name not in files:problems.append(f'{name} is missing')
  elif files[name]['size']!=saved[name].get('size'):problems.append(f'{name} has a different size ({files[name]["size"]:,} bytes, saved {saved[name].get("size"):,})')
  elif files[name]['sha256']!=saved[name].get('sha256'):problems.append(f'{name} has different content')
 for name in sorted(set(files)-set(saved)):problems.append(f'{name} is new (the scan now uses a different file)')
 return problems


def _valid_record(r):
 if not isinstance(r,dict) or not isinstance(r.get('folder'),str) or not isinstance(r.get('name'),str) or not r['name'] or not isinstance(r.get('files'),dict) or not r['files']:return False
 return all(isinstance(k,str) and isinstance(v,dict) and isinstance(v.get('size'),int) and isinstance(v.get('sha256'),str) for k,v in r['files'].items())


def resolve(records):
 """Absolute folder paths for saved sources, or ValueError listing every problem."""
 if not isinstance(records,list) or not 1<=len(records)<=MAX_SOURCES:raise ValueError(f'The session must list 1–{MAX_SOURCES} scans')
 paths=[];problems=[]
 for i,r in enumerate(records):
  if not _valid_record(r):raise ValueError(f'Scan {i+1} in the session file is malformed')
  label=f'Scan {i+1} ({r["name"]})'
  try:candidates=_candidates(r)
  except ValueError as exc:problems.append(f'{label}: {exc}');continue
  if not candidates:problems.append(f'{label}: folder not found under the data root ({engine.ROOT.name}/{r["folder"]})');continue
  checks=[(c,_check(r,c)) for c in candidates]
  match=[c for c,p in checks if not p]
  if match:paths.append(str(match[0].resolve()));continue
  problems.append(f'{label}: '+'; '.join(checks[0][1]))
 if problems:raise ValueError('Session does not match the scans on disk · '+' · '.join(problems))
 if len(set(paths))!=len(paths):raise ValueError('Session lists the same scan folder twice')
 return {'paths':paths}


def request(kind,body):
 if kind=='describe':return describe(body.get('paths'))
 if kind=='resolve':return resolve(body.get('sources'))
 raise ValueError('Unknown session request')

"""Download-only numeric CSVs. Never write a user-supplied filename on the server."""
import csv
import io
import re
import numpy as np

def filename(value):
    if not isinstance(value,str): raise ValueError('Enter a CSV filename')
    if re.search(r'[\x00-\x1f\x7f/\\\\:*?"<>|]',value): raise ValueError('Use a filename, not a path; control characters are forbidden')
    value=value.strip()
    if value.lower().endswith('.csv'): value=value[:-4]
    if (not value or len(value)>120 or value.endswith(('.', ' ')) or value.startswith(('.', '=', '+', '-', '@'))
        or value.lower().endswith('.csv') or re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?',value)):
        raise ValueError('Enter a simple filename of 1–120 characters, with at most one .csv extension')
    return value+'.csv'

def number(value):
    if not np.isfinite(value): raise ValueError('Nonfinite exported measurement')
    return format(float(value),'.17g')

def table(header, rows):
    out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(header);writer.writerows(rows);return out.getvalue()

def border_csv(meta, base, quality=True):
    if base not in ('a','b'): raise ValueError('Leaf base must be a or b')
    rows=[];n=len(meta['arclength_mm'])
    for j,i in enumerate(range(n) if base=='a' else range(n-1,-1,-1)):
        x=meta['arclength_mm'][i];left=meta['left_signed_mm'][i];right=meta['right_signed_mm'][i]
        broken=meta['break_before'][i] if base=='a' else (j==0 or meta['break_before'][i+1])
        if base=='b': x=meta['length_mm']-x;left,right=(-right if right is not None else None),(-left if left is not None else None)
        valid=left is not None and right is not None
        if not quality and broken and j and valid:rows.append(['','',''])
        rows.append([number(x),number(left) if valid else '',number(right) if valid else '']+([str(valid).lower(),str(bool(broken)).lower()] if quality else []))
    return table(['x_mm','left_y_mm','right_y_mm']+(['valid','break_before'] if quality else []),rows)

def candidate_csv(ids,x,y,height,ambiguous,quality=True):
    return table(['id','x_mm','y_mm','height_mm']+(['side_ambiguous'] if quality else []),
                 ([int(i),number(a),number(b),number(h)]+([str(bool(flag)).lower()] if quality else []) for i,a,b,h,flag in zip(ids,x,y,height,ambiguous,strict=True)))
from stem_arc import StemArc
from nearest_stem import nearest_points

def stem_coordinates(fit, intervals, points, spacing, base, targets=None, parameters=None):
    if base not in ('a','b'): raise ValueError('Leaf base must be a or b')
    arc = StemArc(fit['coefficients'], intervals, spacing)
    if targets is None:
        nearest = nearest_points(fit['coefficients'],intervals,points)
        targets,parameters = nearest['targets_'+base],nearest['parameters_'+base]
    targets = np.asarray(targets, float).reshape(-1,2)
    # The fitted PCA projection is linear in t (same identity as curve_domain).
    if parameters is None and fit.get('manual'):
        parameters=nearest_points(fit['coefficients'],intervals,points)['parameters_'+base]
    t = np.asarray(parameters) if parameters is not None else ((targets-np.asarray(fit['center'])) @ np.asarray(fit['axis'])-fit['mid'])/fit['half']
    t = np.clip(t,arc.lo,arc.hi)
    s = np.array([arc.at(v) for v in t])
    delta = np.asarray(points,float).reshape(-1,2)-targets
    tangent = np.column_stack((arc.dx(t),arc.dy(t)))
    norm = np.linalg.norm(tangent,axis=1)
    if np.any(norm <= 1e-10): raise ValueError('Undefined stem normal')
    side = np.sum(delta*np.column_stack((tangent[:,1],-tangent[:,0])),axis=1)/norm
    ambiguous = np.abs(side) <= 1e-9  # grid pixels; deterministic canonical side
    sign = np.where(ambiguous | (side>0),1.,-1.)
    y = np.linalg.norm(delta,axis=1)*spacing*sign
    if base=='b': s,y=arc.length-s,-y
    return s,y,ambiguous

def window_ranges(residual, points, offset, window):
    if not isinstance(window, int) or window < 1 or window % 2 != 1:
        raise ValueError('Detection window must be a positive odd integer')
    radius = window // 2
    result = np.empty(len(points), dtype=np.float64)
    for i, (x, y) in enumerate(np.asarray(points, dtype=np.int64).reshape(-1, 2) - offset):
        if x-radius < 0 or y-radius < 0:
            raise ValueError('Candidate lacks full residual window support')
        region = residual[y-radius:y+radius+1, x-radius:x+radius+1]
        if region.shape != (window, window) or not np.isfinite(region).all():
            raise ValueError('Candidate lacks full residual window support')
        result[i] = float(region.max()) - float(region.min())
    return result


def request(body):
    import json
    import engine
    import merge
    import postmerge
    import leaf_borders
    import nearest_stem
    name=filename(body.get('filename'))
    quality=body.get('quality',True)
    if type(quality) is not bool:raise ValueError('Quality flags must be boolean')
    base=body.get('base')
    if base not in ('a','b'): raise ValueError('Leaf base must be a or b')
    mk=body.get('merge_key');sk=body.get('stem_key')
    if not isinstance(mk,str) or mk not in merge.MERGES: raise ValueError('Current registered merge required')
    root=engine.CACHE/'postmerge'
    def artifact(key,kind,parameters):
        if not isinstance(key,str) or key not in postmerge.ARTIFACTS: raise ValueError('Current registered '+kind+' required')
        meta=json.loads((root/key/'meta.json').read_text())
        if meta['kind']!=kind or meta['merge_key']!=mk or meta['parameters']!=parameters or meta['algorithm_sha256']!=engine.digest(engine.HERE/'postmerge.py'):
            raise ValueError('Stale or mismatched '+kind+' dependencies')
        return meta
    sm=artifact(sk,'stem',body.get('stem_parameters'))
    mm=json.loads((engine.CACHE/'merges'/mk/'meta.json').read_text())
    postmerge.source_cohort(mm,sm['parameters']['top'],validate_only=True)
    kind=body.get('kind')
    if kind=='borders':
        meta=leaf_borders.request(dict(stem_key=sk,step_mm=body.get('step_mm'),**leaf_borders.controls(body)))
        if body.get('border_key')!=meta['key']: raise ValueError('Stale or mismatched border sampling')
        text=border_csv(meta,base,quality);count=meta['count']
        order=list(range(count)) if base=='a' else list(range(count-1,-1,-1))
        data=dict(x=[meta['arclength_mm'][i] if base=='a' else meta['length_mm']-meta['arclength_mm'][i] for i in order],left=[meta['left_signed_mm'][i] if base=='a' else (-meta['right_signed_mm'][i] if meta['right_signed_mm'][i] is not None else None) for i in order],right=[meta['right_signed_mm'][i] if base=='a' else (-meta['left_signed_mm'][i] if meta['left_signed_mm'][i] is not None else None) for i in order],break_before=[meta['break_before'][i] if base=='a' else (j==0 or meta['break_before'][i+1]) for j,i in enumerate(order)])
    elif kind=='trichomes':
        rm=artifact(body.get('residual_key'),'residual',body.get('residual_parameters'))
        pm=artifact(body.get('peaks_key'),'peaks',dict(window=body.get('window'),residual_key=rm['key']))
        points=np.load(root/pm['key']/'points.npy',allow_pickle=False)
        if len(points)!=pm['count']: raise ValueError('Candidate count mismatch')
        residual=np.load(root/rm['key']/'residual.npy',mmap_mode='r',allow_pickle=False)
        heights=window_ranges(residual,points,rm['offset_xy'],pm['parameters']['window'])
        with np.load(root/sk/'native.npz',allow_pickle=False) as data:
            intervals=nearest_stem.curve_domain(sm['fit'],data['curve_xy'],data['segment_lengths'])
        connections=nearest_stem.request(dict(stem_key=sk,peaks_key=pm['key']))
        x,y,ambiguous=stem_coordinates(sm['fit'],intervals,points,mm['spacing_mm'][0],base,connections['targets_'+base],connections['parameters_'+base])
        text=candidate_csv(range(1,len(points)+1),x,y,heights,ambiguous,quality);count=len(points)
        data=dict(id=list(range(1,count+1)),x=x.tolist(),y=y.tolist(),height=heights.tolist(),side_ambiguous=ambiguous.tolist())
    else: raise ValueError('Unknown export kind')
    return dict(count=count,base=base,units='mm',data=data) if body.get('plot') else dict(filename=name,csv=text,count=count,base=base,units='mm')

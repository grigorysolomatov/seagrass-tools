# Seagrass Tools

Local browser tools for exploratory stitching and measurement of user-provided GelSight height-map scans. Inputs stay read-only; derived masks, curves and arrays live in a separate cache. This repository contains code and synthetic-fixture generators, **not research scans or results**.

**Save your work with Save session** (top right). Refreshing or closing the tab otherwise loses the loaded composition, manual placement and in-session history; a disk cache is not a saved session. See *Saving and reopening a session* below.

**Research prototype, not anatomical validation.** Prepared foreground is an experimental mask; a fitted stem is a geometric reference; detected maxima are trichome *candidates*. No automatic height leveling or anatomical classification is performed. Candidate counts per mm² of leaf area are a convenience ratio of candidates, not a validated trichome density.

## Docker (recommended)

Install Docker Engine with Compose, or Docker Desktop. Docker must be running. From this folder:

```sh
cp .env.example .env
# Edit .env: SEAGRASS_DATA_ROOT must be an existing absolute scan-parent directory.
docker compose up --build -d
```

Open `http://127.0.0.1:8000`. Check `docker compose ps` and `docker compose logs` if startup fails. Stop with `docker compose down`. The cache is retained; `docker compose down --volumes` deletes derived cache only (not your input mount). Do not run the latter if you need those cached artifacts.

In Windows PowerShell, use `Copy-Item .env.example .env`. Example `.env` values:

```dotenv
# Windows Docker Desktop (forward slashes):
SEAGRASS_DATA_ROOT="C:/Users/you/Scans with spaces"
# macOS: SEAGRASS_DATA_ROOT="/Users/you/Scans with spaces"
# Linux: SEAGRASS_DATA_ROOT="/path/to/Scans with spaces"
SEAGRASS_PORT=8000
```

Keep only the applicable data-root assignment. Docker Desktop may ask to share that directory. In the browser, mounted files appear under **`/data`**, not their host path. The Compose configuration binds only host loopback, mounts `/data` read-only, uses a non-root UID/GID 1000, drops capabilities, disallows privilege escalation, and makes the application filesystem read-only. `/cache` is a Docker-managed writable volume. Do not replace this with a public-facing deployment.

First build downloads the Python base image and pinned dependencies; scientific data is never downloaded. Subsequent processing is local. The build uses an explicit source allowlist and hash-pinned requirements exported from `uv.lock`. Tests and generated fixtures are not in image layers.

### Native Python alternative

Install Python **3.13** and `uv`. On Linux/macOS:

```sh
./launch.sh --data-root "/path/to/scans" --no-browser
```

`./launch.sh` without arguments browses the caller's current directory and attempts to open the browser. Set `SEAGRASS_DATA_ROOT` to avoid browsing an unintended directory. The default native address is `127.0.0.1:8000`; `--port 0` chooses an unused port. If an explicit port is occupied, the native server reports a fallback port. `--cache-dir` or `SEAGRASS_CACHE` overrides the default user cache (`$XDG_CACHE_HOME/seagrass-tools`, otherwise `~/.cache/seagrass-tools`). Cache must be outside the input root. Relative CLI paths resolve from the caller's directory.

On Windows with Python/uv, use:

```powershell
uv run --frozen python server.py --data-root "C:/Users/you/Scans" --no-browser
```

The launcher automatically enters the small supplied `shell.nix` on NixOS; other native systems do not require Nix. Do not expose `--host 0.0.0.0` on a workstation; it exists for container-internal binding. Port forwarding and remote multi-user use are outside scope.

## Input layout

Choose the parent of one or more scan folders. Each folder needs:

- exactly one binary TrueMap v2 `.tmd` height map (finite heights, mm);
- `thumbnail.jpg` matching its native dimensions;
- `scan.yaml` identifying six acquisition image filenames and a calibration YAML;
- that calibration YAML, with `flatfield.modelfile`, `modelsize`, `size`, and six `scale` values;
- a 16-bit flatfield PNG arranged as three columns × two rows of calibration tiles.

All referenced files must resolve inside that scan folder. Canonical paths and symlinks cannot escape the configured data root; hidden/archive directories are not offered. TMD offsets are read but not applied: matching uncropped photo/height grids are assumed. Cropped or mismatched acquisitions require separate registration work. No vendor capture software or data is bundled.

## Walkthrough

1. **Load, order & orient.** Add scan folders, select valid entries, Load. Reorder with arrows. Set selected-slice angle/mirrors and incoming/outgoing reversal when needed. Load is photo-first and does not fit curves. Switch Photo/Heightmap freely.
2. **Remove background.** Prepare all foreground masks. Inspect the cut-out; Show source background changes display only. Advanced mask settings are photometric segmentation parameters, not stem percentiles.
3. **Compute slice stems.** Default **top 20%, degree 3**. Compute is placement-neutral. A shared value can be unlocked for one slice. Optional Edit selected curve reveals Reset and draggable degree+1 Bézier handles; enabling edit alone does not approximate or alter the automatic polynomial. Composition Undo/Redo also covers slice edits. **Draw stem by hand** (collapsed, below Edit selected curve) is the fallback where Top % fails: tick Draw selected stem and click along the selected slice's stem from its incoming end; drag a point to move it, right-click to delete it; Remove last point and Clear · use automatic undo it. A slice with two or more points uses its line instead of the automatic stem; slice cards show *auto stem*, *edited stem* or *hand-drawn stem*. If automatic computation fails for some slices, the others keep their stems so the failed ones can be drawn. For Align the line's ends and end-segment directions act like an automatic curve's. For the combined stem (step 6) the line replaces that slice's top-% observations by the same number of points spaced equally along the line, so its weight is unchanged; the stem status marks such slices and the line is stored in the stem's parameters and cache key.
4. **Align & refine.** Align uses the current automatic/manual slice stems, preserves the first slice's orientation and solves followers to tangent joins. Select a joint to move its entire downstream chain: Along/Across in mm, angle in degrees. Buttons step 0.1 mm/1°. Positive Across is the local upper side; positive angle is counterclockwise. Translation follows the moving frame. Re-Align resets refinements.
5. **Merge.** Maximum of finite original heights within prepared masks on a physical grid. Negative values remain negative; uncovered cells are missing. This is not normalized-preview compositing or leveling. Photo overlap blending is display-only. Optional **Leaf outline** (collapsed): the outline is the outer boundary of the merged mask. *Smoothing* (0–0.25 mm Gaussian along the outline) removes stitching zigzags; *Redraw a section* replaces the outline between two points you drag between (e.g. across a seam notch). Undo/Redo and *Reset to original* are per merge. Leaf area, candidate density and leaf borders then use the edited outline: measured cells outside it are dropped, cells it adds without height count flat (3D = flat there), and only candidates inside it count for density. Without edits nothing changes. Each Merge then measures **leaf area** automatically (shown under Merge; hover for calibration and per-slice values): *flat* = projected prepared-foreground area, *3D* = area of the measured height surface including trichomes. Once candidates exist, the same line shows candidates per mm² of each area.
6. **Combined stem.** Default **top 20%, degree 3** independently within each source foreground, then one pooled fit. Select Leaf base A or B; it does not infer anatomy or move the curve. Edit combined curve reveals its own Reset/Undo/Redo. Editing invalidates stem-coordinate outputs, not detector arrays.
7. **Candidates.** Median window 101 px and detection window 21 px are separate odd native-grid widths. Median histogram precision defaults to 12 bits; this is approximation precision, not source bit depth. Residual is signed raw height minus median. Only full finite windows survive. One deterministic representative per tied regional maximum; no amplitude/area filter. Optional draggable size guides start near A. Temporary median/residual previews do not change science.
8. **Leaf borders.** First normal-ray exit from connected prepared support at arclength samples. Optional raw-height cutoff is off; inward margin is zero. Neither affects detector arrays. Inspect gaps; profiles are solid but never intentionally bridge missing support.
9. **Plot & export.** Move/resize the plot, Fit, pan/zoom and hover; click a candidate to identify it in the workspace. Bright axes show mm, signed distance and zero. Plot and CSV share numerical tables. Pick what to save in **Export** (trichome positions, leaf borders, leaf area, leaf outline, height map), adjust the filename and press **Download**; the hint under the button says what is still missing. The browser chooses the destination, not the server. See [Exports](#exports).

### Saving and reopening a session

**Save session** (top right) downloads a small JSON file (about 10 kB for three scans). **Open session…** loads one in any browser tab, on this computer or another with the same scans, and continues from there. The file describes how the slices relate, not results:

- each scan folder, relative to the data root, with the size and SHA-256 of every input file (TMD, thumbnail, `scan.yaml`, calibration, flatfield and the six acquisition images);
- slice order, angle, mirrors, swapped ends, per-slice Top %/Degree overrides, mask settings and Initial join spacing;
- hand-drawn stems (point lists) and edited slice curves (Bézier handles);
- the exact slice poses and joint corrections after Align (restored as they are, not re-aligned);
- leaf outline edits (smoothing and redrawn sections);
- steps 6–9 settings (combined Top %/Degree, edited combined curve, windows, histogram bits, border options, leaf base, export choice and filenames) and which stages were current;
- headline numbers (merged grid, leaf area, combined stem, candidate and border counts) to check the reopened result.

Opening checks every file first. A missing folder or a changed, missing or different-size file stops with a message naming the scan and file; nothing is loaded. A moved scan folder is found by its name anywhere up to three levels under the data root. Open then reruns the steps that were current when saved (background, slice stems, Merge, outline, leaf area, combined stem, candidates, borders) with a spinner and phase in the header, and reports *results match the saved session* or names any result that differs. With a warm cache this takes seconds; on a fresh computer it takes as long as running the steps (about 3 minutes for three 16 MP scans). Undo history starts fresh. Opening replaces the slices in the tab after confirmation. The file contains folder and file names, so treat it like the scans themselves.

### Top-percentage semantics

Both stem stages call the **same** foreground selector: `valid = prepared_mask & isfinite(raw_z)`, cutoff = linear quantile at `1 - top/100`, selection = valid values **greater than or equal to** cutoff. Background values cannot change the cutoff. Inclusive ties can select more than the requested percentage. Source cutoffs/counts are retained in fit provenance. At matching masks and percentages, individual and combined stages select identical native cohorts; each independent polynomial versus one pooled polynomial can legitimately differ. Combined fitting transforms every source observation and retains both observations in overlaps; it does not select only maximum-mosaic survivors or balance slices by equal count.

**The mask's fixed full-image top-5% seed is a different operation and stays 5%.** Changing the stem setting does not alter mask generation.

## Exports

All lengths are mm. Step 9 → **Export** offers one file at a time:

| Export | Default file | Needs | Columns / content |
|---|---|---|---|
| Trichome positions | `trichomes.csv` | stem (6) + candidates (7) | `id`; stem system `x_mm`, `y_mm`; `height_mm`; `side_ambiguous` (quality flags on); PCA system `pca_u_mm`, `pca_v_mm`; global system `global_x_mm`, `global_y_mm` |
| Leaf borders | `leaf-borders.csv` | stem (6) + borders (8) | `x_mm`, `left_y_mm`, `right_y_mm`; `valid`, `break_before` (quality flags on) |
| Leaf area | `leaf-area.csv` | Merge (5) | `quantity,scope,value,unit` rows, see below |
| Leaf outline | `leaf-outline.csv` | Merge (5) | `ring`, `point`, `x_mm`, `y_mm` |
| Height map | `heightmap.tif` | Merge (5) | 32-bit float TIFF of merged raw heights |

Trichome coordinate systems (one row per candidate, same `id` as the plot):

- **Stem** (`x_mm`, `y_mm`): arclength along the combined stem from the selected Leaf base to the nearest stem point, and signed Euclidean distance to it (left +). Follows a curved stem.
- **PCA** (`pca_u_mm`, `pca_v_mm`): straight axes of the combined stem fit. Origin = centroid of the stem's top-% observations; `u` along the first principal axis, pointing from the selected Leaf base towards the other end; `v` perpendicular, left + (same side convention as `y_mm`). For a curved stem `u` is not arclength. If the combined curve was edited by hand, the axes stay those of the automatic fit.
- **Global** (`global_x_mm`, `global_y_mm`): position in the stitched (merged) image, x right, y down, as on screen. Plain coordinates, valid for any leaf shape; independent of the stem and Leaf base. Same frame as the outline and height map.

Leaf outline: closed rings (last point joins the first), ring 1 the largest, in the global frame. It is the edited outline when step 5's Leaf outline was smoothed or redrawn, otherwise the original outer boundary of the merged mask (boundary cell centres).

Height map: ImageJ-style TIFF (Fiji/ImageJ and Python `tifffile` read it; other TIFF readers get the values and pixel size), float32 raw merged heights in mm (maximum of source heights, not levelled), `NaN` = no leaf / no data. Pixel size in mm is stored as the TIFF resolution with unit `mm`; ImageJ origin is set so ImageJ shows global mm. The ImageJ `Info` field holds JSON with `pixel_mm`, `origin_center_mm`, `height_units`, `no_data`, dimensions, height range and source folder names. Pixel (column, row) centre → global mm: `x = origin_center_mm[0] + column × pixel_mm[0]`, `y = origin_center_mm[1] + row × pixel_mm[1]`. Large merges give tens of MB (zlib-compressed).

### CSV meanings

- Borders: `x_mm` = physical stem arclength from the selected base; `left_y_mm` / `right_y_mm` are signed normal distances. Missing measurements stay blank.
- Candidates: stable `id`, `x_mm` = arclength to the finite nearest stem target, `y_mm` = signed Euclidean distance; `height_mm` = **max minus min of the median-subtracted residual in that candidate's complete detection window**, not raw-height range or peak amplitude. PCA and global columns follow (see [Exports](#exports)).
- Leaf area (`quantity,scope,value,unit`): `leaf_flat_area` and `leaf_3d_area` in mm² for the current merge, their ratio, merged cell size, per-slice areas and pixel sizes; with current candidates also `trichome_candidates`, `candidates_per_flat_area` and `candidates_per_3d_area` (1/mm²). Calibration is the TMD header pixel pitch (`length / pixels`, checked against `scan.yaml` `mmperpixel`) and raw TMD heights in mm. Flat = valid merged cells × cell area. 3D = Σ cell area × √(1 + ∂z/∂x² + ∂z/∂y²), with gradients on each slice's native grid between prepared-foreground neighbours only, so leaf-edge walls, background and seams between unlevelled slices are excluded and overlaps count once. Surface detail finer than one pixel (~2.8 µm on GelSight Max) is not resolved, so 3D area is a lower bound of the true surface. It depends on the prepared mask. Rows `outline` (`original`/`edited`) and, when edited, `outline_smoothing` (mm), `outline_redrawn_sections`, `outline_added_area_without_height` and `outline_removed_area` (mm²); `trichome_candidates` then has scope `inside outline`.
- Optional quality fields: `valid` means supported borders, `break_before` starts a new disconnected line, `side_ambiguous` indicates undefined left/right (on-curve or tangent-extension cases), not candidate rejection. Without quality columns, blank border rows preserve discontinuities.

Nearest-target ties use ordered arclength from the selected base. Reversing base changes origin and signed sides; a tied nearest target may change. In a y-down canvas, directed left normal is `(ty, -tx)`. Distances include gaps along the polynomial; invalid sections are not concatenated away.

## Tests and synthetic demonstration

```sh
uv run --frozen python -m unittest discover -v
npm ci
npm test
uv run --frozen python tests/make_synthetic.py /outside/repository/synthetic-scans
./launch.sh --data-root /outside/repository/synthetic-scans --port 8000 --no-browser
# In another terminal (install Playwright Chromium once if needed):
npx playwright install chromium
STITCHER_URL=http://127.0.0.1:8000 SMALL_FIXTURE=1 npm run test:browser
```

The generator refuses an existing output directory. Its artificial shapes are **software fixtures, not measurements or simulated biological evidence**. Browser tests load all valid folders and write private local screenshots, state and actual downloads to `test-results` (or `TEST_OUTPUT`). Never commit this directory when using real scans. `CHROMIUM` can point to a system Chromium executable; on NixOS use the native packaged browser. With NixOS, run numerical commands inside `nix-shell --extra-experimental-features 'nix-command flakes' shell.nix`.

CI runs numerical/model tests, generates synthetic files outside the checkout, builds the Docker image and runs the real Compose/browser workflow. It does not use research data.

## Limits and troubleshooting

- Large full-resolution mosaics need substantial RAM and disk cache. Merge is bounded by its allocation checks; post-merge arrays are capped at 80 million cells and combined stems at 5 million selected observations. The 20% default was exercised on a three-scan workflow below this limit; it is not a guarantee for arbitrary inputs. Reduce Top % or process fewer sources if the explicit guard fires—no hidden subsampling occurs.
- Histogram workload is bounded separately. Higher precision/window sizes cost time; use 12 bits first. Errors retain prior results but mark incompatible stages stale. Recompute prerequisites explicitly.
- Inputs with disconnected/edge-touching foreground, weak photometric contrast, bad calibration or over-extrapolated curves can fail preparation/fitting. A clean numerical fit does not establish anatomy. Segmentation fills holes and keeps one ridge-connected component; genuine perforations/separate tissue can be lost. Calibration-grid processing limits boundary resolution.
- Permission denied: ensure the Docker runtime and UID 1000 can read source folders. Do not make private datasets world-readable merely to fix this. A controlled group/read ACL or a separate read-only staging copy may be appropriate. Do not run the application privileged. Bind-mounted custom caches must be writable by the configured container user; default named volumes are initialized correctly.
- Port in use: change `SEAGRASS_PORT` in `.env` and recreate with `docker compose up -d`. The browser uses that host port; the internal healthcheck still uses 8000.
- macOS/Windows Docker Desktop and ARM64 have not been exercised here. Linux x86_64 Docker plus native NixOS launch were tested; cross-platform commands are provided, not claims of verified platform coverage.

## Security, provenance and licensing

Trusted local desktop use only: no authentication, encrypted transport, multi-user isolation or hostile-upload sandbox. Keep loopback publishing. Host/Origin checks reject common cross-origin/rebinding requests but do not make arbitrary scan parsers safe for untrusted files. Native input access is logically read-only; Docker additionally enforces a read-only mount. Cache metadata contains local source paths/hashes—treat it as private.

No project license has been selected. See `THIRD_PARTY_NOTICES.md` for vendor-reference attribution and dependency notices. See `AGENTS.md` for development invariants. Do not infer a project-wide license from third-party notices.

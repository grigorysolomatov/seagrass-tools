# Agent and contributor guidance

## Scope and privacy

This is a trusted-local scientific prototype, not a public service. Use `launch.sh` as the user-facing native launcher. Keep user scan folders read-only and outside the checkout. Never commit scan images, TMDs, result arrays, state JSON, screenshots of real data, test logs, caches, `.env`, secrets, absolute workstation paths or old project history. Synthetic generators are acceptable; generated payloads stay outside Git and the Docker context. Do not add a project license without owner direction. Do not silently stop an existing user's server or refresh a tab with an unsaved setup.

## Module map

- `server.py`: supported HTTP entry point, host/origin checks, Load, API routes.
- `engine.py`: confined source discovery, configuration validation, content hashes, mask/slice-fit caches and asset registry.
- `science.py`: TMD decode, **single foreground selector**, automatic native PCA polynomial, clipping, reference placement.
- `masking.py`: six-channel flatfield/photometric segmentation and GrabCut, fixed top-5% mask seed.
- `model.mjs`: composition/history, native-to-world transforms, explicit Align, moving joint frames.
- `app.js`: source workflow, camera/rendering, numerical-edit integration and async revision ownership.
- `blend.mjs`: display-only normalized photo overlap weights.
- `merge.py`: raw maximum mosaic on a physical grid.
- `postmerge.py`: per-source combined fit, tiled quantized median and residual maxima.
- `curve_edit.py` / `.mjs`: exact polynomial/Bernstein conversion, clipping, manual handles.
- `hand_stem.py` / `.mjs`: hand-drawn slice stems (native polyline). Align uses its ends/end-segment tangents; the combined stem replaces that slice's top-% cohort by the same count of equal-arclength samples.
- `nearest_stem.py`: finite-interval stationary-root nearest points with directed tie ordering.
- `area.py`: flat and 3D (slope-weighted) leaf area in mm² of a merge; native-grid foreground-only gradients, each merged cell takes the slope of its maximum-height source. Area cache depends on merge key and area/merge implementation hashes.
- `stem_arc.py`: **shared physical arclength** for borders, candidate coordinates, CSV and plot.
- `leaf_borders.py`: arclength sections, first raster-cell exit, optional cutoff/margin.
- `outline.py` / `outline.mjs`: leaf outline of the merge; smoothing/redraw geometry lives only in `.mjs`, the server rasterizes the edited rings into a region used by area and borders (key `outline_key`, null = original mask).
- `csv_exports.py`: artifact validation and numerical tables/download text. Never write user filenames on server.
- `post.js`: post-merge UI, stage-specific dependencies, export generations and scientific overlays.
- `plot.mjs`: nonmodal display of exporter tables; never a second science implementation.

## Numerical invariants

Native coordinates are `(column,row)` pixel centers, y down; raw Z and physical transforms are mm. Positive displayed angles are counterclockwise. For directed tangent `(tx,ty)`, left normal is `(ty,-tx)`. A source's original rectangular frame remains the selection footprint, not the scientific mask.

Both slice and combined fits select **finite prepared foreground raw heights** using `science.foreground_selection`: inclusive `z >= quantile(z[valid],1-top/100,method='linear')`. Default Top is 20 in state, HTML, examples and new fixtures. Masking's independent full-image top-5% seed remains unchanged. Preserve actual tie counts. Separate fits and the pooled fit can differ despite identical cohorts. Combined fitting retains equal-weight overlapping source observations and transforms native centers without rounding; top-mask display is only a rasterized union.

Automatic fits project observations onto a signed PCA axis, normalize to [-1,1] and fit both coordinates with equal weights. This is not unrestricted looping-curve regression. Manual edits use exact degree-d power/Bernstein conversion with d+1 handles and an explicit parameter domain. Never recover a manually edited curve's parameter from the old PCA projection. Keep automatic baselines and finite support intervals immutable; draw extrapolation dashed and gaps missing.

Load/mask/fit never move slices. Align explicitly consumes current curves, anchors the first orientation, solves followers and resets refinements. Joint rotation precedes incremental translations in the current rotated frame; downstream frames must follow. Zeroing counters after intervening rotations is not a geometric reset. Visibility controls never trigger science. In-session history is not persistence.

Merging uses maximum original finite heights under native prepared masks, with identical sampling support for heights and masks. Do not initialize missing cells to zero or merge display stretches. Photo blending is display-only. No Z leveling without a separate scientific decision.

Median is global finite-range histogram quantization (default 12 bits), tiled with true halos; residual is signed raw-minus-median. Keep independent odd windows (101 median, 21 detection). Only complete finite supports survive. Plateau selection is deterministic, not a size/amplitude filter. Candidate height is residual-window **max minus min**. Do not introduce biological claims.

Borders follow connected support from the stem center to the first raster-cell face crossing. Optional RAW-height cutoff is off; inward margin is zero. Preserve missing centers and sub-sample gap breaks. Both profiles are solid; do not bridge gaps. Nearest points test stationary roots and all finite interval endpoints; equal-distance tolerance/tie order follows the selected base. Signed Euclidean distance keeps an explicit ambiguity flag at undefined sides. Arclength includes polynomial travel through gaps.

## Cache and asynchronous ownership

- Source Load: path, TMD/photo hashes and display version.
- Mask: all input hashes, masking implementation hash, parameters, fixed seed and asset version.
- Slice fit: source hashes, prepared-mask key, science implementation hash, top/degree and selection identity.
- Merge: immutable sources, raw-height/mask hashes and exact poses/grid; inspect `merge.py` for bounds.
- Post stages: kind, merge, exact parameters and implementation hashes (including shared selection); peaks depend on residual identity.
- Edited stems, nearest targets, borders and exports validate registered artifact kinds and current merge/stem identities. Derivatives depend on their implementation/parameter keys.

When changing an algorithm, update cache dependencies rather than treating old artifacts as current. Parameter edits invalidate only dependent stages. Pose edits invalidate all merge-derived current status. Monotonic revisions must reject late results after edit→undo, even if visible state again looks identical. Export/base/filename edit generations are additional guards. Maintain scoped combined-curve undo separately from composition history. Root/cache paths are runtime configuration; never bake environment paths into source.

## Verification before handoff

Run the numerical suite (`uv run --frozen python -m unittest discover -v`) and model suite (`npm ci && npm test`). On NixOS enter supplied `shell.nix` for native wheel libraries. Test source changes in a clean directory, not a sibling project's virtualenv/node_modules. Use `tests/make_synthetic.py` outside the checkout and `tests/browser.cjs` against an actual launched server/Compose container. `CHROMIUM` selects a native browser when required. Browser outputs are private and ignored.

Browser checks must cover real clicks through Load → mask → independent stems → Align → Merge → combined/manual/reset → candidates → borders → both-base plot and actual downloads. `tests/verify_downloads.py` checks downloaded numbers against plotted arrays, every candidate residual window, scalar quantile interpolation and transformed native cohorts; run where its cache and source paths are mounted. Retain separate evidence for real scans, never publish it. A passing healthcheck or mocked JSON does not establish scientific workflow completion.

For container changes build the actual Dockerfile, run the exact Compose loopback publication, inspect nonroot/read-only mount settings, confirm a read-only input write fails, and verify cache writes. Audit explicit Dockerfile COPY and `.dockerignore` allowlists. Check dependency locks/export consistency. Test `./launch.sh` with zero arguments, explicit data root, no-browser and from another working directory. Do not declare untested platforms supported by evidence.

Keep changes focused; do not rewrite stable scientific modules merely to reformat them. New algorithms need independent scalar/synthetic checks rather than comparisons only to the function being tested. Preserve real source bytes and report known numerical and anatomical limitations separately.

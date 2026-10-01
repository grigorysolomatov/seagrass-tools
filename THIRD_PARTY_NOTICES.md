# Third-party notices

No license has been selected for Seagrass Tools itself. The notice below applies to the referenced GelSight work only and is not a license grant for this whole repository.

## GelSight file-format and flatfield references

The TMD decoder in `science.py` and six-channel flatfield convention in `masking.py` follow the public reference implementations `readtmd.m` and `readimg.m` in `gelsightinc/gsmatlab`, revision `4ebf06f4c0a2a3841e2dd302d8e0183089338771`. The Python implementations use NumPy/Pillow; no MATLAB runtime or vendor data is included. Flatfield resizing is not claimed bitwise equivalent to MATLAB. Foreground segmentation and downstream measurements are experimental application logic, not vendor-provided anatomy analysis.

Reference repository: `https://github.com/gelsightinc/gsmatlab`

The upstream notice is retained conservatively for these adaptations:

> MIT License
>
> Copyright (c) 2019 GelSight, Inc.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Installed dependencies

Runtime packages are locked in `uv.lock` and hash-pinned in `requirements.txt`: NumPy, SciPy, scikit-image, Pillow, PyYAML, opencv-python-headless and their transitive dependencies (imageio, lazy-loader, networkx, packaging, tifffile). They are installed from upstream distributions, not vendored into the source tree. Their licenses and bundled native-library notices remain in installed package metadata in the container/virtual environment. NumPy/SciPy and OpenCV wheels can contain additional native components with their own notices; do not strip those distributions' license directories when packaging.

The browser test harness installs Playwright as a development-only dependency through `package-lock.json`; it is not part of the runtime image. The container base is the Docker Official Python image (Python on Debian), pinned by manifest digest. OS packages and Python retain their own notices. This document is an attribution inventory, not an exhaustive legal compatibility determination.

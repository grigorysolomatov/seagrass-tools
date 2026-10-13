FROM python:3.13-slim-bookworm@sha256:2325bb286ec344af3e5898cc224b5844e2707ac6e26b1632516fd3edc84a5e26
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SEAGRASS_DATA_ROOT=/data SEAGRASS_CACHE=/cache OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt \
    && groupadd --gid 1000 app && useradd --uid 1000 --gid 1000 --no-create-home app \
    && mkdir /data /cache && chown app:app /cache
COPY --chmod=644 science.py masking.py engine.py merge.py postmerge.py nearest_stem.py leaf_borders.py csv_exports.py curve_edit.py hand_stem.py stem_arc.py area.py server.py ./
COPY --chmod=644 THIRD_PARTY_NOTICES.md ./
COPY --chmod=644 app.js post.js model.mjs blend.mjs curve_edit.mjs hand_stem.mjs plot.mjs index.html style.css ./
USER 1000:1000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3)"
CMD ["python","server.py","--host","0.0.0.0","--port","8000","--no-browser"]

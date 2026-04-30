"""Python <-> JavaScript bridge via WebSocket.

Commands run in background threads to keep the server responsive.
Log output is streamed to the browser in real-time.
"""

import dataclasses
import hashlib
import io
import json
import logging
import os
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from osgeo import gdal, ogr, osr

from nbs.noaabathymetry import fetch_tiles, mosaic_tiles
from nbs.noaabathymetry.library import (
    list_tile_scheme, fetch_tile_scheme, parse_tile_scheme,
    extended_status_tiles,
)
from nbs.noaabathymetry.library.export import export_project
from nbs.noaabathymetry._internal.config import resolve_data_source

from src.dialogs import browse_directory as _browse_directory
from src.dialogs import browse_geometry as _browse_geometry


class _LogCapture(logging.Handler):
    """Logging handler that forwards records to a callback."""

    def __init__(self, callback):
        super().__init__()
        self.callback = callback

    def emit(self, record):
        try:
            msg = self.format(record)
            self.callback(msg)
        except Exception:
            pass


class _StderrCapture(io.TextIOBase):
    """Captures stderr writes (tqdm) and forwards to a callback.

    tqdm uses \\r to overwrite lines. We track the current line
    and send updates when meaningful content changes.
    """

    def __init__(self, callback, original):
        self._callback = callback
        self._original = original
        self._current = ""

    def write(self, s):
        if not s:
            return 0
        if "\r" in s:
            parts = s.split("\r")
            for part in parts:
                if part.strip():
                    self._current = part
            if self._current.strip():
                self._callback(self._current.rstrip())
        elif "\n" in s:
            lines = s.split("\n")
            for line in lines:
                if line.strip():
                    self._callback(line.rstrip())
            self._current = ""
        else:
            self._current += s
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return True


_RECENTS_DIR = Path.home() / ".noaabathymetry"
_RECENTS_FILE = _RECENTS_DIR / "recents.json"
_MAX_RECENTS = 10


def _load_recents():
    try:
        if _RECENTS_FILE.is_file():
            return json.loads(_RECENTS_FILE.read_text())[:_MAX_RECENTS]
    except Exception:
        pass
    return []


def _save_recents(recents):
    try:
        _RECENTS_DIR.mkdir(parents=True, exist_ok=True)
        _RECENTS_FILE.write_text(json.dumps(recents[:_MAX_RECENTS]))
    except Exception:
        pass


def _mk_temp_geojson():
    """Create an empty temp .geojson and return ``(fd, path)``."""
    return tempfile.mkstemp(suffix=".geojson", prefix="nbsui_geom_")


def _add_recent(path, data_source=None):
    recents = _load_recents()
    path = os.path.normpath(path)
    source = data_source or "bluetopo"
    recents = [r if isinstance(r, dict) else {"path": r, "source": "bluetopo"} for r in recents]
    recents = [r for r in recents
               if not (os.path.normpath(r["path"]) == path and r.get("source") == source)]
    recents.insert(0, {"path": path, "source": source})
    _save_recents(recents[:_MAX_RECENTS])


class _SchemeCacheEntry:
    __slots__ = ("source_key", "last_modified", "etag", "md5",
                 "stored_at", "data_source", "raw_bytes",
                 "_geojson", "_tile_maps")

    def __init__(self, source_key, last_modified, etag, md5, data_source, raw_bytes):
        self.source_key = source_key      # S3 object key
        self.last_modified = last_modified # S3 LastModified from listing
        self.etag = etag                  # S3 ETag from listing
        self.md5 = md5                    # MD5 of downloaded bytes
        self.stored_at = time.time()
        self.data_source = data_source
        self.raw_bytes = raw_bytes
        self._geojson = None
        self._tile_maps = {}  # {data_source: tile_map} — parsed per source


class SchemeStore:
    """Shared cache for remote tile-scheme geopackages.

    Keyed by S3 bucket/prefix so data sources sharing a geopackage
    (e.g. BAG, S102 v2.1, v2.2, v3.0) share one cache entry and one
    download.  If sources are later split into separate geopackages the
    cache adapts automatically.
    """

    def __init__(self, head_skip_seconds=10):
        self._head_skip_seconds = head_skip_seconds
        self._cache = {}        # keyed by "bucket/prefix"
        self._locks = {}        # per cache-key locks
        self._global_lock = threading.Lock()
        self._parse_lock = threading.Lock()  # serialize OGR parsing (GIL thrashing)
        self._refresh_timer = None

    @staticmethod
    def _cache_key(cfg):
        return cfg["bucket"] + "/" + cfg["geom_prefix"]

    def _get_lock(self, key):
        with self._global_lock:
            if key not in self._locks:
                self._locks[key] = threading.Lock()
            return self._locks[key]

    def _ensure_fresh(self, data_source, cfg):
        """Ensure a fresh geopackage is cached.  Returns the entry."""
        key = self._cache_key(cfg)
        lock = self._get_lock(key)
        with lock:
            entry = self._cache.get(key)

            # Fast path: recently checked
            if entry and (time.time() - entry.stored_at) < self._head_skip_seconds:
                return entry

            # Have a cached entry — list prefix to check for new version
            if entry:
                latest = list_tile_scheme(data_source)
                if latest is None:
                    # Network error — serve cached data rather than failing
                    return entry
                current_key, current_modified, current_etag = latest
                key_match = current_key == entry.source_key and current_modified == entry.last_modified
                # Also verify our download isn't corrupt (MD5 vs ETag)
                bytes_valid = not current_etag or "-" in current_etag or entry.md5 == current_etag
                if key_match and bytes_valid:
                    entry.stored_at = time.time()
                    return entry

            # Cache miss, new version, or corrupt download — full download
            raw_bytes, source_key, last_modified, etag = fetch_tile_scheme(data_source)
            md5 = hashlib.md5(raw_bytes).hexdigest()
            # Verify download integrity for single-part uploads
            if etag and "-" not in etag and md5 != etag:
                raise RuntimeError("Download integrity check failed — MD5 mismatch")
            entry = _SchemeCacheEntry(source_key, last_modified, etag, md5, data_source, raw_bytes)
            self._cache[key] = entry
            return entry

    def ensure_fresh(self, data_source):
        """Public entry point — resolves config then ensures freshness."""
        cfg, _ = resolve_data_source(data_source)
        if not cfg.get("geom_prefix"):
            raise RuntimeError("No remote scheme for this source")
        return self._ensure_fresh(data_source, cfg)

    def _invalidate_and_redownload(self, data_source, cfg):
        """Evict the cached entry and force a fresh download."""
        key = self._cache_key(cfg)
        lock = self._get_lock(key)
        with lock:
            self._cache.pop(key, None)
        return self._ensure_fresh(data_source, cfg)

    def _parse_entry(self, entry, data_source, cfg):
        """Parse geopackage: VectorTranslate for GeoJSON, package for tile_map.

        GeoJSON is shared across data sources (same geometry). Tile maps
        are per data_source (package owns field mappings).
        """
        if entry._geojson is None:
            uid = uuid.uuid4().hex
            mem_in = f"/vsimem/_scheme_in_{uid}.gpkg"
            mem_out = f"/vsimem/_scheme_out_{uid}.geojson"
            gdal.FileFromMemBuffer(mem_in, entry.raw_bytes)
            try:
                gdal.VectorTranslate(mem_out, mem_in, options="-f GeoJSON -simplify 0.001")
                f = gdal.VSIFOpenL(mem_out, "rb")
                if f is None:
                    raise RuntimeError("VectorTranslate produced no output")
                raw = gdal.VSIFReadL(1, gdal.VSIStatL(mem_out).size, f)
                gdal.VSIFCloseL(f)
                entry._geojson = json.loads(raw)
            finally:
                gdal.Unlink(mem_in)
                gdal.Unlink(mem_out)
        if data_source not in entry._tile_maps:
            entry._tile_maps[data_source] = parse_tile_scheme(entry._geojson, data_source)

    def _ensure_parsed(self, data_source, need_geojson=False, need_tile_map=False):
        """Ensure the entry is parsed for the requested outputs."""
        cfg, _ = resolve_data_source(data_source)
        if not cfg.get("geom_prefix"):
            raise RuntimeError("No remote scheme for this source")
        entry = self._ensure_fresh(data_source, cfg)
        geojson_ready = entry._geojson is not None
        tile_map_ready = data_source in entry._tile_maps
        if (not need_geojson or geojson_ready) and (not need_tile_map or tile_map_ready):
            return entry
        with self._parse_lock:
            # Re-check after acquiring lock
            geojson_ready = entry._geojson is not None
            tile_map_ready = data_source in entry._tile_maps
            if (not need_geojson or geojson_ready) and (not need_tile_map or tile_map_ready):
                return entry
            try:
                self._parse_entry(entry, data_source, cfg)
            except Exception:
                entry = self._invalidate_and_redownload(data_source, cfg)
                self._parse_entry(entry, data_source, cfg)
        return entry

    def get_geojson(self, data_source):
        """Return parsed GeoJSON FeatureCollection for display on map."""
        entry = self._ensure_parsed(data_source, need_geojson=True)
        return entry._geojson

    def get_tile_map(self, data_source):
        """Return {tile_name: {fields}} dict for status comparison."""
        entry = self._ensure_parsed(data_source, need_tile_map=True)
        return entry._tile_maps[data_source]

    def start_background_refresh(self, interval=900):
        """Periodically call _ensure_fresh for all cached sources.

        Multipart entries (ETag contains '-') are force-refreshed since
        their integrity cannot be validated via MD5.
        """
        def tick():
            for key, entry in list(self._cache.items()):
                try:
                    if entry.etag and "-" in entry.etag:
                        lock = self._get_lock(key)
                        with lock:
                            self._cache.pop(key, None)
                    self.ensure_fresh(entry.data_source)
                except Exception:
                    pass
            self._refresh_timer = threading.Timer(interval, tick)
            self._refresh_timer.daemon = True
            self._refresh_timer.start()

        self._refresh_timer = threading.Timer(interval, tick)
        self._refresh_timer.daemon = True
        self._refresh_timer.start()

    def stop_background_refresh(self):
        if self._refresh_timer:
            self._refresh_timer.cancel()
            self._refresh_timer = None


class Bridge:
    """Exposed to JavaScript via WebSocket."""

    def __init__(self, send_fn):
        self._send = send_fn
        self._running = False
        self._lock = threading.Lock()
        self._scheme_store = SchemeStore(head_skip_seconds=10)
        self._scheme_store.start_background_refresh(interval=900)

    def _run_in_thread(self, fn, project_dir=None, data_source=None):
        with self._lock:
            if self._running:
                self._send({"type": "command_done",
                            "data": {"ok": False, "error": "A command is already running."}})
                return
            self._running = True

        def worker():
            logger = logging.getLogger("noaabathymetry")
            handler = _LogCapture(lambda msg: self._send({"type": "log", "line": msg}))
            handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", "%H:%M:%S"))
            logger.addHandler(handler)
            old_stderr = sys.stderr
            sys.stderr = _StderrCapture(
                lambda msg: self._send({"type": "log", "line": msg}), old_stderr)
            try:
                result = fn()
                if project_dir:
                    _add_recent(project_dir, data_source)
                self._send({"type": "command_done",
                            "data": {"ok": True, "result": dataclasses.asdict(result)}})
            except Exception as e:
                self._send({"type": "command_done",
                            "data": {"ok": False, "error": str(e)}})
            finally:
                sys.stderr = old_stderr
                logger.removeHandler(handler)
                with self._lock:
                    self._running = False

        t = threading.Thread(target=worker, daemon=True)
        t.start()

    def fetch(self, project_dir, geometry, data_source, resolution_filter):
        geometry = geometry if geometry else None
        data_source = data_source if data_source else None
        res_filter = None
        if resolution_filter:
            try:
                res_filter = [float(r.strip()) for r in resolution_filter.split(",") if r.strip()]
            except ValueError:
                res_filter = None

        # The UI submits a GeoJSON FeatureCollection when the user has multiple
        # geometries on the map. The upstream parser only accepts single
        # Geometry/Feature/BBOX/WKT or a file path, so spool the collection
        # to a temp .geojson and hand off the path. OGR opens it as a single
        # multi-feature layer and intersects each feature with the tile scheme.
        temp_geom_path = None
        if geometry and geometry.lstrip().startswith("{"):
            try:
                obj = json.loads(geometry)
            except ValueError:
                obj = None
            if isinstance(obj, dict) and obj.get("type") == "FeatureCollection":
                fd, temp_geom_path = _mk_temp_geojson()
                try:
                    with os.fdopen(fd, "w") as f:
                        f.write(geometry)
                except Exception:
                    if temp_geom_path and os.path.exists(temp_geom_path):
                        try:
                            os.unlink(temp_geom_path)
                        except OSError:
                            pass
                    temp_geom_path = None
                else:
                    geometry = temp_geom_path

        def _do_fetch():
            try:
                return fetch_tiles(
                    project_dir=project_dir,
                    geometry=geometry,
                    data_source=data_source,
                    tile_resolution_filter=res_filter or None,
                )
            finally:
                if temp_geom_path and os.path.exists(temp_geom_path):
                    try:
                        os.unlink(temp_geom_path)
                    except OSError:
                        pass

        self._run_in_thread(_do_fetch, project_dir=project_dir, data_source=data_source)

    def mosaic(self, project_dir, data_source, options_json):
        data_source = data_source if data_source else None
        opts = json.loads(options_json) if options_json else {}
        self._run_in_thread(lambda: mosaic_tiles(
            project_dir=project_dir,
            data_source=data_source,
            hillshade=opts.get("hillshade", False),
            reproject=opts.get("reproject", False),
            workers=opts.get("workers") or None,
            mosaic_resolution_target=opts.get("resolution_target") or None,
        ), project_dir=project_dir, data_source=data_source)

    def export(self, project_dir, data_source, include_mosaics, flag_for_repair):
        project_dir = os.path.expanduser(project_dir.strip()) if project_dir else ""
        data_source = data_source if data_source else None
        dirname = os.path.basename(os.path.normpath(project_dir))
        source_name = data_source or "bluetopo"
        output_path = os.path.join(project_dir, dirname + "_" + source_name + ".zip")
        self._run_in_thread(lambda: export_project(
            project_dir=project_dir,
            output_path=output_path,
            data_source=data_source,
            include_mosaics=include_mosaics,
            flag_for_repair=flag_for_repair,
        ), project_dir=project_dir, data_source=data_source)

    def get_cpu_count(self):
        return os.cpu_count() or 1

    def save_basemap(self, basemap_name):
        recents = _load_recents()
        if recents:
            recents[0] = recents[0] if isinstance(recents[0], dict) else {"path": recents[0], "source": "bluetopo"}
            recents[0]["basemap"] = basemap_name
            _save_recents(recents)

    def get_recents(self):
        return json.dumps(_load_recents())

    def remove_recent(self, path):
        recents = _load_recents()
        norm = os.path.normpath(path)
        recents = [r for r in recents
                   if os.path.normpath(r["path"] if isinstance(r, dict) else r) != norm]
        _save_recents(recents)

    def get_versions(self):
        from importlib.metadata import version as _meta_version
        try:
            ui_version = _meta_version("noaabathymetry-ui")
        except Exception:
            ui_version = "unknown"
        try:
            lib_version = _meta_version("noaabathymetry")
        except Exception:
            lib_version = "unknown"
        return json.dumps({"ui": ui_version, "library": lib_version})

    def check_updates(self):
        from importlib.metadata import version as _meta_version
        from packaging.version import parse as _parse_version
        import urllib.request
        import ssl
        try:
            import certifi
            _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            _ssl_ctx = None

        result = {"ui": {}, "library": {}}

        # Current versions
        try:
            result["ui"]["current"] = _meta_version("noaabathymetry-ui")
        except Exception:
            result["ui"]["current"] = "unknown"
        try:
            result["library"]["current"] = _meta_version("noaabathymetry")
        except Exception:
            result["library"]["current"] = "unknown"

        # Check PyPI for noaabathymetry latest
        try:
            req = urllib.request.Request(
                "https://pypi.org/pypi/noaabathymetry/json",
                headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5, context=_ssl_ctx) as resp:
                data = json.loads(resp.read())
            latest = data["info"]["version"]
            result["library"]["latest"] = latest
            if result["library"]["current"] != "unknown":
                result["library"]["update_available"] = (
                    _parse_version(latest) > _parse_version(result["library"]["current"]))
        except Exception:
            result["library"]["latest"] = None
            result["library"]["update_available"] = None

        # Check GitHub for noaabathymetry-ui latest
        try:
            req = urllib.request.Request(
                "https://api.github.com/repos/noaa-ocs-hydrography/noaabathymetry-ui/releases/latest",
                headers={"Accept": "application/vnd.github+json"})
            with urllib.request.urlopen(req, timeout=5, context=_ssl_ctx) as resp:
                data = json.loads(resp.read())
            tag = data["tag_name"].lstrip("v")
            result["ui"]["latest"] = tag
            if result["ui"]["current"] != "unknown":
                result["ui"]["update_available"] = (
                    _parse_version(tag) > _parse_version(result["ui"]["current"]))
        except Exception:
            result["ui"]["latest"] = None
            result["ui"]["update_available"] = None

        return json.dumps(result)

    def browse_directory(self):
        return _browse_directory()

    def browse_geometry(self):
        return _browse_geometry()

    def read_geometry_file(self, path):
        """Open an OGR-readable geometry file, reproject every feature
        to EPSG:4326, and return a JSON FeatureCollection string.

        On failure, returns ``{"error": "..."}`` JSON.
        """
        try:
            if not path:
                return json.dumps({"error": "no path provided"})
            path = os.path.expanduser(path)
            if not os.path.exists(path):
                return json.dumps({"error": "file not found: " + path})

            ds = ogr.Open(path)
            if ds is None:
                return json.dumps({"error": "could not open: " + path})

            target_srs = osr.SpatialReference()
            target_srs.ImportFromEPSG(4326)
            try:
                target_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            except AttributeError:
                pass  # older GDAL

            features = []
            for layer_idx in range(ds.GetLayerCount()):
                layer = ds.GetLayerByIndex(layer_idx)
                if layer is None:
                    continue
                layer_name = layer.GetName() or ""
                source_srs = layer.GetSpatialRef()
                transform = None
                if source_srs is not None:
                    try:
                        source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                    except AttributeError:
                        pass
                    if not source_srs.IsSame(target_srs):
                        transform = osr.CoordinateTransformation(source_srs, target_srs)

                layer.ResetReading()
                feat_idx = 0
                while True:
                    feat = layer.GetNextFeature()
                    if feat is None:
                        break
                    geom = feat.GetGeometryRef()
                    if geom is None:
                        feat_idx += 1
                        continue
                    geom = geom.Clone()
                    if transform is not None:
                        if geom.Transform(transform) != 0:
                            feat_idx += 1
                            continue
                    geo_json_str = geom.ExportToJson()
                    if not geo_json_str:
                        feat_idx += 1
                        continue
                    try:
                        geom_obj = json.loads(geo_json_str)
                    except ValueError:
                        feat_idx += 1
                        continue
                    features.append({
                        "type": "Feature",
                        "geometry": geom_obj,
                        "properties": {
                            "_layer": layer_name,
                            "_feature_index": feat_idx,
                        },
                    })
                    feat_idx += 1

            ds = None
            return json.dumps({"type": "FeatureCollection", "features": features})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def complete_path(self, partial):
        partial = os.path.expanduser(partial)
        if not partial:
            return json.dumps([])
        parent = os.path.dirname(partial)
        prefix = os.path.basename(partial).lower()
        if not parent:
            parent = "/"
        if not os.path.isdir(parent):
            return json.dumps([])
        try:
            entries = [
                os.path.join(parent, e)
                for e in sorted(os.listdir(parent))
                if e.lower().startswith(prefix)
                and os.path.isdir(os.path.join(parent, e))
                and not e.startswith(".")
            ]
            if len(entries) == 1 and entries[0] == partial.rstrip("/"):
                child_dir = entries[0]
                children = [
                    os.path.join(child_dir, e)
                    for e in sorted(os.listdir(child_dir))
                    if os.path.isdir(os.path.join(child_dir, e))
                    and not e.startswith(".")
                ]
                return json.dumps(children[:10])
            return json.dumps(entries[:10])
        except OSError:
            return json.dumps([])

    def wms_query(self, lat, lng):
        import urllib.request
        try:
            size = 256
            delta = 0.01
            bbox = f"{lng - delta},{lat - delta},{lng + delta},{lat + delta}"
            x = y = size // 2
            base = (f"https://nowcoast.noaa.gov/geoserver/bluetopo/wms?"
                    f"SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo"
                    f"&INFO_FORMAT=application/json&SRS=EPSG:4326"
                    f"&WIDTH={size}&HEIGHT={size}&BBOX={bbox}&X={x}&Y={y}")
            bathy_url = base + "&LAYERS=bluetopo:bathymetry&QUERY_LAYERS=bluetopo:bathymetry&STYLES=source_survey_id"
            tile_url = base + "&LAYERS=bluetopo:bluetopo_tile_scheme&QUERY_LAYERS=bluetopo:bluetopo_tile_scheme"
            bathy_data = json.loads(urllib.request.urlopen(bathy_url, timeout=5).read())
            tile_data = json.loads(urllib.request.urlopen(tile_url, timeout=5).read())
            bathy = bathy_data["features"][0]["properties"] if bathy_data.get("features") else None
            tile = tile_data["features"][0]["properties"] if tile_data.get("features") else None
            return {"bathy": bathy, "tile": tile}
        except Exception:
            return None

    def open_folder(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.isdir(path):
            return False
        import subprocess
        if sys.platform == "win32":
            subprocess.Popen(["explorer", path])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return True

    def prewarm_scheme(self, data_source):
        data_source = data_source if data_source else None
        def worker():
            try:
                self._scheme_store.ensure_fresh(data_source)
            except Exception:
                pass
        t = threading.Thread(target=worker, daemon=True)
        t.start()

    def load_remote_layer(self, data_source):
        data_source = data_source if data_source else None
        source_key = data_source

        def worker():
            try:
                geojson = self._scheme_store.get_geojson(data_source)
                self._send({"type": "layers_ready",
                            "data": {"layer": "remote", "source": source_key, "data": geojson}})
            except Exception as e:
                self._send({"type": "layers_ready",
                            "data": {"layer": "remote", "source": source_key, "error": str(e)}})

        t = threading.Thread(target=worker, daemon=True)
        t.start()

    def load_tracked_layer(self, project_dir, data_source):
        data_source = data_source if data_source else None
        dir_key = project_dir

        def worker():
            try:
                project_dir_expanded = os.path.expanduser(project_dir)
                # Fast check: skip remote scheme download if no local DB exists
                source = (data_source or "bluetopo").lower()
                db_path = os.path.join(project_dir_expanded, f"{source}_registry.db")
                if not os.path.isfile(db_path):
                    raise RuntimeError("Registry database not found")
                tile_map = self._scheme_store.get_tile_map(data_source)
                result = extended_status_tiles(
                    project_dir=project_dir_expanded,
                    data_source=data_source,
                    remote_tiles=tile_map,
                    verbosity="quiet",
                )

                categories = {
                    "up_to_date": result.up_to_date,
                    "updates_available": result.updates_available,
                    "missing_from_disk": result.missing_from_disk,
                    "removed_from_nbs": result.removed_from_nbs,
                }
                layers = {}
                for cat, tiles in categories.items():
                    features = []
                    for t in tiles:
                        geom = t.get("geometry")
                        if geom is None:
                            continue
                        if isinstance(geom, (bytes, bytearray)):
                            from osgeo import ogr
                            g = ogr.CreateGeometryFromWkb(geom)
                            geom = json.loads(g.ExportToJson()) if g else None
                            if geom is None:
                                continue
                        elif isinstance(geom, str):
                            geom = json.loads(geom)
                        props = {k: v for k, v in t.items() if k != "geometry"}
                        features.append({
                            "type": "Feature",
                            "geometry": geom,
                            "properties": props,
                        })
                    layers[cat] = {
                        "type": "FeatureCollection",
                        "features": features,
                    }

                self._send({"type": "layers_ready",
                            "data": {"layer": "tracked", "dir": dir_key, "data": layers, "total": result.total_tracked}})
            except Exception as e:
                self._send({"type": "layers_ready",
                            "data": {"layer": "tracked", "dir": dir_key, "error": str(e)}})

        t = threading.Thread(target=worker, daemon=True)
        t.start()

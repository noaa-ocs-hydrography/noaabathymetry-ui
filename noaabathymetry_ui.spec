# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for National Bathymetric Source Browser GUI.

macOS: .app bundle (looks like single file in Finder)
Windows: single .exe
"""

import glob
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

is_win = sys.platform == "win32"
is_mac = sys.platform == "darwin"

# Windows ships two artifacts:
#   - "onefile" (default):   a single .exe that extracts to %TEMP%\_MEI<n> at launch
#   - "alternate":           a folder bundle (no temp extraction) for users whose
#                            anti-virus interferes with the onefile extract.
# Driven by env var so CI can run pyinstaller twice in one Windows job.
BUILD_MODE = os.environ.get("BUILD_MODE", "onefile").lower()

env = Path(sys.prefix)
src_dir = Path("src")
web_dir = src_dir / "web"

if is_win:
    gdal_data = env / "Library" / "share" / "gdal"
    proj_data = env / "Library" / "share" / "proj"
    gdal_plugins = env / "Library" / "lib" / "gdalplugins"
else:
    gdal_data = env / "share" / "gdal"
    proj_data = env / "share" / "proj"
    gdal_plugins = env / "lib" / "gdalplugins"

# Explicit manifest of bundled web assets — reviewable at a glance.
WEB_FILES = [
    "index.html",
    "styles.css",
    "map.js",
    "panels.js",
    "bridge-ws.js",
    "geom-parsers.js",
    "NOAA-1.png",
    "NOAA-2.png",
]
datas = [(str(web_dir / f), "src/web") for f in WEB_FILES]

# Build-time guard: if anyone adds a new asset to src/web/ without declaring
# it here, fail loudly instead of shipping a bundle that 404s on it.
WEB_EXTS = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".ico",
            ".woff", ".woff2", ".ttf", ".otf"}
_actual = {os.path.basename(f) for f in glob.glob(str(web_dir / "*"))
           if os.path.isfile(f)
           and not os.path.basename(f).startswith(".")
           and Path(f).suffix.lower() in WEB_EXTS}
_undeclared = _actual - set(WEB_FILES)
if _undeclared:
    raise RuntimeError(
        "noaabathymetry_ui.spec: src/web/ has files not declared in WEB_FILES: "
        f"{sorted(_undeclared)}. Add them to the manifest."
    )
_missing = set(WEB_FILES) - _actual
if _missing:
    raise RuntimeError(
        "noaabathymetry_ui.spec: WEB_FILES references files that don't exist in "
        f"src/web/: {sorted(_missing)}."
    )
datas += [
    (str(gdal_data), "share/gdal"),
    (str(proj_data), "share/proj"),
]

if gdal_plugins.is_dir():
    datas.append((str(gdal_plugins), "lib/gdalplugins"))

datas += collect_data_files("botocore")
datas += collect_data_files("certifi")

# Include package metadata so importlib.metadata.version() works in frozen app
from PyInstaller.utils.hooks import copy_metadata
datas += copy_metadata("noaabathymetry-ui")
datas += copy_metadata("noaabathymetry")

# Additional libraries needed by GDAL (SSL for HTTPS, HDF5 for S102)
if is_win:
    lib_dir = str(env / "Library" / "bin")
else:
    lib_dir = str(env / "lib")

extra_bins = []
if is_win:
    # Dragnet: bundle every DLL from the conda env's Library/bin so transitive
    # GDAL deps (libcurl, libgeos, libpng, libtiff, sqlite, etc.) are all included.
    # PyInstaller's static analysis misses many of these on Windows + conda GDAL.
    extra_bins += [(f, ".") for f in glob.glob(os.path.join(lib_dir, "*.dll"))]
else:
    for pattern in ["libssl*", "libcrypto*", "libhdf5*"]:
        extra_bins += [(f, ".") for f in glob.glob(os.path.join(lib_dir, pattern)) if not os.path.islink(f)]

hiddenimports = [
    *collect_submodules("nbs.noaabathymetry"),
    "osgeo", "osgeo.gdal", "osgeo.ogr", "osgeo.osr",
    *collect_submodules("boto3"),
    *collect_submodules("botocore"),
    *collect_submodules("aiohttp"),
    "multidict", "yarl", "aiosignal", "frozenlist",
    "tqdm",
    "tkinter", "tkinter.filedialog",
]

runtime_hook_content = '''
import os, sys
if getattr(sys, '_MEIPASS', None):
    base = sys._MEIPASS
    os.environ.setdefault("GDAL_DATA", os.path.join(base, "share", "gdal"))
    os.environ.setdefault("PROJ_LIB", os.path.join(base, "share", "proj"))
    plugins = os.path.join(base, "lib", "gdalplugins")
    if os.path.isdir(plugins):
        os.environ.setdefault("GDAL_DRIVER_PATH", plugins)
'''

runtime_hook_path = os.path.join("build", "_rthook_gdal.py")
os.makedirs("build", exist_ok=True)
with open(runtime_hook_path, "w") as f:
    f.write(runtime_hook_content)

if is_win and os.path.exists("assets/NOAA.ico"):
    exe_icon = "assets/NOAA.ico"
elif os.path.exists("assets/NOAA.icns"):
    exe_icon = "assets/NOAA.icns"
else:
    exe_icon = None

a = Analysis(
    ["src/main.py"],
    pathex=[],
    binaries=extra_bins,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[runtime_hook_path],
    excludes=["matplotlib", "numpy.distutils", "test", "unittest", "PySide6", "PyQt5", "PyQt6"],
    noarchive=False,
)

pyz = PYZ(a.pure)

if is_win:
    # Build splash image: NOAA logo + branding text on dark background
    from PIL import Image as _Image, ImageDraw as _ImageDraw, ImageFont as _ImageFont
    _logo = _Image.open("assets/NOAA-1.png").convert("RGBA")
    _logo = _logo.resize((200, 200), _Image.LANCZOS)
    _bg_color = (18, 40, 70)  # matches app --bar-bg
    _bg = _Image.new("RGB", (300, 300), _bg_color)
    # Center logo
    _lx = (_bg.width - _logo.width) // 2
    _bg.paste(_logo, (_lx, 24), mask=_logo.split()[3])
    # Add text
    _draw = _ImageDraw.Draw(_bg)
    _text = "NATIONAL BATHYMETRIC SOURCE"
    try:
        _font = _ImageFont.truetype("arial.ttf", 11)
    except (IOError, OSError):
        try:
            _font = _ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 11)
        except (IOError, OSError):
            _font = _ImageFont.load_default()
    _spacing = 1.5
    _ty = 240
    _tw = sum(_draw.textbbox((0, 0), c, font=_font)[2] + _spacing for c in _text) - _spacing
    _tx = (_bg.width - _tw) / 2
    _cx = _tx
    for c in _text:
        _draw.text((_cx, _ty), c, fill=(94, 112, 137), font=_font)
        _cx += _draw.textbbox((0, 0), c, font=_font)[2] + _spacing
    # "Starting..." label
    try:
        _font_sm = _ImageFont.truetype("arial.ttf", 10)
    except (IOError, OSError):
        try:
            _font_sm = _ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 10)
        except (IOError, OSError):
            _font_sm = _ImageFont.load_default()
    _start_text = "STARTING..."
    _start_spacing = 1.5
    _stw = sum(_draw.textbbox((0, 0), c, font=_font_sm)[2] + _start_spacing for c in _start_text) - _start_spacing
    _stx = (_bg.width - _stw) / 2 + 8
    _scx = _stx
    for c in _start_text:
        _draw.text((_scx, 265), c, fill=(70, 90, 115), font=_font_sm)
        _scx += _draw.textbbox((0, 0), c, font=_font_sm)[2] + _start_spacing
    # Add transparent border using magenta (#ff00ff) — PyInstaller treats this as transparent on Windows
    _margin = 12
    _radius = 20
    _final = _Image.new("RGB", (_bg.width + _margin * 2, _bg.height + _margin * 2), (255, 0, 255))
    _fdraw = _ImageDraw.Draw(_final)
    _fdraw.rounded_rectangle([(_margin, _margin), (_final.width - _margin, _final.height - _margin)],
                              radius=_radius, fill=(18, 40, 70))
    _final.paste(_bg, (_margin, _margin))
    # Re-draw rounded corners over the pasted content
    _corner_mask = _Image.new("L", _final.size, 255)
    _cmask_draw = _ImageDraw.Draw(_corner_mask)
    _cmask_draw.rectangle([(0, 0), _final.size], fill=0)
    _cmask_draw.rounded_rectangle([(_margin, _margin), (_final.width - _margin, _final.height - _margin)],
                                   radius=_radius, fill=255)
    _magenta = _Image.new("RGB", _final.size, (255, 0, 255))
    _final = _Image.composite(_final, _magenta, _corner_mask)
    _splash_path = os.path.join("build", "splash.png")
    _final.save(_splash_path)

    splash = Splash(
        _splash_path,
        binaries=a.binaries,
        datas=a.datas,
        text_pos=None,
    )

    if BUILD_MODE == "alternate":
        # Folder bundle (no %TEMP% extraction at launch). Inner exe is named
        # `noaabathymetry.exe` so users see the same launcher they expect.
        # Splash still useful — Python startup (GDAL init, aiohttp boot,
        # browser launch) takes a few seconds even without onefile extraction.
        exe = EXE(
            pyz, a.scripts, splash, [],
            exclude_binaries=True,
            name="noaabathymetry",
            debug=False,
            strip=False,
            upx=False,
            console=False,
            icon=exe_icon,
        )
        coll = COLLECT(
            exe, a.binaries, a.datas, splash.binaries,
            strip=False,
            upx=False,
            name="noaabathymetry-Alternate",
        )
    else:
        # Onefile: single .exe that extracts to %TEMP%\_MEI<n> at launch.
        exe = EXE(
            pyz, a.scripts, splash, a.binaries, a.datas, splash.binaries, [],
            name="noaabathymetry",
            debug=False,
            strip=False,
            upx=False,
            onefile=True,
            console=False,
            icon=exe_icon,
        )
else:
    # macOS: .app bundle
    exe = EXE(
        pyz, a.scripts, [],
        exclude_binaries=True,
        name="noaabathymetry",
        debug=False,
        strip=False,
        upx=False,
        console=False,
        icon=exe_icon,
    )

    coll = COLLECT(
        exe, a.binaries, a.datas,
        strip=False,
        upx=False,
        name="noaabathymetry",
    )

    app = BUNDLE(
        coll,
        name="noaabathymetry.app",
        icon="assets/NOAA.icns" if os.path.exists("assets/NOAA.icns") else None,
        bundle_identifier="com.noaabathymetry.browser",
    )

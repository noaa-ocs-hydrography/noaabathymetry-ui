// MapLibre map with draw tools for AOI selection.

// ── Basemaps ─────────────────────────────────────────

var cartoAttribution = '© <a href="https://carto.com/" target="_blank">CARTO</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

var basemapStyles = {
    "Voyager": {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"], tileSize: 256, attribution: cartoAttribution } },
        layers: [{ id: "carto", type: "raster", source: "carto" }]
    },
    "Dark": {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], tileSize: 256, attribution: cartoAttribution } },
        layers: [{ id: "carto", type: "raster", source: "carto" }]
    },
    "Light": {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"], tileSize: 256, attribution: cartoAttribution } },
        layers: [{ id: "carto", type: "raster", source: "carto" }]
    },
};

var basemapNames = Object.keys(basemapStyles);
var basemapIndex = 0;

var map = new maplibregl.Map({
    container: "map",
    style: basemapStyles["Voyager"],
    center: [-80, 30],
    zoom: 4,
    attributionControl: false,
});

// Integer zoom with smooth animation on scroll
map.scrollZoom.disable();
var scrollZooming = false;
map.getCanvas().addEventListener("wheel", function (e) {
    e.preventDefault();
    if (scrollZooming) return;
    scrollZooming = true;
    var z = Math.round(map.getZoom());
    var newZ = e.deltaY < 0 ? z + 1 : z - 1;
    newZ = Math.max(1, Math.min(20, newZ));
    if (e.deltaY < 0) {
        var point = map.unproject([e.offsetX, e.offsetY]);
        map.easeTo({ zoom: newZ, center: point, duration: 300 });
    } else {
        map.easeTo({ zoom: newZ, duration: 300 });
    }
    map.once("moveend", function () { scrollZooming = false; });
}, { passive: false });

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

function setBasemapByName(name) {
    var idx = basemapNames.indexOf(name);
    if (idx >= 0 && idx !== basemapIndex) setBasemap(idx);
}

function setBasemap(idx) {
    basemapIndex = idx;
    // Preserve sources/layers we've added
    var center = map.getCenter();
    var zoom = map.getZoom();
    map.setStyle(basemapStyles[basemapNames[idx]]);
    map.once("styledata", function () {
        map.jumpTo({ center: center, zoom: zoom });
        readdAllSources();
    });
    if (bridge) bridge.save_basemap(basemapNames[idx]);
}

// ── Draw tools (custom polygon drawing) ──────────────
//
// State model: a collection of features (drawn / loaded / parsed) lives in
// `geomCollection`. The map renders the entire collection from one source
// (draw-polygon). One feature can be `selected` for vertex editing — its
// vertices are rendered into draw-points, and `drawPoints` holds the
// working copy of its outer ring (without the closing duplicate).
// In-progress drawing (polygon-being-clicked or rectangle-being-dragged)
// renders into a separate `draw-inprogress` source so committed features
// stay visible underneath.

var geomCollection = [];
var geomIdCounter = 0;
var selectedFeatureId = null;
var drawingMode = false;
var drawPoints = [];

var DRAW_FILL_OPACITY = 0.15;
var DRAW_FILL_OPACITY_SELECTED = 0.3;

var FILL_COLOR_EXPR = ["match", ["get", "source"],
    "loaded", "rgba(110,200,140,1)",
    "parsed", "rgba(180,140,230,1)",
    /* drawn / default */ "rgba(100,140,255,1)"];
var LINE_COLOR_EXPR = ["match", ["get", "source"],
    "loaded", "rgba(110,200,140,0.85)",
    "parsed", "rgba(180,140,230,0.85)",
    "rgba(100,140,255,0.85)"];

var DrawControl = {
    onAdd: function () {
        var div = document.createElement("div");
        div.className = "maplibregl-ctrl maplibregl-ctrl-group";
        div.innerHTML =
            '<button id="draw-polygon-btn" class="draw-btn" title="Draw polygon" onclick="startDrawing()">⬠</button>' +
            '<button id="draw-rect-btn" class="draw-btn" title="Draw rectangle" onclick="startRectangle()">▭</button>' +
            '<button id="draw-clear-btn" class="draw-btn" title="Clear all geometries" onclick="clearAllGeometries()">✕</button>';
        return div;
    },
    onRemove: function () {}
};
map.addControl(DrawControl, "top-left");

var POLY_ICON = "⬠";
var POLY_FINISH_ICON = "✓";
var POLY_CANCEL_ICON = "✕";

function _updatePolygonBtnState() {
    var btn = document.getElementById("draw-polygon-btn");
    if (!btn) return;
    if (!drawingMode) {
        btn.textContent = POLY_ICON;
        btn.title = "Draw polygon";
        btn.classList.remove("draw-btn-finish", "draw-btn-cancel");
    } else if (drawPoints.length >= 3) {
        btn.textContent = POLY_FINISH_ICON;
        btn.title = "Finish polygon";
        btn.classList.add("draw-btn-finish");
        btn.classList.remove("draw-btn-cancel");
    } else {
        btn.textContent = POLY_CANCEL_ICON;
        btn.title = "Cancel polygon";
        btn.classList.add("draw-btn-cancel");
        btn.classList.remove("draw-btn-finish");
    }
}

// ── Collection helpers ───────────────────────────────

function _polyCount() {
    var n = 0;
    for (var i = 0; i < geomCollection.length; i++) {
        if (geomCollection[i].source === "drawn") n++;
    }
    return n;
}

var _lastAddedId = null;

function addFeature(geom, source, label) {
    if (!geom || !geom.type) return null;
    if (!label) {
        if (source === "drawn") label = "Polygon " + (_polyCount() + 1);
        else if (source === "parsed") label = "Geometry " + (geomCollection.length + 1);
        else label = "Feature " + (geomCollection.length + 1);
    }
    var entry = {
        id: "g" + (++geomIdCounter),
        source: source || "drawn",
        label: label,
        geometry: geom,
    };
    geomCollection.push(entry);
    _lastAddedId = entry.id;
    syncCollectionToMap();
    if (typeof onGeomCollectionChanged === "function") onGeomCollectionChanged();
    return entry.id;
}

function removeFeature(id) {
    var idx = -1;
    for (var i = 0; i < geomCollection.length; i++) {
        if (geomCollection[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    if (selectedFeatureId === id) deselectFeature();
    geomCollection.splice(idx, 1);
    syncCollectionToMap();
    if (typeof onGeomCollectionChanged === "function") onGeomCollectionChanged();
}

function clearAllGeometries() {
    if (drawingMode) cancelDrawing();
    if (rectMode) cancelRect();
    deselectFeature();
    geomCollection = [];
    syncCollectionToMap();
    if (typeof onGeomCollectionChanged === "function") onGeomCollectionChanged();
}

function getFeatureCollection() {
    return {
        type: "FeatureCollection",
        features: geomCollection.map(function (e) {
            return {
                type: "Feature",
                geometry: e.geometry,
                properties: { id: e.id, source: e.source, label: e.label },
            };
        }),
    };
}

function getGeomEntry(id) {
    for (var i = 0; i < geomCollection.length; i++) {
        if (geomCollection[i].id === id) return geomCollection[i];
    }
    return null;
}

function syncCollectionToMap() {
    if (!map.getSource("draw-polygon")) return;
    var feats = geomCollection.map(function (e) {
        return {
            type: "Feature",
            geometry: e.geometry,
            properties: {
                id: e.id,
                source: e.source,
                selected: e.id === selectedFeatureId,
            },
        };
    });
    map.getSource("draw-polygon").setData({ type: "FeatureCollection", features: feats });
    syncSelectedVertices();
}

function syncSelectedVertices() {
    if (!map.getSource("draw-points")) return;
    var pts = [];
    if (selectedFeatureId && drawPoints.length) {
        for (var i = 0; i < drawPoints.length; i++) {
            pts.push({ type: "Feature", geometry: { type: "Point", coordinates: drawPoints[i] }, properties: { idx: i } });
        }
    }
    map.getSource("draw-points").setData({ type: "FeatureCollection", features: pts });
}

function selectFeature(id) {
    // Don't let selection clobber an in-progress draw/rect — bail to a clean
    // state first so drawPoints isn't repurposed mid-gesture.
    if (drawingMode) cancelDrawing();
    if (rectMode) cancelRect();
    var entry = getGeomEntry(id);
    if (!entry || entry.geometry.type !== "Polygon") {
        // only Polygons editable via vertex drag; just highlight if not editable
        selectedFeatureId = entry ? id : null;
        drawPoints = [];
        syncCollectionToMap();
        return;
    }
    selectedFeatureId = id;
    var ring = entry.geometry.coordinates[0] || [];
    var trimEnd = ring.length > 1 && coordsEqual(ring[0], ring[ring.length - 1]) ? ring.length - 1 : ring.length;
    drawPoints = ring.slice(0, trimEnd);
    syncCollectionToMap();
}

function deselectFeature() {
    if (!selectedFeatureId) return;
    selectedFeatureId = null;
    drawPoints = [];
    syncCollectionToMap();
}

function coordsEqual(a, b) {
    return a && b && Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
}

function commitSelectedFromDrawPoints() {
    var entry = getGeomEntry(selectedFeatureId);
    if (!entry || drawPoints.length < 3) return;
    var coords = drawPoints.slice();
    coords.push(coords[0]);
    entry.geometry = { type: "Polygon", coordinates: [coords] };
    syncCollectionToMap();
}

// ── Fill flash on commit ─────────────────────────────

var _traceToken = 0;

function animateOutlineTrace(geom) {
    if (!geom || geom.type !== "Polygon") return;
    var ring = geom.coordinates && geom.coordinates[0];
    if (!ring || ring.length < 4) return;

    var FILL_ID = "draw-trace-fill";
    var SOURCE_ID = "draw-trace";
    var token = ++_traceToken;
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "Feature", geometry: geom, properties: {} },
    });
    map.addLayer({
        id: FILL_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: { "fill-color": "rgba(95,235,155,1)", "fill-opacity": 0 },
    });
    raiseDrawLayers();
    if (map.getLayer(FILL_ID)) map.moveLayer(FILL_ID);

    var DURATION = 700;
    var FILL_PEAK = 0.22;
    var startTime = performance.now();

    function tick(now) {
        if (token !== _traceToken) return;
        if (!map.getLayer(FILL_ID)) return;
        var t = Math.min(1, (now - startTime) / DURATION);
        // Ramp up to peak around t=0.35, ease back to 0.
        var fillT = t < 0.35 ? (t / 0.35) : Math.max(0, 1 - (t - 0.35) / 0.65);
        map.setPaintProperty(FILL_ID, "fill-opacity", FILL_PEAK * fillT);
        if (t < 1) {
            requestAnimationFrame(tick);
        } else {
            if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
            if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        }
    }
    requestAnimationFrame(tick);
}

// ── In-progress draw rendering (polygon being clicked) ───

function syncInProgress() {
    if (!map.getSource("draw-inprogress")) return;
    var features = [];
    if (drawingMode) {
        if (drawPoints.length >= 3) {
            var coords = drawPoints.slice();
            coords.push(coords[0]);
            features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} });
        } else if (drawPoints.length >= 2) {
            features.push({ type: "Feature", geometry: { type: "LineString", coordinates: drawPoints }, properties: {} });
        }
    }
    map.getSource("draw-inprogress").setData({ type: "FeatureCollection", features: features });
    if (drawingMode) {
        // Show the clicked vertices as the user builds the polygon.
        var pts = drawPoints.map(function (p, i) {
            return { type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { idx: i } };
        });
        if (map.getSource("draw-points")) {
            map.getSource("draw-points").setData({ type: "FeatureCollection", features: pts });
        }
    }
}

// ── Polygon drawing ──────────────────────────────────

function startDrawing() {
    if (drawingMode) {
        if (drawPoints.length >= 3) finishDrawing();
        else cancelDrawing();
        return;
    }
    if (rectMode) cancelRect();
    deselectFeature();
    drawingMode = true;
    drawPoints = [];
    map.dragPan.disable();
    map.doubleClickZoom.disable();
    map.getCanvas().style.setProperty("cursor", "crosshair", "important");
    document.getElementById("draw-polygon-btn").classList.add("active");
    _updatePolygonBtnState();
    syncInProgress();
}

function cancelDrawing() {
    drawingMode = false;
    drawPoints = [];
    map.dragPan.enable();
    map.doubleClickZoom.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    document.getElementById("draw-polygon-btn").classList.remove("active");
    _updatePolygonBtnState();
    syncInProgress();
    syncSelectedVertices();
}

function finishDrawing() {
    if (!drawingMode) return;
    drawingMode = false;
    map.dragPan.enable();
    map.doubleClickZoom.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    var btn = document.getElementById("draw-polygon-btn");
    btn.classList.remove("active");
    if (drawPoints.length >= 3) {
        var coords = drawPoints.slice();
        coords.push(coords[0]);
        var geom = { type: "Polygon", coordinates: [coords] };
        drawPoints = [];
        syncInProgress();
        syncSelectedVertices();
        addFeature(geom, "drawn");
        animateOutlineTrace(geom);
        // Brief success animation on the polygon button before reverting to neutral.
        btn.classList.remove("draw-btn-finish", "draw-btn-cancel");
        btn.classList.add("draw-btn-success");
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12 l4 4 l10-10"/></svg>';
        setTimeout(function () {
            btn.classList.remove("draw-btn-success");
            // textContent (set by _updatePolygonBtnState) replaces the SVG.
            _updatePolygonBtnState();
        }, 700);
    } else {
        drawPoints = [];
        syncInProgress();
        syncSelectedVertices();
        _updatePolygonBtnState();
    }
}

// ── Rectangle drawing (drag) ─────────────────────────

var rectMode = false;
var rectStart = null;

function startRectangle() {
    if (rectMode) {
        cancelRect();
        return;
    }
    if (drawingMode) finishDrawing();
    deselectFeature();
    rectMode = true;
    rectStart = null;
    map.dragPan.disable();
    map.getCanvas().style.setProperty("cursor", "crosshair", "important");
    document.getElementById("draw-rect-btn").classList.add("active");
}

function cancelRect() {
    rectMode = false;
    rectStart = null;
    map.dragPan.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    document.getElementById("draw-rect-btn").classList.remove("active");
    if (map.getSource("draw-inprogress")) {
        map.getSource("draw-inprogress").setData({ type: "FeatureCollection", features: [] });
    }
}

function finishRect(start, end) {
    rectMode = false;
    rectStart = null;
    map.dragPan.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    document.getElementById("draw-rect-btn").classList.remove("active");
    var coords = [
        [start.lng, start.lat],
        [end.lng, start.lat],
        [end.lng, end.lat],
        [start.lng, end.lat],
        [start.lng, start.lat],
    ];
    if (map.getSource("draw-inprogress")) {
        map.getSource("draw-inprogress").setData({ type: "FeatureCollection", features: [] });
    }
    var geom = { type: "Polygon", coordinates: [coords] };
    addFeature(geom, "drawn");
    animateOutlineTrace(geom);
}

map.on("mousedown", function (e) {
    if (!rectMode) return;
    rectStart = e.lngLat;
});

map.on("mousemove", function (e) {
    if (!rectMode || !rectStart) return;
    var s = rectStart;
    var c = e.lngLat;
    var coords = [
        [s.lng, s.lat], [c.lng, s.lat], [c.lng, c.lat], [s.lng, c.lat], [s.lng, s.lat]
    ];
    if (map.getSource("draw-inprogress")) {
        map.getSource("draw-inprogress").setData({
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} }]
        });
    }
});

map.on("mouseup", function (e) {
    if (!rectMode || !rectStart) return;
    if (Math.abs(e.lngLat.lng - rectStart.lng) > 0.001 || Math.abs(e.lngLat.lat - rectStart.lat) > 0.001) {
        finishRect(rectStart, e.lngLat);
    } else {
        rectStart = null; // click too small, reset
    }
});

function raiseDrawLayers() {
    ["draw-fill", "draw-line", "draw-inprogress-fill", "draw-inprogress-line", "draw-vertices"].forEach(function (id) {
        if (map.getLayer(id)) map.moveLayer(id);
    });
}

map.on("load", function () {
    map.addSource("draw-polygon", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("draw-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("draw-inprogress", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    map.addLayer({
        id: "draw-fill", type: "fill", source: "draw-polygon",
        paint: {
            "fill-color": FILL_COLOR_EXPR,
            "fill-opacity": ["case", ["==", ["get", "selected"], true], DRAW_FILL_OPACITY_SELECTED, DRAW_FILL_OPACITY],
        },
    });
    map.addLayer({
        id: "draw-line", type: "line", source: "draw-polygon",
        paint: {
            "line-color": LINE_COLOR_EXPR,
            "line-width": ["case", ["==", ["get", "selected"], true], 3, 2],
        },
    });

    map.addLayer({
        id: "draw-inprogress-fill", type: "fill", source: "draw-inprogress",
        paint: { "fill-color": "rgba(100,140,255,0.15)", "fill-opacity": 1 },
    });
    map.addLayer({
        id: "draw-inprogress-line", type: "line", source: "draw-inprogress",
        paint: { "line-color": "rgba(100,140,255,0.9)", "line-width": 2, "line-dasharray": [3, 2] },
    });

    map.addLayer({
        id: "draw-vertices", type: "circle", source: "draw-points",
        paint: { "circle-radius": 4, "circle-color": "rgba(100,140,255,1)", "circle-stroke-color": "white", "circle-stroke-width": 1.5 },
    });
});

function segmentsIntersect(a1, a2, b1, b2) {
    var d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
    var d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
    var cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-12) return false;
    var dx = b1[0] - a1[0], dy = b1[1] - a1[1];
    var t = (dx * d2y - dy * d2x) / cross;
    var u = (dx * d1y - dy * d1x) / cross;
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

function wouldSelfIntersect(points, newPoint) {
    if (points.length < 2) return false;
    var newEdge = [points[points.length - 1], newPoint];
    for (var i = 0; i < points.length - 1; i++) {
        if (segmentsIntersect(newEdge[0], newEdge[1], points[i], points[i + 1])) return true;
    }
    return false;
}

function polygonSelfIntersects(points) {
    // Check all edge pairs in a closed polygon
    if (points.length < 3) return false;
    var n = points.length;
    for (var i = 0; i < n; i++) {
        var a1 = points[i];
        var a2 = points[(i + 1) % n];
        for (var j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue; // adjacent (closing edge)
            var b1 = points[j];
            var b2 = points[(j + 1) % n];
            if (segmentsIntersect(a1, a2, b1, b2)) return true;
        }
    }
    return false;
}

map.on("click", function (e) {
    if (!drawingMode) return;
    var pt = [e.lngLat.lng, e.lngLat.lat];
    if (wouldSelfIntersect(drawPoints, pt)) {
        showToast("Polygon edges cannot cross");
        return;
    }
    drawPoints.push(pt);
    syncInProgress();
    _updatePolygonBtnState();
});

map.on("dblclick", function (e) {
    if (!drawingMode) return;
    e.preventDefault();
    // Check if closing edge would self-intersect
    if (drawPoints.length >= 3 && wouldSelfIntersect(drawPoints, drawPoints[0])) {
        showToast("Polygon edges cannot cross");
        return;
    }
    finishDrawing();
});

// ── Feature selection on map click ────────────────────

map.on("click", "draw-fill", function (e) {
    if (drawingMode || rectMode || draggingVertex >= 0) return;
    if (!e.features || !e.features.length) return;
    var f = e.features[0];
    var id = f.properties && f.properties.id;
    if (id && id !== selectedFeatureId) {
        selectFeature(id);
    }
});

// Click on empty map area deselects (but not when rectangle/draw is active or
// when the click landed on an editable feature). Run after the layer-scoped
// click above so layer hits are handled first.
map.on("click", function (e) {
    if (drawingMode || rectMode || draggingVertex >= 0) return;
    if (!selectedFeatureId) return;
    var hit = map.queryRenderedFeatures(e.point, { layers: ["draw-fill"] });
    if (!hit.length) deselectFeature();
});

// Delete/Backspace removes the currently selected feature.
document.addEventListener("keydown", function (e) {
    if (!selectedFeatureId) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    e.preventDefault();
    removeFeature(selectedFeatureId);
});

// ── Vertex editing (drag to move) ─────────────────────

var draggingVertex = -1;
var dragOriginalPos = null;
var VERTEX_HIT_PX = 20;

function nearestVertex(point) {
    var best = -1;
    var bestDist = VERTEX_HIT_PX * VERTEX_HIT_PX;
    for (var i = 0; i < drawPoints.length; i++) {
        var screen = map.project(drawPoints[i]);
        var dx = screen.x - point.x;
        var dy = screen.y - point.y;
        var dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

map.on("mousedown", function (e) {
    if (drawingMode || rectMode) return;
    if (!selectedFeatureId || drawPoints.length < 3) return;
    var idx = nearestVertex(e.point);
    if (idx < 0) return;
    draggingVertex = idx;
    dragOriginalPos = drawPoints[idx].slice();
    map.dragPan.disable();
    map.getCanvas().style.setProperty("cursor", "grabbing", "important");
    e.preventDefault();
});

map.on("mousemove", function (e) {
    if (draggingVertex < 0) return;
    var newPos = [e.lngLat.lng, e.lngLat.lat];
    var oldPos = drawPoints[draggingVertex];
    drawPoints[draggingVertex] = newPos;
    if (polygonSelfIntersects(drawPoints)) {
        drawPoints[draggingVertex] = oldPos;
        return;
    }
    syncSelectedVertices();
    commitSelectedFromDrawPoints();
});

map.on("mouseup", function (e) {
    if (draggingVertex < 0) return;
    draggingVertex = -1;
    map.dragPan.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    commitSelectedFromDrawPoints();
});

// Show grab cursor on vertex hover
map.on("mousemove", function (e) {
    if (drawingMode || rectMode || draggingVertex >= 0) return;
    if (!selectedFeatureId || drawPoints.length < 3) return;
    if (nearestVertex(e.point) >= 0) {
        map.getCanvas().style.setProperty("cursor", "grab", "important");
    } else {
        map.getCanvas().style.setProperty("cursor", "", "");
    }
});

// ── Cursor coordinates ───────────────────────────────

var barCoords = document.getElementById("bar-coords");

map.on("mousemove", function (e) {
    barCoords.textContent = e.lngLat.lat.toFixed(4) + ", " + e.lngLat.lng.toFixed(4);
});

// ── Lat/long gridlines ───────────────────────────────

var gridColorIndex = 0;
var gridWeight = 0.5;
var gridColor = "rgba(255,255,255,0.25)";
var gridLabelColor = "rgba(255,255,255,0.4)";
var gridVisible = false;

var gridColors = [
    { name: "White", line: "rgba(255,255,255,0.25)", label: "rgba(255,255,255,0.4)" },
    { name: "Black", line: "rgba(0,0,0,0.3)", label: "rgba(0,0,0,0.5)" },
    { name: "Blue", line: "rgba(100,140,255,0.3)", label: "rgba(100,140,255,0.5)" },
    { name: "Red", line: "rgba(220,60,60,0.3)", label: "rgba(220,60,60,0.5)" },
];

function buildGridGeoJSON() {
    var features = [];
    for (var lat = -80; lat <= 80; lat += 10) {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] }, properties: { label: lat + "°" } });
    }
    for (var lng = -180; lng <= 180; lng += 10) {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lng, -85], [lng, 85]] }, properties: { label: lng + "°" } });
    }
    return { type: "FeatureCollection", features: features };
}

function addGridToMap() {
    if (map.getSource("grid")) return;
    map.addSource("grid", { type: "geojson", data: buildGridGeoJSON() });
    map.addLayer({ id: "grid-lines", type: "line", source: "grid", paint: { "line-color": gridColor, "line-width": gridWeight } });
}

function removeGridFromMap() {
    if (map.getLayer("grid-lines")) map.removeLayer("grid-lines");
    if (map.getSource("grid")) map.removeSource("grid");
}

function setGridWeight(val) {
    gridWeight = val;
    if (map.getLayer("grid-lines")) map.setPaintProperty("grid-lines", "line-width", gridWeight);
}

function setGridColor(idx) {
    gridColorIndex = idx;
    gridColor = gridColors[idx].line;
    gridLabelColor = gridColors[idx].label;
    if (gridVisible) {
        removeGridFromMap();
        addGridToMap();
    } else {
        gridVisible = true;
        addGridToMap();
    }
    document.getElementById("toolbar-grid").classList.add("toolbar-active");
}

function gridOff() {
    if (gridVisible) {
        gridVisible = false;
        removeGridFromMap();
        document.getElementById("toolbar-grid").classList.remove("toolbar-active");
    }
}

// ── UTM zone dividers ────────────────────────────────

var utmColorIndex = 0;
var utmWeight = 1;
var utmColor = "rgba(255,180,50,0.3)";
var utmLabelColor = "rgba(255,180,50,0.5)";
var utmVisible = false;

var utmColors = [
    { name: "Amber", line: "rgba(255,180,50,0.3)", label: "rgba(255,180,50,0.5)" },
    { name: "White", line: "rgba(255,255,255,0.25)", label: "rgba(255,255,255,0.4)" },
    { name: "Black", line: "rgba(0,0,0,0.3)", label: "rgba(0,0,0,0.5)" },
    { name: "Green", line: "rgba(100,190,140,0.3)", label: "rgba(100,190,140,0.5)" },
];

function buildUtmGeoJSON() {
    var features = [];
    for (var zone = 1; zone <= 60; zone++) {
        var lng = -180 + (zone - 1) * 6;
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lng, -80], [lng, 84]] }, properties: { label: String(zone) } });
    }
    return { type: "FeatureCollection", features: features };
}

function addUtmToMap() {
    if (map.getSource("utm")) return;
    map.addSource("utm", { type: "geojson", data: buildUtmGeoJSON() });
    map.addLayer({ id: "utm-lines", type: "line", source: "utm", paint: { "line-color": utmColor, "line-width": utmWeight, "line-dasharray": [4, 4] } });
}

function removeUtmFromMap() {
    if (map.getLayer("utm-lines")) map.removeLayer("utm-lines");
    if (map.getSource("utm")) map.removeSource("utm");
}

function setUtmWeight(val) {
    utmWeight = val;
    if (map.getLayer("utm-lines")) map.setPaintProperty("utm-lines", "line-width", utmWeight);
}

function setUtmColor(idx) {
    utmColorIndex = idx;
    utmColor = utmColors[idx].line;
    utmLabelColor = utmColors[idx].label;
    if (utmVisible) {
        removeUtmFromMap();
        addUtmToMap();
    } else {
        utmVisible = true;
        addUtmToMap();
    }
    document.getElementById("toolbar-utm").classList.add("toolbar-active");
}

function utmOff() {
    if (utmVisible) {
        utmVisible = false;
        removeUtmFromMap();
        document.getElementById("toolbar-utm").classList.remove("toolbar-active");
    }
}

// ── Map toolbar ──────────────────────────────────────

var ToolbarControl = {
    onAdd: function () {
        var div = document.createElement("div");
        div.className = "map-toolbar maplibregl-ctrl";
        div.innerHTML =
            '<a class="toolbar-btn" id="toolbar-basemap" href="#" onclick="event.preventDefault();toggleBasemapMenu()" title="Basemap">◫</a>' +
            '<a class="toolbar-btn" id="toolbar-grid" href="#" onclick="event.preventDefault();toggleGridMenu()" title="Lat/long grid">#</a>' +
            '<a class="toolbar-btn" id="toolbar-utm" href="#" onclick="event.preventDefault();toggleUtmMenu()" title="UTM zones">▮</a>' +
            '<a class="toolbar-btn toolbar-btn-text" id="toolbar-wmts" href="#" onclick="event.preventDefault();toggleWmtsMenu()" title="BlueTopo WMTS Tiles">BT</a>' +
            '<a class="toolbar-btn" id="toolbar-version" href="#" onclick="event.preventDefault();toggleVersionMenu()" title="Version">⚙</a>' +
            '<div class="toolbar-menu" id="basemap-menu"></div>' +
            '<div class="toolbar-menu" id="grid-menu"></div>' +
            '<div class="toolbar-menu" id="utm-menu"></div>' +
            '<div class="toolbar-menu" id="wmts-menu"></div>' +
            '<div class="toolbar-menu" id="version-menu"></div>';
        return div;
    },
    onRemove: function () {}
};
map.addControl(ToolbarControl, "top-left");

function closeAllMenus() {
    ["basemap-menu", "grid-menu", "utm-menu", "wmts-menu", "version-menu"].forEach(function (id) {
        var m = document.getElementById(id);
        if (m) m.style.display = "none";
    });
}

function getCreditsHtml() {
    return '<div class="credits-section-label">Basemaps</div>' +
        '© <a href="https://carto.com/" target="_blank">CARTO</a><br>' +
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' +
        '<div class="credits-sep"></div>' +
        '<div class="credits-section-label">Data</div>' +
        'Compiled by <a href="https://nauticalcharts.noaa.gov/learn/nbs.html" target="_blank">NBS</a>';
}

function toggleCreditsMenu() {
    var menu = document.getElementById("credits-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = '<div class="toolbar-menu-credits">' + getCreditsHtml() + '</div>';
    menu.style.display = "block";
}

var _cachedUpdates = null;
var _isReturningUser = false;
var _recentsLoaded = false;
var _updateToastShown = false;

function _maybeShowUpdateToast() {
    if (_updateToastShown || !_recentsLoaded || !_cachedUpdates) return;
    if (!_cachedUpdates.ui.update_available) return;
    _updateToastShown = true;
    var _show = function () {
        showToast({ icon: "↑", title: "New App Update", body: "noaabathymetry-ui v" + _cachedUpdates.ui.latest + " is available. <a href='https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases' target='_blank' style='color:var(--accent)'>View release</a>" }, "toast-welcome");
    };
    if (_isReturningUser) {
        setTimeout(_show, 22000);
    } else {
        _show();
    }
}

function _renderVersionMenu(versions) {
    var html = '<div class="toolbar-menu-credits">';
    html += '<div class="credits-section-label">Versions</div>';
    html += '<div class="version-row"><a href="https://github.com/noaa-ocs-hydrography/noaabathymetry-ui" target="_blank" class="version-link">noaabathymetry-ui</a> <span class="version-tag">' + (versions.ui === "unknown" ? "unknown" : "v" + versions.ui) + '</span></div>';
    if (!_cachedUpdates) {
        html += '<div class="version-check-failed">Checking...</div>';
    } else if (_cachedUpdates.ui.update_available) {
        html += '<div class="version-update"><a href="https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases" target="_blank">Update available: v' + _cachedUpdates.ui.latest + '</a></div>';
    } else if (_cachedUpdates.ui.update_available === null) {
        html += '<div class="version-check-failed">Could not check for updates</div>';
    } else {
        html += '<div class="version-up-to-date">Up to date</div>';
    }
    html += '<div class="version-row"><a href="https://github.com/noaa-ocs-hydrography/noaabathymetry" target="_blank" class="version-link">noaabathymetry</a> <span class="version-tag">' + (versions.library === "unknown" ? "unknown" : "v" + versions.library) + '</span></div>';
    if (!_cachedUpdates) {
        html += '<div class="version-check-failed">Checking...</div>';
    } else if (_cachedUpdates.library.update_available) {
        html += '<div class="version-update">Latest available: v' + _cachedUpdates.library.latest + '</div>';
    } else if (_cachedUpdates.library.update_available === null) {
        html += '<div class="version-check-failed">Could not check for updates</div>';
    } else {
        html += '<div class="version-up-to-date">Up to date</div>';
    }
    html += '</div>';
    return html;
}

var _cachedVersions = null;

function toggleVersionMenu() {
    var menu = document.getElementById("version-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    if (_cachedVersions) {
        menu.innerHTML = _renderVersionMenu(_cachedVersions);
    } else {
        menu.innerHTML = '<div class="toolbar-menu-credits">Loading...</div>';
        bridge.get_versions(function (resp) {
            _cachedVersions = JSON.parse(resp);
            if (menu.style.display === "block") {
                menu.innerHTML = _renderVersionMenu(_cachedVersions);
            }
        });
    }
    menu.style.display = "block";
}

function _checkUpdatesOnStartup() {
    if (!bridge) return;
    bridge.get_versions(function (resp) {
        _cachedVersions = JSON.parse(resp);
    });
    bridge.check_updates(function (resp) {
        _cachedUpdates = JSON.parse(resp);
        if (_cachedUpdates.ui.update_available || _cachedUpdates.library.update_available) {
            document.getElementById("toolbar-version").classList.add("version-has-update");
        }
        _maybeShowUpdateToast();
        // Refresh menu if it's currently open
        var menu = document.getElementById("version-menu");
        if (menu && menu.style.display === "block" && _cachedVersions) {
            menu.innerHTML = _renderVersionMenu(_cachedVersions);
        }
    });
}

function toggleBasemapMenu() {
    var menu = document.getElementById("basemap-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = "";
    basemapNames.forEach(function (name, i) {
        var item = document.createElement("div");
        item.className = "toolbar-menu-item" + (i === basemapIndex ? " active" : "");
        item.textContent = name;
        item.onclick = function () {
            setBasemap(i);
            menu.querySelectorAll(".toolbar-menu-item").forEach(function (el) { el.classList.remove("active"); });
            item.classList.add("active");
        };
        menu.appendChild(item);
    });
    var sep = document.createElement("div"); sep.className = "toolbar-menu-sep"; menu.appendChild(sep);
    var credit = document.createElement("div");
    credit.className = "toolbar-menu-credits";
    credit.innerHTML = '<div class="credits-section-label">Basemaps</div>© <a href="https://carto.com/" target="_blank">CARTO</a><br>© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
    menu.appendChild(credit);
    menu.style.display = "block";
}

function toggleGridMenu() {
    var menu = document.getElementById("grid-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = "";
    var header = document.createElement("div"); header.className = "toolbar-menu-header"; header.textContent = "LAT/LON GRID"; menu.appendChild(header);
    gridColors.forEach(function (c, i) {
        var item = document.createElement("div");
        item.className = "toolbar-menu-item" + (gridVisible && i === gridColorIndex ? " active" : "");
        item.innerHTML = "<span class='color-dot' style='background:" + c.line.replace(/0\.\d+\)/, "0.8)") + "'></span>" + c.name;
        item.onclick = function (e) { e.stopPropagation(); setGridColor(i); menu.querySelectorAll(".toolbar-menu-item").forEach(function (el) { el.classList.remove("active"); }); item.classList.add("active"); };
        menu.appendChild(item);
    });
    var sep = document.createElement("div"); sep.className = "toolbar-menu-sep"; menu.appendChild(sep);
    var sliderRow = document.createElement("div");
    sliderRow.className = "toolbar-menu-slider";
    sliderRow.innerHTML = '<input type="range" min="0.5" max="3" step="0.5" value="' + gridWeight + '" oninput="setGridWeight(parseFloat(this.value))">';
    sliderRow.onclick = function (e) { e.stopPropagation(); };
    menu.appendChild(sliderRow);
    var sep2 = document.createElement("div"); sep2.className = "toolbar-menu-sep"; menu.appendChild(sep2);
    var off = document.createElement("div");
    off.className = "toolbar-menu-item" + (!gridVisible ? " active" : "");
    off.textContent = "Off";
    off.onclick = function (e) { e.stopPropagation(); gridOff(); menu.style.display = "none"; };
    menu.appendChild(off);
    menu.style.display = "block";
}

function toggleUtmMenu() {
    var menu = document.getElementById("utm-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = "";
    var header = document.createElement("div"); header.className = "toolbar-menu-header"; header.textContent = "UTM GRID"; menu.appendChild(header);
    utmColors.forEach(function (c, i) {
        var item = document.createElement("div");
        item.className = "toolbar-menu-item" + (utmVisible && i === utmColorIndex ? " active" : "");
        item.innerHTML = "<span class='color-dot' style='background:" + c.line.replace(/0\.\d+\)/, "0.8)") + "'></span>" + c.name;
        item.onclick = function (e) { e.stopPropagation(); setUtmColor(i); menu.querySelectorAll(".toolbar-menu-item").forEach(function (el) { el.classList.remove("active"); }); item.classList.add("active"); };
        menu.appendChild(item);
    });
    var sep = document.createElement("div"); sep.className = "toolbar-menu-sep"; menu.appendChild(sep);
    var sliderRow = document.createElement("div");
    sliderRow.className = "toolbar-menu-slider";
    sliderRow.innerHTML = '<input type="range" min="0.5" max="3" step="0.5" value="' + utmWeight + '" oninput="setUtmWeight(parseFloat(this.value))">';
    sliderRow.onclick = function (e) { e.stopPropagation(); };
    menu.appendChild(sliderRow);
    var sep2 = document.createElement("div"); sep2.className = "toolbar-menu-sep"; menu.appendChild(sep2);
    var off = document.createElement("div");
    off.className = "toolbar-menu-item" + (!utmVisible ? " active" : "");
    off.textContent = "Off";
    off.onclick = function (e) { e.stopPropagation(); utmOff(); menu.style.display = "none"; };
    menu.appendChild(off);
    menu.style.display = "block";
}

// ── WMTS overlays (nowCOAST) ─────────────────────────

var wmtsOverlayActive = false;

function wmtsUrl(layer) {
    return "https://nowcoast.noaa.gov/geoserver/gwc/service/wmts" +
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=" + encodeURIComponent(layer) +
        "&STYLE=&FORMAT=image/png8" +
        "&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}";
}

function setWmtsOverlay(on) {
    var btn = document.getElementById("toolbar-wmts");
    if (on && !wmtsOverlayActive) {
        var firstVector = null;
        var layers = map.getStyle().layers;
        for (var i = 0; i < layers.length; i++) {
            if (layers[i].id.indexOf("remote") === 0 || layers[i].id.indexOf("tracked") === 0 || layers[i].id.indexOf("draw") === 0) {
                firstVector = layers[i].id;
                break;
            }
        }
        map.addSource("wmts-hillshade", { type: "raster", tiles: [wmtsUrl("bluetopo:hillshade")], tileSize: 256, attribution: 'WMTS served by <a href="https://nauticalcharts.noaa.gov/learn/nowcoast.html" target="_blank">nowCOAST</a>' });
        map.addLayer({ id: "wmts-hillshade", type: "raster", source: "wmts-hillshade", paint: { "raster-opacity": 1 } }, firstVector);
        map.addSource("wmts-bathymetry", { type: "raster", tiles: [wmtsUrl("bluetopo:bathymetry")], tileSize: 256 });
        map.addLayer({ id: "wmts-bathymetry", type: "raster", source: "wmts-bathymetry", paint: { "raster-opacity": 0.7 } }, firstVector);
        wmtsOverlayActive = true;
        btn.classList.add("toolbar-active");
    } else if (!on && wmtsOverlayActive) {
        ["wmts-bathymetry", "wmts-hillshade"].forEach(function (id) {
            if (map.getLayer(id)) map.removeLayer(id);
            if (map.getSource(id)) map.removeSource(id);
        });
        wmtsOverlayActive = false;
        btn.classList.remove("toolbar-active");
    }
}

function toggleWmtsMenu() {
    var menu = document.getElementById("wmts-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = "";
    var row = document.createElement("div");
    row.className = "toolbar-menu-toggle";
    row.innerHTML = '<span class="wmts-label' + (wmtsOverlayActive ? ' wmts-label-on' : '') + '" id="wmts-label">BlueTopo</span><span class="switch wmts-switch' + (wmtsOverlayActive ? ' on' : '') + '" id="wmts-switch"><span class="switch-knob"></span></span>';
    row.onclick = function (e) {
        e.stopPropagation();
        setWmtsOverlay(!wmtsOverlayActive);
        document.getElementById("wmts-switch").classList.toggle("on", wmtsOverlayActive);
        document.getElementById("wmts-label").classList.toggle("wmts-label-on", wmtsOverlayActive);
    };
    menu.appendChild(row);
    var sep = document.createElement("div"); sep.className = "toolbar-menu-sep"; menu.appendChild(sep);
    var credit = document.createElement("div");
    credit.className = "toolbar-menu-credits";
    credit.innerHTML = '<div class="credits-section-label">WMTS</div>Served by <a href="https://nauticalcharts.noaa.gov/learn/nowcoast.html" target="_blank">nowCOAST</a>';
    menu.appendChild(credit);
    menu.style.display = "block";
}

document.addEventListener("click", function (e) {
    if (!e.target.closest(".map-toolbar")) closeAllMenus();
});

// ── Layer toggle control ─────────────────────────────

var legendPanel = document.createElement("div");
legendPanel.className = "legend-panel";
legendPanel.innerHTML =
    '<div id="legend-content"></div>' +
    '<div class="layers-section">' +
    '<div class="layers-title">Layers</div>' +
    '<div class="layers-row">' +
    '<div class="layers-item">' +
    '<button id="btn-layer-remote" class="layers-btn" onclick="toggleRemoteLayer()" title="What\'s available on NBS?">' +
    '<span class="layer-dot remote"></span>NBS Source</button>' +
    '<button id="btn-remote-fill" class="layers-fill-btn fill-on" onclick="event.stopPropagation();toggleRemoteFill()" title="Toggle fill">' +
    '<svg class="fill-icon" viewBox="0 0 12 12" aria-hidden="true"><rect class="fill-bg" x="0.75" y="0.75" width="10.5" height="10.5" rx="2"/><rect class="fill-frame" x="0.75" y="0.75" width="10.5" height="10.5" rx="2" pathLength="40"/></svg></button>' +
    '<button class="layers-res-btn" onclick="event.stopPropagation();toggleResFlyout(\'remote\',this)" title="Display options"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h6M13 6h8M3 12h2M9 12h12M3 18h12M19 18h2"/><circle cx="11" cy="6" r="2" fill="currentColor"/><circle cx="7" cy="12" r="2" fill="currentColor"/><circle cx="17" cy="18" r="2" fill="currentColor"/></svg></button>' +
    '<div id="res-flyout-remote" class="res-flyout" style="display:none"></div></div>' +
    '<div class="layers-item">' +
    '<button id="btn-layer-tracked" class="layers-btn" onclick="toggleTrackedLayer()" title="What\'s the status of your tiles?">' +
    '<span class="layer-dot tracked"></span>Your Project</button>' +
    '<button id="btn-tracked-fill" class="layers-fill-btn fill-on" onclick="event.stopPropagation();toggleTrackedFill()" title="Toggle fill">' +
    '<svg class="fill-icon" viewBox="0 0 12 12" aria-hidden="true"><rect class="fill-bg" x="0.75" y="0.75" width="10.5" height="10.5" rx="2"/><rect class="fill-frame" x="0.75" y="0.75" width="10.5" height="10.5" rx="2" pathLength="40"/></svg></button>' +
    '<button class="layers-res-btn" onclick="event.stopPropagation();toggleResFlyout(\'tracked\',this)" title="Display options"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h6M13 6h8M3 12h2M9 12h12M3 18h12M19 18h2"/><circle cx="11" cy="6" r="2" fill="currentColor"/><circle cx="7" cy="12" r="2" fill="currentColor"/><circle cx="17" cy="18" r="2" fill="currentColor"/></svg></button>' +
    '<div id="res-flyout-tracked" class="res-flyout" style="display:none"></div></div>' +
    '</div></div>';
document.getElementById("map").appendChild(legendPanel);

// ── Tile scheme layers ───────────────────────────────

function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

function buildPopupHtml(props) {
    var rows = "";
    for (var key in props) {
        if (props[key] == null) continue;
        rows += "<tr><td class='popup-key'>" + escapeHtml(String(key)) + "</td><td class='popup-val'>" + escapeHtml(String(props[key])) + "</td></tr>";
    }
    return rows ? "<table class='popup-table'>" + rows + "</table>" : "";
}

// ── Age-based styling ────────────────────────────────

var PALETTES = {
    magma: {
        colors: [[252,253,191],[254,180,123],[244,105,92],[171,51,124],[106,28,129],[41,17,90],[0,0,4]],
        null: [170,170,170]
    },
    forest: {
        colors: [[140,220,100],[90,185,65],[50,145,40],[30,110,55],[20,80,45],[12,55,30],[5,30,15]],
        null: [170,170,170]
    },
    ice: {
        colors: [[230,255,255],[170,230,240],[110,200,230],[60,155,210],[30,105,175],[15,60,120],[5,25,60]],
        null: [190,195,200]
    },
    slate: {
        colors: [[180,210,235],[130,170,210],[95,130,180],[70,95,150],[55,65,115],[40,40,80],[20,20,45]],
        null: [185,185,195]
    },
    simple: {
        colors: [[255,160,0],[50,210,110],[10,150,60],[70,165,230],[25,100,170],[125,105,80]],
        null: [0,0,0],
        days: [1, 7, 30, 180, 365, Infinity],
        labels: ["\u2264 1 day", "\u2264 1 week", "\u2264 1 month", "\u2264 6 months", "\u2264 1 year", "> 1 year"],
        opacity: [1.0, 0.97, 0.93, 0.9, 0.85, 0.8]
    }
};
var DEFAULT_DAYS = [1, 7, 30, 90, 180, 365, Infinity];
var DEFAULT_LABELS = ["\u2264 1 day", "\u2264 1 week", "\u2264 1 month", "\u2264 3 months", "\u2264 6 months", "\u2264 1 year", "> 1 year"];
var DEFAULT_OPACITY = [1.0, 0.97, 0.93, 0.9, 0.87, 0.83, 0.8];
var NULL_OPACITY = 0.65;
var currentPalette = "magma";
var remoteFilled = true;
var trackedFilled = true;

function getDateField(props) {
    return props["Delivered_Date"] || props["ISSUANCE"] || null;
}

function ageColor(props) {
    var pal = PALETTES[currentPalette];
    var days = pal.days || DEFAULT_DAYS;
    var opacity = pal.opacity || DEFAULT_OPACITY;
    var dateStr = getDateField(props);
    if (!dateStr) return { color: pal.null, opacity: NULL_OPACITY };
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return { color: pal.null, opacity: NULL_OPACITY };
    var ageDays = (Date.now() - date.getTime()) / 86400000;
    for (var i = 0; i < days.length; i++) {
        if (ageDays <= days[i]) return { color: pal.colors[i], opacity: opacity[i] };
    }
    return { color: pal.colors[pal.colors.length - 1], opacity: opacity[opacity.length - 1] };
}

function colorFeatures(geojson) {
    if (!geojson || !geojson.features) return geojson;
    geojson.features.forEach(function (f) {
        var a = ageColor(f.properties);
        f.properties._color = "rgb(" + a.color[0] + "," + a.color[1] + "," + a.color[2] + ")";
        f.properties._opacity = a.opacity;
    });
    return geojson;
}

var TRACKED_COLORS = {
    up_to_date: "rgb(34,197,94)",
    updates_available: "rgb(249,115,22)",
    missing_from_disk: "rgb(239,68,68)",
    removed_from_nbs: "rgb(160,160,168)",
};

function toggleRemoteFill() {
    remoteFilled = !remoteFilled;
    document.getElementById("btn-remote-fill").classList.toggle("fill-on", remoteFilled);
    if (map.getLayer("remote-fill")) map.setPaintProperty("remote-fill", "fill-opacity", remoteFilled ? ["get", "_opacity"] : 0);
}

function toggleTrackedFill() {
    trackedFilled = !trackedFilled;
    document.getElementById("btn-tracked-fill").classList.toggle("fill-on", trackedFilled);
    ["up_to_date", "updates_available", "missing_from_disk", "removed_from_nbs"].forEach(function (cat) {
        if (map.getLayer("tracked-" + cat + "-fill")) map.setPaintProperty("tracked-" + cat + "-fill", "fill-opacity", trackedFilled ? 1 : 0);
    });
}

// ── Resolution filter ─────────────────────────────────

// Resolution filter state: null = show all (no filter active)
// When active: { resolutions: Set of values, includeNull: boolean }
var remoteResFilter = null;
var trackedResFilter = null;
var remoteAvailableRes = { resolutions: [], hasNull: false };
var trackedAvailableRes = { resolutions: [], hasNull: false };

function extractResolutions(geojson) {
    var resSet = {};
    var hasNull = false;
    if (geojson && geojson.features) {
        geojson.features.forEach(function (f) {
            var r = f.properties.Resolution || f.properties.resolution;
            if (r != null && r !== "Unknown") resSet[String(r)] = true;
            else hasNull = true;
        });
    }
    var sorted = Object.keys(resSet).sort(function (a, b) {
        return parseFloat(a) - parseFloat(b);
    });
    return { resolutions: sorted, hasNull: hasNull };
}

function extractTrackedResolutions(data) {
    var resSet = {};
    var hasNull = false;
    ["up_to_date", "updates_available", "missing_from_disk", "removed_from_nbs"].forEach(function (cat) {
        if (data[cat] && data[cat].features) {
            data[cat].features.forEach(function (f) {
                var r = f.properties.resolution || f.properties.Resolution;
                if (r != null && r !== "Unknown") resSet[String(r)] = true;
                else hasNull = true;
            });
        }
    });
    var sorted = Object.keys(resSet).sort(function (a, b) {
        return parseFloat(a) - parseFloat(b);
    });
    return { resolutions: sorted, hasNull: hasNull };
}

function buildMapFilter(field, filterState) {
    if (!filterState) return null;
    var conditions = [];
    if (filterState.resolutions.size > 0) {
        conditions.push(["in", ["get", field], ["literal", Array.from(filterState.resolutions)]]);
    }
    if (filterState.includeNull) {
        conditions.push(["==", ["get", field], null]);
        conditions.push(["==", ["get", field], "Unknown"]);
    }
    if (conditions.length === 0) return false;
    if (conditions.length === 1) return conditions[0];
    return ["any"].concat(conditions);
}

function closeResFlyouts() {
    document.getElementById("res-flyout-remote").style.display = "none";
    document.getElementById("res-flyout-tracked").style.display = "none";
    document.querySelectorAll(".layers-res-btn").forEach(function (b) { b.classList.remove("res-btn-active"); });
}

function setColormap(name) {
    currentPalette = name;
    if (remoteActive && remoteDisplayData) {
        colorFeatures(remoteDisplayData);
        addRemoteToMap(remoteDisplayData);
    }
    updateLegend();
    // Update active state in flyout
    var items = document.querySelectorAll("#res-flyout-remote .cmap-flyout-item");
    items.forEach(function (el) {
        el.classList.toggle("cmap-flyout-active", el.textContent.toLowerCase() === name);
    });
}

function reconcileResFilter(filterState, oldAvail, newAvail) {
    if (!filterState) return null;
    // New resolutions default to visible
    newAvail.resolutions.forEach(function (r) {
        if (oldAvail.resolutions.indexOf(r) < 0) filterState.resolutions.add(r);
    });
    // Remove stale resolutions
    filterState.resolutions.forEach(function (r) {
        if (newAvail.resolutions.indexOf(r) < 0) filterState.resolutions.delete(r);
    });
    // Null: show by default if newly appearing
    if (newAvail.hasNull && !oldAvail.hasNull) filterState.includeNull = true;
    if (!newAvail.hasNull) filterState.includeNull = false;
    // All on → reset to null
    var allResOn = newAvail.resolutions.every(function (r) { return filterState.resolutions.has(r); });
    var allNullOn = !newAvail.hasNull || filterState.includeNull;
    if (allResOn && allNullOn) return null;
    return filterState;
}

function applyRemoteResFilter() {
    var filter = buildMapFilter("Resolution", remoteResFilter);
    if (map.getLayer("remote-fill")) map.setFilter("remote-fill", filter);
    if (map.getLayer("remote-outline")) map.setFilter("remote-outline", filter);
}

function applyTrackedResFilter() {
    var filter = buildMapFilter("resolution", trackedResFilter);
    ["up_to_date", "updates_available", "missing_from_disk", "removed_from_nbs"].forEach(function (cat) {
        if (map.getLayer("tracked-" + cat + "-fill")) map.setFilter("tracked-" + cat + "-fill", filter);
        if (map.getLayer("tracked-" + cat + "-outline")) map.setFilter("tracked-" + cat + "-outline", filter);
    });
}

function toggleResFlyout(layer, btn) {
    var flyout = document.getElementById("res-flyout-" + layer);
    var allBtns = document.querySelectorAll(".layers-res-btn");
    if (flyout.style.display !== "none") {
        flyout.style.display = "none";
        allBtns.forEach(function (b) { b.classList.remove("res-btn-active"); });
        return;
    }
    // Close other flyout
    var other = layer === "remote" ? "tracked" : "remote";
    document.getElementById("res-flyout-" + other).style.display = "none";
    allBtns.forEach(function (b) { b.classList.remove("res-btn-active"); });
    if (btn) btn.classList.add("res-btn-active");

    var available = layer === "remote" ? remoteAvailableRes : trackedAvailableRes;
    var filterState = layer === "remote" ? remoteResFilter : trackedResFilter;
    var hasNull = available.hasNull;
    var resList = available.resolutions;
    if (resList.length === 0 && !hasNull) {
        flyout.innerHTML = '<div class="res-flyout-empty">No data loaded</div>';
        flyout.style.display = "block";
        return;
    }
    var title = layer === "remote" ? "NBS Source" : "Your Project";
    var html = '<div class="res-flyout-title">' + title + '</div>' +
        '<div class="res-flyout-header">Resolution</div>';
    resList.forEach(function (r) {
        var checked = !filterState || filterState.resolutions.has(r);
        html += '<label class="res-flyout-item"><input type="checkbox" ' + (checked ? "checked" : "") +
            ' onchange="toggleResolution(\'' + layer + '\',\'' + escapeHtml(r) + '\',false,this.checked)"> ' + escapeHtml(r) + '</label>';
    });
    if (hasNull) {
        var nullChecked = !filterState || filterState.includeNull;
        html += '<label class="res-flyout-item"><input type="checkbox" ' + (nullChecked ? "checked" : "") +
            ' onchange="toggleResolution(\'' + layer + '\',null,true,this.checked)"> No resolution</label>';
    }
    if (layer === "remote") {
        html += '<div class="res-flyout-divider"></div>';
        html += '<div class="res-flyout-header">Color Map</div>';
        var names = Object.keys(PALETTES);
        names.forEach(function (name) {
            var pal = PALETTES[name];
            var stops = pal.colors.map(function (c, i) {
                return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ") " + Math.round(i / (pal.colors.length - 1) * 100) + "%";
            }).join(",");
            var active = name === currentPalette ? " cmap-flyout-active" : "";
            var label = name.charAt(0).toUpperCase() + name.slice(1);
            html += '<div class="cmap-flyout-item' + active + '" onclick="setColormap(\'' + name + '\')">' +
                '<span class="cmap-swatch" style="background:linear-gradient(to right,' + stops + ')"></span>' +
                label + '</div>';
        });
    }
    flyout.innerHTML = html;
    flyout.style.display = "block";
}

function toggleResolution(layer, res, isNull, on) {
    var available = layer === "remote" ? remoteAvailableRes : trackedAvailableRes;
    var filterState;
    if (layer === "remote") {
        if (!remoteResFilter) remoteResFilter = { resolutions: new Set(available.resolutions), includeNull: available.hasNull };
        filterState = remoteResFilter;
    } else {
        if (!trackedResFilter) trackedResFilter = { resolutions: new Set(available.resolutions), includeNull: available.hasNull };
        filterState = trackedResFilter;
    }
    if (isNull) {
        filterState.includeNull = on;
    } else {
        if (on) filterState.resolutions.add(res); else filterState.resolutions.delete(res);
    }
    // Reset to null (no filter) if everything is selected
    var allResOn = available.resolutions.every(function (r) { return filterState.resolutions.has(r); });
    var allNullOn = !available.hasNull || filterState.includeNull;
    if (allResOn && allNullOn) {
        if (layer === "remote") remoteResFilter = null;
        else trackedResFilter = null;
    }
    if (layer === "remote") applyRemoteResFilter();
    else applyTrackedResFilter();
}

// ── Remote layer ─────────────────────────────────────

function addRemoteToMap(geojson) {
    if (map.getSource("remote")) {
        map.getSource("remote").setData(geojson);
    } else {
        map.addSource("remote", { type: "geojson", data: geojson });
        map.addLayer({ id: "remote-fill", type: "fill", source: "remote", paint: { "fill-color": ["get", "_color"], "fill-opacity": remoteFilled ? ["get", "_opacity"] : 0 } });
        map.addLayer({ id: "remote-outline", type: "line", source: "remote", paint: { "line-color": "rgba(0,0,0,0.3)", "line-width": 1 } });
    }
    var oldAvail = remoteAvailableRes;
    remoteAvailableRes = extractResolutions(geojson);
    remoteResFilter = reconcileResFilter(remoteResFilter, oldAvail, remoteAvailableRes);
    applyRemoteResFilter();
    raiseTrackedLayers();
    raiseDrawLayers();
}

function removeRemoteFromMap() {
    if (map.getLayer("remote-outline")) map.removeLayer("remote-outline");
    if (map.getLayer("remote-fill")) map.removeLayer("remote-fill");
    if (map.getSource("remote")) map.removeSource("remote");
}

// ── Tracked layers ───────────────────────────────────

var trackedCategories = ["up_to_date", "updates_available", "missing_from_disk", "removed_from_nbs"];

function raiseTrackedLayers() {
    // Fills first, then outlines on top
    trackedCategories.forEach(function (cat) {
        var srcId = "tracked-" + cat;
        if (map.getLayer(srcId + "-fill")) map.moveLayer(srcId + "-fill");
    });
    trackedCategories.forEach(function (cat) {
        var srcId = "tracked-" + cat;
        if (map.getLayer(srcId + "-outline")) map.moveLayer(srcId + "-outline");
    });
}

function addTrackedToMap(data) {
    var empty = { type: "FeatureCollection", features: [] };
    // Add all fills first
    trackedCategories.forEach(function (cat) {
        var geojson = data[cat];
        var hasFeatures = geojson && geojson.features.length > 0;
        var srcId = "tracked-" + cat;
        if (!map.getSource(srcId)) {
            if (!hasFeatures) return;
            map.addSource(srcId, { type: "geojson", data: geojson });
            map.addLayer({ id: srcId + "-fill", type: "fill", source: srcId, paint: { "fill-color": TRACKED_COLORS[cat], "fill-opacity": trackedFilled ? 1 : 0 } });
        } else {
            map.getSource(srcId).setData(hasFeatures ? geojson : empty);
        }
    });
    // Then all outlines on top so they're visible above fills
    trackedCategories.forEach(function (cat) {
        var geojson = data[cat];
        if (!geojson || geojson.features.length === 0) return;
        var srcId = "tracked-" + cat;
        if (!map.getLayer(srcId + "-outline")) {
            map.addLayer({ id: srcId + "-outline", type: "line", source: srcId, paint: { "line-color": "rgba(0,0,0,0.3)", "line-width": 1 } });
        }
    });
    var oldAvail = trackedAvailableRes;
    trackedAvailableRes = extractTrackedResolutions(data);
    trackedResFilter = reconcileResFilter(trackedResFilter, oldAvail, trackedAvailableRes);
    applyTrackedResFilter();
    raiseDrawLayers();
}

function removeTrackedFromMap() {
    trackedCategories.forEach(function (cat) {
        var srcId = "tracked-" + cat;
        if (map.getLayer(srcId + "-outline")) map.removeLayer(srcId + "-outline");
        if (map.getLayer(srcId + "-fill")) map.removeLayer(srcId + "-fill");
        if (map.getSource(srcId)) map.removeSource(srcId);
    });
}

// ── Popups ───────────────────────────────────────────

var popup = new maplibregl.Popup({ maxWidth: "360px", className: "dark-popup", closeOnClick: false, closeButton: false });

map.on("click", function (e) {
    if (drawingMode || rectMode) return;
    // Check all clickable layers
    var layers = ["remote-fill"];
    trackedCategories.forEach(function (cat) { layers.push("tracked-" + cat + "-fill"); });
    var existing = layers.filter(function (l) { return map.getLayer(l); });
    if (existing.length === 0) { popup.remove(); return; }
    var features = map.queryRenderedFeatures(e.point, { layers: existing });
    if (features.length === 0) { popup.remove(); return; }
    // Pick the smallest resolution feature (topmost visually)
    var best = features[0];
    if (features.length > 1) {
        var bestRes = Infinity;
        features.forEach(function (f) {
            var r = parseFloat(f.properties.Resolution || f.properties.resolution || "Infinity");
            if (!isNaN(r) && r < bestRes) {
                bestRes = r;
                best = f;
            }
        });
    }
    var props = Object.assign({}, best.properties);
    delete props._color;
    delete props._opacity;
    var html = buildPopupHtml(props);
    if (html) popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
});

// ── WMS query panel (BlueTopo data) ──────────────────

var wmsPanel = document.createElement("div");
wmsPanel.className = "wms-panel";
wmsPanel.style.display = "none";
document.getElementById("map").appendChild(wmsPanel);
var wmsQueryId = 0;

function queryWmsPoint(lngLat) {
    if (!wmtsOverlayActive) return;
    var size = 256;
    var delta = 0.01;
    var bbox = (lngLat.lng - delta) + "," + (lngLat.lat - delta) + "," + (lngLat.lng + delta) + "," + (lngLat.lat + delta);
    var x = Math.round(size / 2);
    var y = Math.round(size / 2);
    var baseParams = "SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo" +
        "&INFO_FORMAT=application/json&SRS=EPSG:4326" +
        "&WIDTH=" + size + "&HEIGHT=" + size +
        "&BBOX=" + bbox + "&X=" + x + "&Y=" + y;
    var bathyUrl = "https://nowcoast.noaa.gov/geoserver/bluetopo/wms?" + baseParams +
        "&LAYERS=bluetopo:bathymetry&QUERY_LAYERS=bluetopo:bathymetry&STYLES=source_survey_id";
    var tileUrl = "https://nowcoast.noaa.gov/geoserver/bluetopo/wms?" + baseParams +
        "&LAYERS=bluetopo:bluetopo_tile_scheme&QUERY_LAYERS=bluetopo:bluetopo_tile_scheme";
    var queryId = ++wmsQueryId;
    wmsPanel.innerHTML = '<div class="wms-loading">Querying...</div>';
    wmsPanel.style.display = "block";
    bridge.wms_query(lngLat.lat, lngLat.lng, function (results) {
        if (queryId !== wmsQueryId) return;
        if (!results) { wmsPanel.innerHTML = '<div class="wms-empty">Query failed</div>'; return; }
        var bathy = results.bathy;
        var tile = results.tile;
        if (!bathy && !tile) {
            wmsPanel.innerHTML = '<div class="wms-empty">No data at this location</div>';
            return;
        }
        var html = '<div class="wms-header"><a href="https://nauticalcharts.noaa.gov/data/bluetopo_specs.html" target="_blank" class="wms-header-link">BlueTopo</a> at ' + lngLat.lat.toFixed(4) + ', ' + lngLat.lng.toFixed(4) + '</div>' +
            '<div class="wms-credit"><a href="https://nauticalcharts.noaa.gov/learn/nowcoast.html" target="_blank">nowCOAST WMS</a></div>';
        html += '<table class="popup-table">';
        // Tile info first
        if (tile) {
            html += "<tr class='wms-section-label'><td colspan='2'>NBS Tile</td></tr>";
            var tileFields = [["Tile", "tile"], ["Tile Delivery Date", "delivered_date"],
                              ["Resolution", "resolution"], ["UTM Zone", "utm"],
                              ["Tile Scheme Issuance", "issuance"]];
            for (var i = 0; i < tileFields.length; i++) {
                var val = tile[tileFields[i][1]];
                if (val != null) html += "<tr><td class='popup-key'>" + tileFields[i][0] + "</td><td class='popup-val'>" + escapeHtml(String(val)) + "</td></tr>";
            }
        }
        // Section label
        if (bathy) html += "<tr class='wms-section-label'><td colspan='2'>Pixel Elevation</td></tr>";
        // Bathymetry data
        if (bathy) {
            var bathyTop = [
                ["Elevation", "ELEVATION", "m"], ["Uncertainty", "UNCERTAINTY", "m"]
            ];
            for (var k = 0; k < bathyTop.length; k++) {
                var btval = bathy[bathyTop[k][1]];
                if (typeof btval === "number" && bathyTop[k][2]) btval = btval.toFixed(2) + " " + bathyTop[k][2];
                if (btval == null) btval = "N/A";
                html += "<tr><td class='popup-key'>" + bathyTop[k][0] + "</td><td class='popup-val'>" + escapeHtml(String(btval)) + "</td></tr>";
            }
            // Section label before contributor metadata
            html += "<tr class='wms-section-label'><td colspan='2'>Pixel Source</td></tr>";
            var bathyFields = [
                ["Source Survey ID", "source_survey_id", "The survey filename.", "String"],
                ["Source Institution", "source_institution", "The institution responsible for the survey.", "String"],
                ["Survey Start Date", "survey_date_start", "The start date of the survey.", "String ISO 8601:2004"],
                ["Survey End Date", "survey_date_end", "The end date of the survey.", "String ISO 8601:2004"],
                ["Data Assessment", "data_assessment", "Provides an overall indicative level of assessment of bathymetric data from which further attribution is derived.", "Unsigned Integer\n1 = assessed\n3 = unassessed"],
                ["Full Seafloor Coverage", "coverage", "A binary statement expressing if seafloor coverage has been achieved in the area covered by hydrographic surveys. If false, the bathy_coverage attribute must also be false. If true, bathy_coverage may either be true or false.", "Boolean\n1 = True\n0 = False"],
                ["Full Bathy Coverage", "bathy_coverage", "A binary expression stating if full bathymetric coverage has been achieved in the area covered by hydrographic surveys. If true, this indicates the value is sourced from a measured depth, not an interpolated depth. If false, no depth measurement was achieved.", "Boolean\n1 = True\n0 = False"],
                ["Sig. Features Detected", "significant_features", "A binary indication that a systematic method of exploring the seafloor was undertaken to detect significant features. If false, feature_size and feature_least_depth attributes are both not applicable. In the context of bathymetry, a feature is any object, whether manmade or not, projecting above the seafloor, which may be considered a danger to surface navigation.", "Boolean\n1 = True\n0 = False"],
                ["Feature Least Depth", "feature_least_depth", "A binary expression of the ability of the survey to detect the least depth of features.", "Boolean\n1 = True\n0 = False"],
                ["Feature Size", "feature_size", "The size of the smallest feature that the survey was capable of detecting with a high probability - unit is cubic meters.", "Float"],
                ["H. Uncertainty (fixed)", "horizontal_uncert_fixed", "The best estimate of the fixed accuracy of a position. Reported at a 95% Confidence Interval.", "Float"],
                ["H. Uncertainty (var)", "horizontal_uncert_var", "The best estimate of the variable accuracy of a position as a multiplier of depth. Reported at a 95% Confidence Interval.", "Float"],
                ["V. Uncertainty (fixed)", "vertical_uncert_fixed", "The best estimate of the accuracy of depths, heights, vertical distances and vertical clearances. Reported at a 95% Confidence Interval.", "Float"],
                ["V. Uncertainty (var)", "vertical_uncert_var", "The best estimate of the variable accuracy of depths, heights, vertical distances and vertical clearances. Reported at a 95% Confidence Interval.", "Float"],
                ["License Name", "license_name", "The license information regarding restrictions on data redistribution, usage, and source attribution.", "String"],
                ["License URL", "license_url", "The URL or DOI where the license is available.", "String"]
            ];
            for (var j = 0; j < bathyFields.length; j++) {
                var bval = bathy[bathyFields[j][1]];
                if (bval == null) continue;
                var rawVal = bval;
                if (typeof bval === "number") bval = bval.toFixed(2);
                var valHtml = escapeHtml(String(bval));
                // Make URLs clickable
                if (typeof rawVal === "string" && rawVal.indexOf("http") === 0) {
                    valHtml = "<a href='" + escapeHtml(rawVal) + "' target='_blank' style='color:var(--map-overlay-fg)'>" + valHtml + "</a>";
                }
                var desc = bathyFields[j][2] || "";
                var valType = bathyFields[j][3] || "";
                html += "<tr><td class='popup-key' title='" + escapeHtml(desc) + "'>" + bathyFields[j][0] + "</td><td class='popup-val' title='" + escapeHtml(valType) + "'>" + valHtml + "</td></tr>";
            }
        }
        html += '</table>';
        wmsPanel.innerHTML = html;
    });
}

map.on("click", function (e) {
    if (drawingMode || rectMode) return;
    if (wmtsOverlayActive) {
        queryWmsPoint(e.lngLat);
    } else {
        wmsPanel.style.display = "none";
    }
});

// Dismiss WMS panel on map click when no WMTS
map.on("click", function () {
    if (!wmtsOverlayActive && wmsPanel.style.display !== "none") {
        wmsPanel.style.display = "none";
    }
});

// Pointer cursor on hoverable layers
map.on("mousemove", function (e) {
    if (drawingMode || rectMode) return;
    // Vertex-drag handlers manage their own grab/grabbing cursors.
    if (selectedFeatureId && drawPoints.length >= 3 && nearestVertex(e.point) >= 0) return;
    var layers = ["remote-fill", "draw-fill"];
    trackedCategories.forEach(function (cat) { layers.push("tracked-" + cat + "-fill"); });
    var existing = layers.filter(function (l) { return map.getLayer(l); });
    if (existing.length === 0) return;
    var features = map.queryRenderedFeatures(e.point, { layers: existing });
    map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
});

// ── Re-add sources after basemap change ──────────────

function readdAllSources() {
    // Re-add draw layers
    map.addSource("draw-polygon", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("draw-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("draw-inprogress", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
        id: "draw-fill", type: "fill", source: "draw-polygon",
        paint: {
            "fill-color": FILL_COLOR_EXPR,
            "fill-opacity": ["case", ["==", ["get", "selected"], true], DRAW_FILL_OPACITY_SELECTED, DRAW_FILL_OPACITY],
        },
    });
    map.addLayer({
        id: "draw-line", type: "line", source: "draw-polygon",
        paint: {
            "line-color": LINE_COLOR_EXPR,
            "line-width": ["case", ["==", ["get", "selected"], true], 3, 2],
        },
    });
    map.addLayer({
        id: "draw-inprogress-fill", type: "fill", source: "draw-inprogress",
        paint: { "fill-color": "rgba(100,140,255,0.15)", "fill-opacity": 1 },
    });
    map.addLayer({
        id: "draw-inprogress-line", type: "line", source: "draw-inprogress",
        paint: { "line-color": "rgba(100,140,255,0.9)", "line-width": 2, "line-dasharray": [3, 2] },
    });
    map.addLayer({
        id: "draw-vertices", type: "circle", source: "draw-points",
        paint: { "circle-radius": 4, "circle-color": "rgba(100,140,255,1)", "circle-stroke-color": "white", "circle-stroke-width": 1.5 },
    });

    // Repopulate persisted collection.
    syncCollectionToMap();
    syncInProgress();

    if (remoteActive && remoteDisplayData && !remoteLoading) {
        addRemoteToMap(remoteDisplayData);
    }
    if (trackedActive && trackedDisplayData && !trackedLoading) {
        addTrackedToMap(trackedDisplayData);
    }
    if (wmtsOverlayActive) {
        wmtsOverlayActive = false;
        setWmtsOverlay(true);
    }
    if (gridVisible) addGridToMap();
    if (utmVisible) addUtmToMap();
    raiseDrawLayers();
}

// ── Legend ────────────────────────────────────────────

var legendDiv = null;
var remoteSourceLabel = "";
var trackedDirName = "";

function getDirName(path) {
    var parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || path;
}

var remoteLegendCollapsed = false;
var trackedLegendCollapsed = false;

function toggleRemoteLegend() {
    remoteLegendCollapsed = !remoteLegendCollapsed;
    var body = document.getElementById("remote-legend-body");
    var btn = document.getElementById("remote-legend-collapse-btn");
    if (body) body.style.display = remoteLegendCollapsed ? "none" : "";
    if (btn) btn.classList.toggle("collapsed", remoteLegendCollapsed);
}

function toggleTrackedLegend() {
    trackedLegendCollapsed = !trackedLegendCollapsed;
    var body = document.getElementById("tracked-legend-body");
    var btn = document.getElementById("tracked-legend-collapse-btn");
    if (body) body.style.display = trackedLegendCollapsed ? "none" : "";
    if (btn) btn.classList.toggle("collapsed", trackedLegendCollapsed);
}

function buildLegendHtml() {
    var html = "";
    if (remoteActive) {
        html += "<div class='legend-section' onclick='toggleRemoteLegend()'><span class='legend-section-title'>NBS " + escapeHtml(remoteSourceLabel || "Source") + "</span><button id='remote-legend-collapse-btn' class='legend-collapse-btn'>›</button></div>";
        html += "<div id='remote-legend-body'>";
        html += "<div class='legend-subtitle'>Last Delivered</div>";
        var pal = PALETTES[currentPalette];
        var labels = pal.labels || DEFAULT_LABELS;
        for (var i = 0; i < pal.colors.length; i++) {
            var c = pal.colors[i];
            html += "<div class='legend-row'><span class='legend-swatch' style='background:rgb(" + c[0] + "," + c[1] + "," + c[2] + ")'></span>" + labels[i] + "</div>";
        }
        html += "<div class='legend-row'><span class='legend-swatch' style='background:rgb(" + pal.null[0] + "," + pal.null[1] + "," + pal.null[2] + ");border:1px solid rgba(255,255,255,0.15)'></span>No delivery</div>";
        html += "</div>";
    }
    if (trackedActive) {
        if (html) html += "<div class='legend-divider'></div>";
        html += "<div class='legend-section' onclick='toggleTrackedLegend()'><span class='legend-section-title'>" + escapeHtml(trackedDirName || "Your Project") + "</span><button id='tracked-legend-collapse-btn' class='legend-collapse-btn'>›</button></div>";
        html += "<div id='tracked-legend-body'>";
        var cats = [["up_to_date", "Up to date"], ["updates_available", "Updates available"], ["missing_from_disk", "Missing from disk"], ["removed_from_nbs", "Removed from NBS"]];
        for (var j = 0; j < cats.length; j++) {
            html += "<div class='legend-row'><span class='legend-swatch' style='background:" + TRACKED_COLORS[cats[j][0]] + "'></span>" + cats[j][1] + "</div>";
        }
        html += "</div>";
    }
    return html;
}

function updateLegend() {
    var container = document.getElementById("legend-content");
    container.innerHTML = "";
    if (!remoteActive && !trackedActive) { legendDiv = null; return; }
    legendDiv = document.createElement("div");
    legendDiv.className = "map-legend";
    legendDiv.innerHTML = buildLegendHtml();
    container.appendChild(legendDiv);
    var remoteBody = document.getElementById("remote-legend-body");
    if (remoteBody && remoteLegendCollapsed) { remoteBody.style.display = "none"; document.getElementById("remote-legend-collapse-btn").classList.add("collapsed"); }
    var trackedBody = document.getElementById("tracked-legend-body");
    if (trackedBody && trackedLegendCollapsed) { trackedBody.style.display = "none"; document.getElementById("tracked-legend-collapse-btn").classList.add("collapsed"); }
}

// ── Layer state ──────────────────────────────────────

var remoteActive = false;
var remoteRequestedSource = null;
var trackedActive = false;
var trackedRequestedDir = null;
var remoteLoading = false;
var trackedLoading = false;

var remoteDisplayData = null;
var trackedDisplayData = null;
var trackedIsReload = false;
var trackedStartup = false;

function clearTrackedOnly() {
    var wasActive = trackedActive;
    if (trackedActive || trackedLoading) {
        trackedActive = false;
        trackedLoading = false;
        trackedIsReload = false;
        trackedStartup = false;
        trackedDisplayData = null;
        trackedResFilter = null;
        trackedAvailableRes = { resolutions: [], hasNull: false };
        closeResFlyouts();
        removeTrackedFromMap();
        var tb = document.getElementById("btn-layer-tracked");
        tb.classList.remove("layer-on", "layer-loading");
    }
    updateLegend();
    return wasActive;
}

function refreshTracked() {
    var wasLoading = trackedLoading;
    var wasActive = clearTrackedOnly();
    if (wasActive && !currentCommand && !wasLoading) {
        toggleTrackedLayer();
    }
}

function clearAllLayers() {
    if (remoteActive || remoteLoading) {
        remoteActive = false;
        remoteLoading = false;
        remoteDisplayData = null;
        remoteResFilter = null;
        remoteAvailableRes = { resolutions: [], hasNull: false };
        closeResFlyouts();
        removeRemoteFromMap();
        var rb = document.getElementById("btn-layer-remote");
        rb.classList.remove("layer-on", "layer-loading");
    }
    clearTrackedOnly();
}

function refreshAllLayers() {
    var wasRemote = remoteActive;
    var wasTracked = trackedActive;
    var wasTrackedLoading = trackedLoading;
    clearAllLayers();
    if (wasRemote) toggleRemoteLayer();
    if (wasTracked && !currentCommand && !wasTrackedLoading) {
        toggleTrackedLayer();
    }
}

function toggleRemoteLayer() {
    if (remoteLoading) return;
    var btn = document.getElementById("btn-layer-remote");
    if (remoteActive) {
        remoteActive = false;
        remoteResFilter = null;
        remoteAvailableRes = { resolutions: [], hasNull: false };
        closeResFlyouts();
        removeRemoteFromMap();
        btn.classList.remove("layer-on");
        updateLegend();
    } else {
        if (!bridge) return;
        closeResFlyouts();
        var source = document.getElementById("data-source").value;
        remoteActive = true;
        remoteLoading = true;
        remoteRequestedSource = source;
        remoteSourceLabel = document.getElementById("source-label").textContent;
        btn.classList.add("layer-on");
        btn.classList.add("layer-loading");
        bridge.load_remote_layer(source);
    }
}

function toggleTrackedLayer() {
    if (trackedLoading) return;
    var btn = document.getElementById("btn-layer-tracked");
    if (trackedActive) {
        trackedActive = false;
        trackedResFilter = null;
        trackedAvailableRes = { resolutions: [], hasNull: false };
        closeResFlyouts();
        removeTrackedFromMap();
        btn.classList.remove("layer-on");
        updateLegend();
        if (typeof setProjectTileCount === "function") setProjectTileCount(null);
    } else {
        if (!bridge) return;
        if (currentCommand === "fetch") { showToast("Wait for fetch to finish"); return; }
        closeResFlyouts();
        var dir = document.getElementById("project-dir").value;
        if (!dir) { showToast("Enter a project directory first"); return; }
        var source = document.getElementById("data-source").value;
        trackedActive = true;
        trackedLoading = true;
        trackedRequestedDir = dir;
        trackedDirName = getDirName(dir);
        btn.classList.add("layer-on");
        btn.classList.add("layer-loading");
        bridge.load_tracked_layer(dir, source);
    }
}

function reloadTrackedLayer() {
    if (!bridge || trackedLoading) return;
    closeResFlyouts();
    trackedLoading = true;
    trackedIsReload = true;
    var btn = document.getElementById("btn-layer-tracked");
    btn.classList.add("layer-loading");
    var dir = document.getElementById("project-dir").value;
    trackedRequestedDir = dir;
    var source = document.getElementById("data-source").value;
    bridge.load_tracked_layer(dir, source);
}

// ── Fit bounds helper ────────────────────────────────

function fitToGeojson(geojson) {
    if (!geojson || !geojson.features || geojson.features.length === 0) return;
    var bounds = new maplibregl.LngLatBounds();
    geojson.features.forEach(function (f) {
        if (!f.geometry || !f.geometry.coordinates) return;
        var coords = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] :
                     f.geometry.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : [];
        coords.forEach(function (c) { bounds.extend(c); });
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 20 });
}

// ── onLayersReady ────────────────────────────────────

function onLayersReady(data) {
    if (data.layer === "remote") {
        remoteLoading = false;
        var btn = document.getElementById("btn-layer-remote");
        btn.classList.remove("layer-loading");
        // Discard if remote was turned off or source changed
        if (!remoteActive) return;
        if (data.source && remoteRequestedSource && data.source !== remoteRequestedSource) return;
        if (data.error) {
            remoteActive = false;
            btn.classList.remove("layer-on");
            showToast(data.error);
            return;
        }
        colorFeatures(data.data);
        var firstDisplay = !remoteDisplayData;
        remoteDisplayData = data.data;
        addRemoteToMap(data.data);
        updateLegend();
        if (firstDisplay) fitToGeojson(data.data);
    } else if (data.layer === "tracked") {
        trackedLoading = false;
        var btn = document.getElementById("btn-layer-tracked");
        btn.classList.remove("layer-loading");
        // Discard if tracked was turned off or this response is for a different directory
        if (!trackedActive) return;
        if (trackedRequestedDir && data.dir !== trackedRequestedDir) return;
        if (data.error) {
            trackedActive = false;
            trackedIsReload = false;
            btn.classList.remove("layer-on");
            if (typeof setProjectTileCount === "function") setProjectTileCount(null);
            var errMsg = data.error || "";
            if (errMsg.indexOf("Registry database not found") >= 0 || errMsg.indexOf("Folder path not found") >= 0) {
                showToast("No project found here yet. Fetch to get started");
            } else {
                showToast(errMsg);
            }
            return;
        }
        trackedDisplayData = data.data;
        if (typeof setProjectTileCount === "function") setProjectTileCount(data.total || 0);
        addTrackedToMap(data.data);
        updateLegend();
        if (!trackedIsReload) {
            // Fit to all tracked features
            var allFeatures = [];
            for (var cat in data.data) {
                if (data.data[cat].features) allFeatures = allFeatures.concat(data.data[cat].features);
            }
            if (allFeatures.length > 0) fitToGeojson({ type: "FeatureCollection", features: allFeatures });
        }
        trackedIsReload = false;

        if (trackedStartup) {
            trackedStartup = false;
            var updates = data.data.updates_available ? data.data.updates_available.features.length : 0;
            var missing = data.data.missing_from_disk ? data.data.missing_from_disk.features.length : 0;
            var removed = data.data.removed_from_nbs ? data.data.removed_from_nbs.features.length : 0;
            var total = data.total || 0;
            var issues = (updates > 0 ? 1 : 0) + (missing > 0 ? 1 : 0) + (removed > 0 ? 1 : 0);
            if (issues === 1 && updates > 0) {
                showToast({ icon: "⟳", title: "Updates Available", body: updates + " of your tiles have updates. Fetch to download them." }, "toast-welcome");
            } else if (issues === 1 && missing > 0) {
                showToast({ icon: "⚠", title: "Tiles Missing", body: missing + " of your tiles " + (missing === 1 ? "is" : "are") + " missing from disk. Fetch to re-download." }, "toast-welcome");
            } else if (issues === 1 && removed > 0) {
                showToast({ icon: "⚠", title: "Tiles Removed", body: removed + " of your tiles " + (removed === 1 ? "was" : "were") + " removed from the NBS source." }, "toast-welcome");
            } else if (issues > 1) {
                var parts = [];
                if (updates > 0) parts.push(updates + " update" + (updates !== 1 ? "s" : ""));
                if (missing > 0) parts.push(missing + " missing");
                if (removed > 0) parts.push(removed + " removed");
                showToast({ icon: "⚠", title: "Attention Needed", body: parts.join(", ") + ". Fetch to resolve." }, "toast-welcome");
            } else if (total > 0) {
                showToast({ icon: "✓", title: "All Up to Date", body: "All " + total + " of your tiles are current with the NBS." }, "toast-welcome");
            }
        }
    }
}

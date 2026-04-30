// Client-side parsers for geometry strings (BBOX / GeoJSON / WKT).
// `parseGeomString(s)` -> { ok: true, features: [Feature], kind } | { ok: false, error }.

(function () {
    "use strict";

    // ── Vendored WKT parser (wellknown, MIT, Tom MacWright) ─────────
    // https://github.com/mapbox/wellknown — trimmed to parser only.
    var wellknownParse = (function () {
        var numberRegexp = /[-+]?([0-9]*\.[0-9]+|[0-9]+)([eE][-+]?[0-9]+)?/;
        var tuples = new RegExp("^" + numberRegexp.source + "(\\s" + numberRegexp.source + "){1,}");

        function parse(input) {
            var parts = input.split(";"), _ = parts.pop();
            var srid = (parts.shift() || "").split("=").pop();
            var i = 0;
            function $(re) {
                var match = _.substring(i).match(re);
                if (!match) return null;
                i += match[0].length;
                return match[0];
            }
            function crs(obj) {
                if (obj && srid.match(/\d+/)) {
                    obj.crs = {
                        type: "name",
                        properties: { name: "urn:ogc:def:crs:EPSG::" + srid }
                    };
                }
                return obj;
            }
            function white() { $(/^\s*/); }
            function multicoords() {
                white();
                var depth = 0, rings = [[]], stack = [rings[0]], pointer = rings[0], elem;
                while (elem = $(/^(\()/) || $(/^(\))/) || $(/^(,)/) || $(tuples)) {
                    if (elem === "(") {
                        stack.push(pointer);
                        pointer = [];
                        stack[stack.length - 1].push(pointer);
                        depth++;
                    } else if (elem === ")") {
                        if (pointer.length === 0) return null;
                        pointer = stack.pop();
                        if (!pointer) return null;
                        depth--;
                        if (depth === 0) break;
                    } else if (elem === ",") {
                        pointer = [];
                        stack[stack.length - 1].push(pointer);
                    } else if (!elem.split(/\s/g).some(isNaN)) {
                        Array.prototype.push.apply(pointer, elem.split(/\s/g).map(parseFloat));
                    } else {
                        return null;
                    }
                    white();
                }
                if (depth !== 0) return null;
                return rings;
            }
            function coords() {
                var list = [], item, pt;
                while (pt = $(tuples) || $(/^(,)/)) {
                    if (pt === ",") {
                        list.push(item);
                        item = [];
                    } else if (!pt.split(/\s/g).some(isNaN)) {
                        if (!item) item = [];
                        Array.prototype.push.apply(item, pt.split(/\s/g).map(parseFloat));
                    }
                    white();
                }
                if (item) list.push(item); else return null;
                return list.length ? list : null;
            }
            function point() {
                if (!$(/^(point)/i)) return null;
                white();
                if (!$(/^(\()/)) return null;
                var c = coords();
                if (!c) return null;
                white();
                if (!$(/^(\))/)) return null;
                return { type: "Point", coordinates: c[0] };
            }
            function multipoint() {
                if (!$(/^(multipoint)/i)) return null;
                white();
                var c = multicoords();
                if (!c) return null;
                white();
                // Some encoders nest, some don't. Flatten one level if needed.
                var pts = c[0].map(function (item) {
                    return Array.isArray(item[0]) ? item[0] : item;
                });
                return { type: "MultiPoint", coordinates: pts };
            }
            function linestring() {
                if (!$(/^(linestring)/i)) return null;
                white();
                if (!$(/^(\()/)) return null;
                var c = coords();
                if (!c) return null;
                if (!$(/^(\))/)) return null;
                return { type: "LineString", coordinates: c };
            }
            function multilinestring() {
                if (!$(/^(multilinestring)/i)) return null;
                white();
                var c = multicoords();
                if (!c) return null;
                return { type: "MultiLineString", coordinates: c[0] };
            }
            function polygon() {
                if (!$(/^(polygon)/i)) return null;
                white();
                var c = multicoords();
                if (!c) return null;
                return { type: "Polygon", coordinates: c[0] };
            }
            function multipolygon() {
                if (!$(/^(multipolygon)/i)) return null;
                white();
                var c = multicoords();
                if (!c) return null;
                return { type: "MultiPolygon", coordinates: c[0] };
            }
            function geometrycollection() {
                if (!$(/^(geometrycollection)/i)) return null;
                white();
                if (!$(/^(\()/)) return null;
                var geometries = [], geometry;
                while (geometry = root()) {
                    geometries.push(geometry);
                    white();
                    $(/^(,)/);
                    white();
                }
                if (!$(/^(\))/)) return null;
                return { type: "GeometryCollection", geometries: geometries };
            }
            function root() {
                return point() ||
                    linestring() ||
                    polygon() ||
                    multipoint() ||
                    multilinestring() ||
                    multipolygon() ||
                    geometrycollection();
            }
            return crs(root());
        }
        return parse;
    })();

    // ── Helpers ───────────────────────────────────────────────────

    function feature(geometry, props) {
        return { type: "Feature", geometry: geometry, properties: props || {} };
    }

    // Split MultiPolygon into individual Polygon features for editing simplicity.
    // Other geometry types pass through unchanged.
    function explode(geom) {
        if (!geom) return [];
        if (geom.type === "MultiPolygon") {
            return geom.coordinates.map(function (poly) {
                return { type: "Polygon", coordinates: poly };
            });
        }
        if (geom.type === "GeometryCollection") {
            var out = [];
            (geom.geometries || []).forEach(function (g) {
                out = out.concat(explode(g));
            });
            return out;
        }
        return [geom];
    }

    // ── BBOX ──────────────────────────────────────────────────────

    var BBOX_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

    function parseBBOX(s) {
        var m = BBOX_RE.exec(s);
        if (!m) return null;
        var xmin = parseFloat(m[1]);
        var ymin = parseFloat(m[2]);
        var xmax = parseFloat(m[3]);
        var ymax = parseFloat(m[4]);
        if (xmin >= xmax || ymin >= ymax) return null;
        var ring = [
            [xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax], [xmin, ymin],
        ];
        return { type: "Polygon", coordinates: [ring] };
    }

    // ── GeoJSON normalize ─────────────────────────────────────────

    function normalizeGeoJSON(obj) {
        if (!obj || typeof obj !== "object") return null;
        var out = [];
        if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
            obj.features.forEach(function (f) {
                if (!f || !f.geometry) return;
                explode(f.geometry).forEach(function (g) {
                    out.push(feature(g, f.properties || {}));
                });
            });
        } else if (obj.type === "Feature") {
            if (obj.geometry) {
                explode(obj.geometry).forEach(function (g) {
                    out.push(feature(g, obj.properties || {}));
                });
            }
        } else if (obj.type && obj.coordinates) {
            // bare geometry
            explode(obj).forEach(function (g) {
                out.push(feature(g));
            });
        } else {
            return null;
        }
        return out.length ? out : null;
    }

    // ── Public API ────────────────────────────────────────────────

    function parseGeomString(s) {
        if (!s || typeof s !== "string") {
            return { ok: false, error: "empty input" };
        }
        var trimmed = s.trim();
        if (!trimmed) return { ok: false, error: "empty input" };

        // BBOX first — cheapest, most specific.
        var bbox = parseBBOX(trimmed);
        if (bbox) return { ok: true, features: [feature(bbox)], kind: "BBOX" };

        // GeoJSON: starts with { or [.
        if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
            try {
                var obj = JSON.parse(trimmed);
                var feats = normalizeGeoJSON(obj);
                if (feats) return { ok: true, features: feats, kind: "GeoJSON" };
                return { ok: false, error: "GeoJSON not recognized" };
            } catch (e) {
                return { ok: false, error: "Invalid JSON: " + e.message };
            }
        }

        // WKT.
        try {
            var geom = wellknownParse(trimmed);
            if (geom) {
                var parts = explode(geom);
                if (parts.length) {
                    return { ok: true, features: parts.map(function (g) { return feature(g); }), kind: "WKT" };
                }
            }
        } catch (_e) { /* fall through */ }

        return { ok: false, error: "Unrecognized geometry. Use BBOX, GeoJSON, or WKT." };
    }

    window.parseGeomString = parseGeomString;
})();

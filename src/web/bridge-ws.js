// WebSocket bridge — replaces QWebChannel.
// Exposes the same bridge.method(args, callback) API that panels.js expects.

var _ws = null;
var _callId = 0;
var _pending = {};
var _queued = [];
var _connected = false;
var _reconnectAttempts = 0;
var _token = new URLSearchParams(window.location.search).get("token");

function _connect() {
    _ws = new WebSocket("ws://" + location.host + "/ws?token=" + _token);

    _ws.onopen = function () {
        _connected = true;
        _reconnectAttempts = 0;
        // Flush any calls that were made before connection
        _queued.forEach(function (msg) { _ws.send(msg); });
        _queued = [];
        // Only call _onBridgeReady once (first connection, not reconnects)
        if (!bridge._initialized) {
            bridge._initialized = true;
            setTimeout(function () {
                if (typeof _onBridgeReady === "function") _onBridgeReady();
            }, 50);
        }
    };

    _ws.onmessage = function (event) {
        var msg = JSON.parse(event.data);
        if (msg.type === "result" && _pending[msg.id]) {
            _pending[msg.id](msg.data);
            delete _pending[msg.id];
        } else if (msg.type === "log") {
            if (typeof onLogLine === "function") onLogLine(msg.line);
        } else if (msg.type === "command_done") {
            if (typeof onCommandDone === "function") onCommandDone(msg.data);
        } else if (msg.type === "layers_ready") {
            if (typeof onLayersReady === "function") onLayersReady(msg.data);
        }
    };

    _ws.onclose = function () {
        _connected = false;
        _reconnectAttempts++;
        if (_reconnectAttempts <= 10) {
            setTimeout(_connect, Math.min(1000 * _reconnectAttempts, 5000));
        }
    };
}

var bridge = {
    _call: function (method, args, callback) {
        var id = ++_callId;
        if (callback) _pending[id] = callback;
        var msg = JSON.stringify({ type: "call", id: id, method: method, args: args });
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            _ws.send(msg);
        } else {
            _queued.push(msg);
        }
    },
    fetch: function (dir, geom, source, res) {
        this._call("fetch", { project_dir: dir, geometry: geom, data_source: source, resolution_filter: res });
    },
    mosaic: function (dir, source, opts) {
        this._call("mosaic", { project_dir: dir, data_source: source, options_json: opts });
    },
    export: function (dir, source, includeMosaics, flagForRepair) {
        this._call("export", { project_dir: dir, data_source: source, include_mosaics: includeMosaics, flag_for_repair: flagForRepair });
    },
    get_recents: function (cb) { this._call("get_recents", {}, cb); },
    save_basemap: function (name) { this._call("save_basemap", { basemap_name: name }); },
    browse_directory: function (cb) { this._call("browse_directory", {}, cb); },
    browse_geometry: function (cb) { this._call("browse_geometry", {}, cb); },
    read_geometry_file: function (path, cb) { this._call("read_geometry_file", { path: path }, cb); },
    complete_path: function (partial, cb) { this._call("complete_path", { partial: partial }, cb); },
    load_remote_layer: function (source) { this._call("load_remote_layer", { data_source: source }); },
    load_tracked_layer: function (dir, source) { this._call("load_tracked_layer", { project_dir: dir, data_source: source }); },
    get_cpu_count: function (cb) { this._call("get_cpu_count", {}, cb); },
    remove_recent: function (path) { this._call("remove_recent", { path: path }); },
    prewarm_scheme: function (source) { this._call("prewarm_scheme", { data_source: source }); },
    open_folder: function (path, cb) { this._call("open_folder", { path: path }, cb); },
    wms_query: function (lat, lng, cb) { this._call("wms_query", { lat: lat, lng: lng }, cb); },
    get_versions: function (cb) { this._call("get_versions", {}, cb); },
    check_updates: function (cb) { this._call("check_updates", {}, cb); },
};

_connect();

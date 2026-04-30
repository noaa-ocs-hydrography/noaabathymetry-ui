"""aiohttp application — serves web UI and handles WebSocket communication."""

import asyncio
import json
import os

from aiohttp import web

from src.bridge import Bridge


_shutdown_handle = None


def create_app(token):
    app = web.Application()
    app["token"] = token
    app["ws"] = None
    app["bridge"] = None

    web_dir = os.path.join(os.path.dirname(__file__), "web")
    app["web_dir"] = web_dir

    app.router.add_get("/", index_handler)
    app.router.add_get("/reopen", reopen_handler)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_static("/static", web_dir)

    # If no WebSocket connects within 30s of startup, shut down
    async def _startup_timeout(app):
        async def _check():
            await asyncio.sleep(30)
            if app["ws"] is None:
                os._exit(0)
        asyncio.create_task(_check())

    app.on_startup.append(_startup_timeout)

    return app


def _validate_token(request):
    return request.query.get("token") == request.app["token"]


async def index_handler(request):
    if not _validate_token(request):
        return web.Response(status=403, text="Forbidden")
    path = os.path.join(request.app["web_dir"], "index.html")
    return web.FileResponse(path)


async def reopen_handler(request):
    """Unauthenticated endpoint — confirms the server is alive.

    Only reachable from localhost (server binds to 127.0.0.1).
    The caller (duplicate launch) shows a message box after receiving 200.
    """
    return web.Response(text="OK")


async def websocket_handler(request):
    if not _validate_token(request):
        return web.Response(status=403, text="Forbidden")

    ws = web.WebSocketResponse()
    await ws.prepare(request)

    loop = asyncio.get_event_loop()

    # Cancel any pending shutdown
    global _shutdown_handle
    if _shutdown_handle is not None:
        _shutdown_handle.cancel()
        _shutdown_handle = None

    # Disconnect previous session if any
    old_ws = request.app["ws"]
    if old_ws is not None and not old_ws.closed:
        await old_ws.close()

    request.app["ws"] = ws

    def send_msg(msg):
        """Thread-safe send to WebSocket."""
        if not ws.closed:
            asyncio.run_coroutine_threadsafe(ws.send_json(msg), loop)

    bridge = Bridge(send_msg)
    request.app["bridge"] = bridge

    try:
        async for raw in ws:
            if raw.type == web.WSMsgType.TEXT:
                try:
                    msg = json.loads(raw.data)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")
                if msg_type != "call":
                    continue

                call_id = msg.get("id")
                method = msg.get("method")
                args = msg.get("args", {})

                await _dispatch(bridge, ws, call_id, method, args, loop)
    finally:
        request.app["ws"] = None
        request.app["bridge"] = None
        # Start grace period — shut down if no reconnection
        _shutdown_handle = loop.call_later(1.5, _shutdown)

    return ws


def _shutdown():
    """Attempt graceful shutdown, force-kill after 3 seconds."""
    import threading
    threading.Timer(1.5, lambda: os._exit(0)).start()
    raise SystemExit(0)


# Allowed methods and their expected argument names
_SYNC_METHODS = {
    "get_recents": set(),
    "get_cpu_count": set(),
    "browse_directory": set(),
    "browse_geometry": set(),
    "read_geometry_file": {"path"},
    "open_folder": {"path"},
    "wms_query": {"lat", "lng"},
    "complete_path": {"partial"},
    "save_basemap": {"basemap_name"},
    "remove_recent": {"path"},
    "get_versions": set(),
    "check_updates": set(),
}

_ASYNC_METHODS = {
    "fetch": {"project_dir", "geometry", "data_source", "resolution_filter"},
    "mosaic": {"project_dir", "data_source", "options_json"},
    "export": {"project_dir", "data_source", "include_mosaics", "flag_for_repair"},
    "prewarm_scheme": {"data_source"},
    "load_remote_layer": {"data_source"},
    "load_tracked_layer": {"project_dir", "data_source"},
}

def _sanitize_args(args, allowed_keys):
    """Only pass through expected argument names."""
    if not isinstance(args, dict):
        return {}
    return {k: v for k, v in args.items() if k in allowed_keys}


async def _dispatch(bridge, ws, call_id, method, args, loop):
    if method in _SYNC_METHODS:
        fn = getattr(bridge, method, None)
        if fn is None:
            return
        safe_args = _sanitize_args(args, _SYNC_METHODS[method])
        result = await loop.run_in_executor(None, lambda: fn(**safe_args))
        if call_id is not None and not ws.closed:
            await ws.send_json({"type": "result", "id": call_id, "data": result})

    elif method in _ASYNC_METHODS:
        fn = getattr(bridge, method, None)
        if fn is None:
            return
        safe_args = _sanitize_args(args, _ASYNC_METHODS[method])
        fn(**safe_args)

// UI panel logic — connects buttons to the Python bridge via WebSocket.
// bridge object is provided by bridge-ws.js

function _onBridgeReady() {
    bridge.prewarm_scheme(document.getElementById("data-source").value);
    _checkUpdatesOnStartup();
    bridge.get_cpu_count(function (count) {
        document.getElementById("opt-workers").max = Math.max(1, Math.floor(count / 2));
        document.getElementById("opt-workers").placeholder = "1";
    });
    bridge.get_recents(function (response) {
        var recents = JSON.parse(response);
        if (recents.length > 0) {
            var recent = recents[0];
            var path = typeof recent === "string" ? recent : recent.path;
            var source = typeof recent === "string" ? "bluetopo" : (recent.source || "bluetopo");
            document.getElementById("project-dir").value = path;
            lastCommittedDir = path;
            updateOpenFolderBtn();
            setSource(source);
            var basemap = recent.basemap;
            if (basemap) setBasemapByName(basemap);
            trackedStartup = true;
            _isReturningUser = true;
            toggleTrackedLayer();
        } else {
            showToast({ icon: "▸", title: "Welcome", body: "<span class='welcome-subtitle'>Get started (hover the steps for help)</span><div class='welcome-steps'><div class='welcome-step' data-highlight='dir-input-wrap'>1. Type the folder path where you'd like your tiles<div class='welcome-step-note'>(e.g. ~/nyc. Fetch will create the folder for you if it doesn't exist.)</div></div><div class='welcome-step' data-highlight='draw-ctrl'>2. Draw your area of interest</div><div class='welcome-step' data-highlight='btn-fetch'>3. Click Fetch to download tiles</div></div><div class='welcome-hint' data-highlight='nbs-source'>Hint: Turn on the NBS Source layer in the bottom left to see NBS offerings.</div>", duration: 180000 }, "toast-welcome");
        }
        _recentsLoaded = true;
        _maybeShowUpdateToast();
    });
}

function glowElement(el) {
    el.classList.remove("glow");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("glow");
}

var dirDebounce = null;

function onDirInput() {
    justFocused = false;
    clearTimeout(dirDebounce);
    dirDebounce = setTimeout(function () {
        if (!bridge) return;
        var val = document.getElementById("project-dir").value;
        if (!val || val.length < 2) {
            showRecents();
            return;
        }
        bridge.complete_path(val, function (response) {
            var paths = JSON.parse(response);
            var box = document.getElementById("dir-suggestions");
            if (paths.length === 0) {
                hideSuggestions();
                return;
            }
            box.innerHTML = "";
            selectedIndex = -1;
            paths.forEach(function (p) {
                var div = document.createElement("div");
                div.textContent = p;
                div.onclick = function () {
                    var input = document.getElementById("project-dir");
                    input.value = p;
                    lastCommittedDir = p;
                    updateOpenFolderBtn();
                    hideSuggestions();
                    glowElement(input.closest(".dir-input-wrap"));
                    refreshTracked();
                };
                box.appendChild(div);
            });
            box.style.display = "block";
        });
    }, 150);
}

function setSource(value) {
    document.getElementById("data-source").value = value;
    var items = document.querySelectorAll("#source-dropdown .dropdown-item");
    items.forEach(function (item) {
        if (item.getAttribute("data-value") === value) {
            document.getElementById("source-label").textContent = item.textContent;
            item.classList.add("selected");
        } else {
            item.classList.remove("selected");
        }
    });
    updateMosaicToggle();
}

var lastCommittedDir = "";

var justFocused = false;

function onDirFocus() {
    justFocused = true;
    showRecents();
}

function onDirClick() {
    if (!justFocused) {
        showRecents();
    }
}

function showRecents() {
    if (!bridge) return;
    bridge.get_recents(function (response) {
        var recents = JSON.parse(response);
        var box = document.getElementById("dir-suggestions");
        if (recents.length === 0) {
            hideSuggestions();
            return;
        }
        box.innerHTML = "";
        selectedIndex = -1;
        var label = document.createElement("div");
        label.textContent = "RECENT";
        label.className = "suggestions-label";
        box.appendChild(label);
        recents.forEach(function (r) {
            var path = typeof r === "string" ? r : r.path;
            var source = typeof r === "string" ? "bluetopo" : (r.source || "bluetopo");
            var div = document.createElement("div");
            div.className = "recent-item";
            var pathSpan = document.createElement("span");
            pathSpan.className = "recent-path";
            pathSpan.textContent = path;
            var sourceSpan = document.createElement("span");
            sourceSpan.className = "recent-source";
            sourceSpan.textContent = source;
            div.appendChild(pathSpan);
            div.appendChild(sourceSpan);
            div.onclick = function () {
                var input = document.getElementById("project-dir");
                var currentSource = document.getElementById("data-source").value;
                input.value = path;
                lastCommittedDir = path;
                updateOpenFolderBtn();
                setSource(source);
                hideSuggestions();
                if (source !== currentSource) {
                    refreshAllLayers();
                } else {
                    refreshTracked();
                }
                glowElement(input.closest(".dir-input-wrap"));
                glowElement(document.getElementById("source-select"));
            };
            box.appendChild(div);
        });
        box.style.display = "block";
    });
}

var selectedIndex = -1;

document.getElementById("project-dir").addEventListener("keydown", function (e) {
    var box = document.getElementById("dir-suggestions");
    var items = box.querySelectorAll("div:not(.suggestions-label)");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection(items);
    } else if (e.key === "Tab") {
        if (items.length > 0) {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateSelection(items);
            var input = document.getElementById("project-dir");
            input.value = items[selectedIndex].textContent;
            input.setSelectionRange(input.value.length, input.value.length);
        }
    } else if (e.key === "Enter") {
        e.preventDefault();
        var input = document.getElementById("project-dir");
        if (selectedIndex >= 0 && selectedIndex < items.length) {
            input.value = items[selectedIndex].textContent;
            input.setSelectionRange(input.value.length, input.value.length);
        }
        hideSuggestions();
        lastCommittedDir = input.value;
        updateOpenFolderBtn();
        input.blur();
        glowElement(input.closest(".dir-input-wrap"));
        refreshTracked();
    } else if (e.key === "Escape") {
        hideSuggestions();
    }
});

function updateSelection(items) {
    items.forEach(function (item, i) {
        item.classList.toggle("active", i === selectedIndex);
    });
    if (selectedIndex >= 0 && items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: "nearest" });
    }
}

function hideSuggestions() {
    document.getElementById("dir-suggestions").style.display = "none";
    selectedIndex = -1;
}

// Hide suggestions when focus leaves or clicking elsewhere
document.getElementById("project-dir").addEventListener("blur", function () {
    // Small delay so click on suggestion registers before hiding
    var input = this;
    setTimeout(function () {
        hideSuggestions();
        if (input.value && input.value !== lastCommittedDir) {
            glowElement(input.closest(".dir-input-wrap"));
        }
        if (input.value !== lastCommittedDir) {
            lastCommittedDir = input.value;
            updateOpenFolderBtn();
            refreshTracked();
        }
    }, 200);
});

document.addEventListener("click", function (e) {
    if (!e.target.closest("#project-dir") && !e.target.closest("#dir-suggestions")) {
        hideSuggestions();
    }
});

function browseDir() {
    if (!bridge) return;
    bridge.browse_directory(function (path) {
        if (path) {
            var input = document.getElementById("project-dir");
            input.value = path;
            lastCommittedDir = path;
            updateOpenFolderBtn();
            glowElement(input.closest(".dir-input-wrap"));
            refreshTracked();
        }
    });
}

function openProjectFolder() {
    var dir = document.getElementById("project-dir").value;
    if (!dir) { showToast("Enter a project directory first"); return; }
    if (bridge) bridge.open_folder(dir, function (ok) {
        if (!ok) showToast("Folder not found");
    });
}

function updateOpenFolderBtn() {
    var btn = document.getElementById("btn-open-folder");
    btn.style.display = lastCommittedDir ? "" : "none";
}

// ── Field info tooltip ────────────────────────────────

var fieldTooltipActive = null;

function _renderFieldTooltip(container) {
    var tooltip = document.getElementById("field-tooltip");
    var title = container.getAttribute("data-title") || "";
    var body = container.getAttribute("data-tooltip") || "";
    var isCmd = container.classList.contains("command-btn");
    var isBusy = isCmd && container.disabled;
    var busyMsg = "A command is already running…";
    if (isBusy && currentCommand) {
        var runningLabel = currentCommand.charAt(0).toUpperCase() + currentCommand.slice(1);
        busyMsg = runningLabel + " is currently running…";
    }
    tooltip.className = isCmd ? (isBusy ? "command-tooltip command-tooltip-busy" : "command-tooltip") : "";
    tooltip.innerHTML = (isCmd ? "<div class='field-tooltip-category'>Command</div>" : "") +
                        (title ? "<div class='field-tooltip-title'>" + title + "</div>" : "") +
                        "<div class='field-tooltip-body'>" + (isBusy ? busyMsg : body) + "</div>" +
                        (isCmd && !isBusy ? "<div class='field-tooltip-action'>Click to run</div>" : "");
    tooltip.style.display = "block";
    tooltip.style.transform = "translateX(-50%)";
    var rect = container.getBoundingClientRect();
    var tRect = tooltip.getBoundingClientRect();
    var left = rect.left + rect.width / 2;
    left = Math.max(tRect.width / 2 + 6, Math.min(window.innerWidth - tRect.width / 2 - 6, left));
    tooltip.style.left = left + "px";
    tooltip.style.bottom = (window.innerHeight - rect.top + 8) + "px";
    tooltip.style.top = "auto";
}

function refreshFieldTooltip() {
    if (fieldTooltipActive) _renderFieldTooltip(fieldTooltipActive);
}

document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll(".commandbar-field, .switch-label, .command-btn").forEach(function(container) {
        if (!container.getAttribute("data-tooltip")) return;
        container.addEventListener("mouseenter", function() {
            fieldTooltipActive = container;
            _renderFieldTooltip(container);
        });
        container.addEventListener("mouseleave", function() {
            document.getElementById("field-tooltip").style.display = "none";
            fieldTooltipActive = null;
        });
    });
});

// ── Custom data source dropdown ──────────────────────

var sourceOpen = false;

function toggleSourceDropdown() {
    sourceOpen = !sourceOpen;
    document.getElementById("source-dropdown").style.display = sourceOpen ? "block" : "none";
    document.getElementById("source-select").classList.toggle("open", sourceOpen);
}

function pickSource(el) {
    var value = el.getAttribute("data-value");
    var label = el.textContent;
    document.getElementById("data-source").value = value;
    document.getElementById("source-label").textContent = label;
    // Update selected state
    var items = document.querySelectorAll("#source-dropdown .dropdown-item");
    items.forEach(function (item) {
        item.classList.toggle("selected", item === el);
    });
    toggleSourceDropdown();
    glowElement(document.getElementById("source-select"));
    updateMosaicToggle();
    refreshAllLayers();
}

// Close dropdown when clicking outside
document.addEventListener("click", function (e) {
    if (!e.target.closest("#source-select") && !e.target.closest("#source-dropdown")) {
        if (sourceOpen) {
            sourceOpen = false;
            document.getElementById("source-dropdown").style.display = "none";
            document.getElementById("source-select").classList.remove("open");
        }
    }
});

// Mark initial selection
document.addEventListener("DOMContentLoaded", function () {
    var items = document.querySelectorAll("#source-dropdown .dropdown-item");
    if (items.length > 0) items[0].classList.add("selected");
});

// ── Toast & status bar ──────────────────────────────

var docsUrl = "https://noaa-ocs-hydrography.github.io/noaabathymetry-ui/docs/intro";
var _docsLoaded = false;

document.addEventListener("DOMContentLoaded", function() {
    var frame = document.getElementById("docs-frame");
    if (frame) {
        frame.addEventListener("load", function() {
            if (frame.src && frame.src !== "about:blank") _docsLoaded = true;
        });
    }
});

function switchView(view) {
    document.getElementById("btn-view-app").classList.toggle("active", view === "app");
    document.getElementById("btn-view-docs").classList.toggle("active", view === "docs");
    var overlay = document.getElementById("docs-overlay");
    if (view === "docs") {
        if (!_docsLoaded) {
            document.getElementById("docs-frame").src = docsUrl;
        }
        overlay.style.display = "block";
    } else {
        overlay.style.display = "none";
    }
}

function showToast(msg, cls) {
    var container = document.getElementById("toast-container");
    var toast = document.createElement("div");
    toast.className = "toast" + (cls ? " " + cls : "");
    if (cls === "toast-welcome" && typeof msg === "object") {
        toast.innerHTML = '<span class="welcome-icon">' + msg.icon + '</span><div><div class="welcome-title">' + msg.title + '</div><div class="welcome-body">' + msg.body + '</div></div>' +
            '<button class="toast-dismiss" onclick="dismissToast(this)">&#x2303;</button>';
    } else if (typeof msg === "object" && msg.html) {
        toast.innerHTML = msg.html;
    } else {
        toast.textContent = msg;
    }
    if (typeof msg === "object" && msg.duration) {
        toast.style.animation = "slide-in-down 0.4s ease-out, slide-out-up 0.4s ease-in " + (msg.duration / 1000 - 0.4) + "s forwards";
    }
    container.insertBefore(toast, container.firstChild);
    // Wire up hover highlights for steps and hint
    var highlightEls = toast.querySelectorAll("[data-highlight]");
    function _resolveHighlightAll(key) {
        var t = _resolveHighlight(key);
        return t ? (Array.isArray(t) ? t : [t]) : [];
    }
    highlightEls.forEach(function (el) {
        el.addEventListener("mouseenter", function () {
            _resolveHighlightAll(el.getAttribute("data-highlight")).forEach(function (t) {
                t.classList.add("highlight-guide");
            });
        });
        el.addEventListener("mouseleave", function () {
            _resolveHighlightAll(el.getAttribute("data-highlight")).forEach(function (t) {
                t.classList.remove("highlight-guide");
            });
        });
    });
    var duration = (typeof msg === "object" && msg.duration) ? msg.duration : (cls === "toast-welcome" ? 20000 : 6000);
    setTimeout(function () { toast.remove(); }, duration);
}

function _resolveHighlight(id) {
    if (id === "dir-input-wrap") return document.querySelector(".dir-input-wrap");
    if (id === "draw-ctrl") {
        var btn = document.getElementById("draw-polygon-btn");
        return btn ? btn.closest(".maplibregl-ctrl-group") : null;
    }
    if (id === "nbs-source") {
        var rb = document.getElementById("btn-layer-remote");
        return rb ? rb.closest(".layers-item") : null;
    }
    if (id === "btn-fetch") {
        var tab = document.querySelector('.tab[data-tab="fetch"]');
        var btn = document.getElementById("btn-fetch");
        return [tab, btn].filter(Boolean);
    }
    return document.getElementById(id);
}

function dismissToast(btn) {
    var toast = btn.closest(".toast-welcome");
    if (!toast) return;
    toast.style.animation = "none";
    void toast.offsetWidth;
    toast.style.animation = "slide-out-up 0.4s ease-in forwards";
    setTimeout(function () { toast.remove(); }, 400);
}

function setStatus(left) {
    document.getElementById("statusbar-left").textContent = left || "";
}

// ── Status bar context chips (last command, project tile count) ───
var _lastCommandName = null;
var _lastCommandTime = null;
var _projectTileCount = null;
var _statusTickTimer = null;

function _formatRelativeTime(ts) {
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 30) return "just now";
    if (diff < 60) return diff + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
}

function _renderStatusChips() {
    var lastEl = document.getElementById("status-last-command");
    var lastDiv = document.getElementById("status-last-divider");
    var tileEl = document.getElementById("status-tile-count");
    var tileDiv = document.getElementById("status-tile-divider");
    if (!lastEl) return;

    if (_lastCommandName && _lastCommandTime) {
        var label = _lastCommandName.charAt(0).toUpperCase() + _lastCommandName.slice(1);
        lastEl.textContent = label + " · " + _formatRelativeTime(_lastCommandTime);
        lastEl.hidden = false;
        lastDiv.hidden = false;
    } else {
        lastEl.hidden = true;
        lastDiv.hidden = true;
    }

    if (_projectTileCount !== null) {
        tileEl.textContent = "Project: " + _projectTileCount + " tile" + (_projectTileCount === 1 ? "" : "s");
        tileEl.hidden = false;
        tileDiv.hidden = false;
    } else {
        tileEl.hidden = true;
        tileDiv.hidden = true;
    }
}

function _recordCommandCompletion(name) {
    _lastCommandName = name;
    _lastCommandTime = Date.now();
    _renderStatusChips();
    if (!_statusTickTimer) {
        _statusTickTimer = setInterval(_renderStatusChips, 30000);
    }
}

function setProjectTileCount(n) {
    _projectTileCount = (typeof n === "number" && n >= 0) ? n : null;
    _renderStatusChips();
}

// ── Log streaming & results ─────────────────────────

var currentCommand = null;

var logOpen = false;

function setLogOpen(open) {
    logOpen = open;
    var header = document.getElementById("log-header");
    var pane = document.getElementById("log-pane");
    pane.classList.toggle("open", open);
    header.classList.toggle("open", open);
    header.title = open ? "Click to hide output" : "Click to show output";
    if (!open) {
        // Clear any inline height left by resize so it reopens at the default
        pane.style.height = "";
    }
}

function showLog() {
    if (!logOpen) setLogOpen(true);
}

function toggleLog() {
    setLogOpen(!logOpen);
}

function switchCommandTab(name) {
    document.querySelectorAll(".tab-strip .tab").forEach(function(tab) {
        tab.classList.toggle("active", tab.dataset.tab === name);
    });
    document.querySelectorAll(".tab-strip .run-btn").forEach(function(btn) {
        btn.classList.toggle("active", btn.dataset.run === name);
    });
    document.querySelectorAll("#command-area .tab-panel").forEach(function(panel) {
        panel.classList.toggle("active", panel.id === "tab-" + name);
    });
    _updateTabIndicator();
}

var _tabIndicatorCache = {};

// Pre-measure each tab's final geometry (with .active applied, transitions off)
// so the indicator can snap to the correct width on the very first frame.
function _cacheTabIndicatorPositions() {
    var tabs = document.querySelectorAll(".tab-strip .tab");
    if (tabs.length === 0) return;
    var strip = tabs[0].parentElement;
    var originalActiveTab = document.querySelector(".tab-strip .tab.active");
    var icons = document.querySelectorAll(".tab-strip .tab-icon");

    // Freeze transitions during measurement so layout reads return final values
    icons.forEach(function(i) { i.style.transition = "none"; });

    tabs.forEach(function(activeTab) {
        tabs.forEach(function(t) { t.classList.remove("active"); });
        activeTab.classList.add("active");
        void activeTab.offsetWidth; // force layout flush
        var stripRect = strip.getBoundingClientRect();
        var rect = activeTab.getBoundingClientRect();
        _tabIndicatorCache[activeTab.dataset.tab] = {
            left: rect.left - stripRect.left,
            width: rect.width
        };
    });

    // Restore original active state, then thaw transitions
    tabs.forEach(function(t) { t.classList.remove("active"); });
    if (originalActiveTab) originalActiveTab.classList.add("active");
    void strip.offsetWidth; // flush so the restore is computed before transitions resume
    icons.forEach(function(i) { i.style.transition = ""; });
}

function _updateTabIndicator() {
    var indicator = document.querySelector(".tab-strip .tab-indicator");
    var active = document.querySelector(".tab-strip .tab.active");
    if (!indicator || !active) return;
    var strip = active.parentElement;
    var stripWidth = strip.getBoundingClientRect().width;

    var newLeft, newRight;
    var cached = _tabIndicatorCache[active.dataset.tab];
    if (cached) {
        newLeft = cached.left;
        newRight = stripWidth - (cached.left + cached.width);
    } else {
        var stripRect = strip.getBoundingClientRect();
        var rect = active.getBoundingClientRect();
        newLeft = rect.left - stripRect.left;
        newRight = stripRect.width - (rect.right - stripRect.left);
    }

    // Elastic stretch: leading edge moves faster, trailing edge follows.
    // Direction determined by comparing new vs current left.
    var currentLeft = parseFloat(indicator.style.left) || 0;
    if (newLeft > currentLeft + 1) {
        // Moving right: right edge leads, left edge trails
        indicator.style.transition =
            "left 0.32s cubic-bezier(0.55, 0, 0.45, 1), " +
            "right 0.24s cubic-bezier(0.3, 0, 0.45, 1)";
    } else if (newLeft < currentLeft - 1) {
        // Moving left: left edge leads, right edge trails
        indicator.style.transition =
            "left 0.24s cubic-bezier(0.3, 0, 0.45, 1), " +
            "right 0.32s cubic-bezier(0.55, 0, 0.45, 1)";
    }
    // No motion (or initial): keep prior transition (or none if not set)

    indicator.style.left = newLeft + "px";
    indicator.style.right = newRight + "px";
    indicator.style.width = ""; // ensure width-based sizing doesn't override right
}

document.addEventListener("DOMContentLoaded", function() {
    _cacheTabIndicatorPositions();
    _updateTabIndicator();
});

window.addEventListener("resize", function() {
    var indicator = document.querySelector(".tab-strip .tab-indicator");
    if (indicator) indicator.style.transition = "none";
    _cacheTabIndicatorPositions();
    _updateTabIndicator();
    setTimeout(function() {
        if (indicator) indicator.style.transition = "";
    }, 50);
});

var _autoScrollPaused = false;

function _isLogAtBottom() {
    var scroll = document.getElementById("log-scroll");
    return (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight) < 8;
}

function _scrollLogToBottomIfFollowing() {
    if (_autoScrollPaused) return;
    var scroll = document.getElementById("log-scroll");
    scroll.scrollTop = scroll.scrollHeight;
}

function _onLogScroll() {
    var paused = !_isLogAtBottom();
    if (paused === _autoScrollPaused) return;
    _autoScrollPaused = paused;
    document.getElementById("log-pane").classList.toggle("scroll-paused", paused);
}

function jumpToLogBottom() {
    var scroll = document.getElementById("log-scroll");
    scroll.scrollTop = scroll.scrollHeight;
    // _onLogScroll fires from the scroll event and clears the paused state
}

document.addEventListener("DOMContentLoaded", function() {
    var scroll = document.getElementById("log-scroll");
    if (scroll) scroll.addEventListener("scroll", _onLogScroll);
});

function appendLog(line) {
    var results = document.getElementById("results");
    var lineEl = document.createElement("div");
    lineEl.className = "log-line";
    lineEl.textContent = line;
    results.appendChild(lineEl);
    _scrollLogToBottomIfFollowing();
}

function clearLog() {
    document.getElementById("results").textContent = "";
    _autoScrollPaused = false;
    document.getElementById("log-pane").classList.remove("scroll-paused");
}

function copyLog() {
    var lines = document.querySelectorAll("#results .log-line");
    var text = Array.from(lines).map(function(l) { return l.textContent; }).join("\n");
    if (!text) return;
    navigator.clipboard.writeText(text).then(function() {
        if (typeof showToast === "function") showToast("Output copied");
    });
}

function showError(msg) {
    showLog();
    appendLog("Error: " + msg);
}

function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Called from Python via runJavaScript
function onLogLine(line) {
    line = stripAnsi(line);
    // tqdm lines contain "Tiles" and a percentage — replace instead of append
    if (line.indexOf("Tiles") >= 0 && line.indexOf("%") >= 0) {
        updateProgress(line);
    } else {
        appendLog(line);
    }
}

function updateProgress(line) {
    // Extract just the meaningful parts: "BlueTopo Fetch:  73% | 198/270 Tiles 00:10"
    var clean = line.replace(/\|[^|]*\|/, "|").replace(/[#█▏▎▍▌▋▊▉ ]+\|/, " | ");
    var results = document.getElementById("results");
    var last = results.lastElementChild;
    if (last && last.textContent.indexOf("Tiles") >= 0) {
        last.textContent = clean;
        _scrollLogToBottomIfFollowing();
    } else {
        appendLog(clean);
    }
}

// ── Log resize ───────────────────────────────────────
var _logResize = null;

function startLogResize(e) {
    if (_logResize) _endLogResize();
    e.preventDefault();
    var pane = document.getElementById("log-pane");
    var handle = document.getElementById("log-toolbar");
    _logResize = { y: e.clientY, height: pane.offsetHeight };
    pane.style.transition = "none";
    handle.classList.add("dragging");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", _onLogResize);
    document.addEventListener("mouseup", _endLogResize);
}

function _onLogResize(e) {
    if (!_logResize) return;
    var pane = document.getElementById("log-pane");
    var delta = e.clientY - _logResize.y;
    var newHeight = _logResize.height - delta;
    var min = 30;
    var max = window.innerHeight * 0.75;
    newHeight = Math.max(min, Math.min(max, newHeight));
    pane.style.height = newHeight + "px";
}

function _endLogResize() {
    var pane = document.getElementById("log-pane");
    var handle = document.getElementById("log-toolbar");
    var collapseThreshold = 80;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", _onLogResize);
    document.removeEventListener("mouseup", _endLogResize);
    _logResize = null;
    if (pane.offsetHeight < collapseThreshold) {
        // Animate height to 0, then collapse
        pane.style.transition = "height 0.18s ease";
        pane.style.height = "0px";
        setTimeout(function() {
            pane.style.transition = "";
            setLogOpen(false);
        }, 180);
    } else {
        // Reset transition for next time
        setTimeout(function() { pane.style.transition = ""; }, 0);
    }
}

function onCommandDone(data) {
    var wasCommand = currentCommand;
    var fetched = false;
    try {
        if (data.ok) {
            setStatus("Ready");
            var jump = ' <a class="toast-jump" onclick="openProjectFolder()">↗ Show in Explorer</a>';
            if (wasCommand === "fetch") {
                showToast({ html: "Fetch complete" + jump, duration: 7000 });
            } else if (wasCommand === "mosaic") {
                showToast({ html: "Mosaic complete" + jump, duration: 7000 });
            } else if (wasCommand === "export") {
                var size = data.result && data.result.zip_size
                    ? " (" + (data.result.zip_size / 1e6).toFixed(1) + " MB)"
                    : "";
                showToast({ html: "Export complete" + size + jump, duration: 7000 });
            } else {
                showToast("Complete");
            }
            fetched = data.result && data.result.downloaded && data.result.downloaded.length > 0;
        } else {
            appendLog("Error: " + data.error);
            setStatus("Ready");
        }
    } finally {
        var doneLabel = wasCommand ? "· " + wasCommand.charAt(0).toUpperCase() + wasCommand.slice(1) + " Done" : "";
        currentCommand = null;
        setButtonsDisabled(false);
        if (wasCommand) _setCommandRunning(wasCommand, false);
        document.getElementById("log-command").textContent = doneLabel;
        if (wasCommand) _recordCommandCompletion(wasCommand);
    }
    // After currentCommand is cleared, refresh tracked layer
    if (fetched) {
        if (trackedActive) {
            reloadTrackedLayer();
        } else {
            trackedIsReload = true;
            toggleTrackedLayer();
        }
    }
}

function getDir() {
    return document.getElementById("project-dir").value;
}

function getSource() {
    return document.getElementById("data-source").value;
}

function setButtonsDisabled(disabled) {
    var btns = ["btn-fetch", "btn-mosaic", "btn-export"];
    btns.forEach(function (id) {
        var btn = document.getElementById(id);
        btn.disabled = disabled;
    });
    var dot = document.getElementById("log-dot");
    if (dot) dot.classList.toggle("active", disabled);
    refreshFieldTooltip();
}

function runCommand(name, fn) {
    if (!bridge) { showError("Bridge not ready"); return; }
    if (currentCommand) { showError("A command is already running."); return; }
    if (name === "fetch" && trackedLoading) { showToast("Waiting for your project to finish loading..."); return; }
    var dir = getDir();
    if (!dir) { showError("Please enter a project directory."); return; }

    currentCommand = name;
    clearLog();
    showLog();
    setButtonsDisabled(true);
    _setCommandRunning(name, true);
    var runningLabels = { fetch: "Fetching...", mosaic: "Mosaicking...", export: "Exporting..." };
    setStatus(runningLabels[name] || (name.charAt(0).toUpperCase() + name.slice(1) + "..."));
    var runLabel = name === "fetch" ? "Fetching..." : name === "mosaic" ? "Mosaicing..." : "Exporting...";
    document.getElementById("log-command").textContent = "· " + runLabel;
    try {
        fn(dir);
    } catch (e) {
        currentCommand = null;
        setButtonsDisabled(false);
        _setCommandRunning(name, false);
        showError(String(e));
    }
}

function _setCommandRunning(name, running) {
    var btn = document.querySelector('.run-btn[data-run="' + name + '"]');
    if (!btn) return;
    btn.classList.toggle("running", running);
    var label = btn.querySelector(".btn-label");
    if (label) label.textContent = running ? "Running" : "Run";
}

// ── Geometry field autocomplete ──────────────────────

function looksLikePath(val) {
    if (!val) return false;
    if (val.charAt(0) === "/" || val.charAt(0) === "\\") return true;
    if (val.length >= 2 && val.charAt(1) === ":" && /[a-zA-Z]/.test(val.charAt(0))) return true;
    if (val.charAt(0) === "~") return true;
    return false;
}

var geomDebounce = null;

function onGeomInput() {
    clearTimeout(geomDebounce);
    var val = document.getElementById("opt-geometry").value;
    if (!looksLikePath(val) || !bridge) {
        hideGeomSuggestions();
        return;
    }
    geomDebounce = setTimeout(function () {
        bridge.complete_path(val, function (response) {
            var paths = JSON.parse(response);
            var box = document.getElementById("geom-suggestions");
            if (paths.length === 0) {
                hideGeomSuggestions();
                return;
            }
            box.innerHTML = "";
            paths.forEach(function (p) {
                var div = document.createElement("div");
                div.textContent = p;
                div.onclick = function () {
                    document.getElementById("opt-geometry").value = p;
                    hideGeomSuggestions();
                };
                box.appendChild(div);
            });
            box.style.display = "block";
            var tooltip = document.getElementById("field-tooltip");
            if (tooltip) tooltip.style.display = "none";
            fieldTooltipActive = null;
        });
    }, 150);
}

var geomSelectedIndex = -1;

document.getElementById("opt-geometry").addEventListener("keydown", function (e) {
    var box = document.getElementById("geom-suggestions");
    var items = box.querySelectorAll("div");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        geomSelectedIndex = Math.min(geomSelectedIndex + 1, items.length - 1);
        updateGeomSelection(items);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        geomSelectedIndex = Math.max(geomSelectedIndex - 1, 0);
        updateGeomSelection(items);
    } else if (e.key === "Tab") {
        if (items.length > 0) {
            e.preventDefault();
            geomSelectedIndex = (geomSelectedIndex + 1) % items.length;
            updateGeomSelection(items);
            this.value = items[geomSelectedIndex].textContent;
            this.setSelectionRange(this.value.length, this.value.length);
        }
    } else if (e.key === "Enter") {
        e.preventDefault();
        if (geomSelectedIndex >= 0 && geomSelectedIndex < items.length) {
            this.value = items[geomSelectedIndex].textContent;
            this.setSelectionRange(this.value.length, this.value.length);
        }
        hideGeomSuggestions();
    } else if (e.key === "Escape") {
        hideGeomSuggestions();
    }
});

function updateGeomSelection(items) {
    items.forEach(function (item, i) {
        item.classList.toggle("active", i === geomSelectedIndex);
    });
    if (geomSelectedIndex >= 0 && items[geomSelectedIndex]) {
        items[geomSelectedIndex].scrollIntoView({ block: "nearest" });
    }
}

function hideGeomSuggestions() {
    document.getElementById("geom-suggestions").style.display = "none";
    geomSelectedIndex = -1;
}

document.getElementById("opt-geometry").addEventListener("blur", function () {
    setTimeout(hideGeomSuggestions, 150);
});

function browseGeometry() {
    if (!bridge) return;
    bridge.browse_geometry(function (path) {
        if (path) {
            var input = document.getElementById("opt-geometry");
            input.value = path;
            input.blur();
            // Scroll to show end of path
            input.setSelectionRange(path.length, path.length);
            input.scrollLeft = input.scrollWidth;
        }
    });
}

// Numeric-only inputs — strip non-numeric on input, clamp on blur
document.getElementById("opt-resolution").addEventListener("input", function () {
    this.value = this.value.replace(/[^0-9.]/g, "");
});
document.getElementById("opt-resolution").addEventListener("blur", function () {
    if (this.value !== "" && (parseFloat(this.value) < 1 || isNaN(parseFloat(this.value)))) {
        this.value = "";
    }
});

document.getElementById("opt-workers").addEventListener("input", function () {
    this.value = this.value.replace(/[^0-9]/g, "");
});
document.getElementById("opt-workers").addEventListener("blur", function () {
    if (this.value !== "" && (parseInt(this.value) < 1 || isNaN(parseInt(this.value)))) {
        this.value = "";
    }
});

function getMosaicOptions() {
    var opts = {
        hillshade: document.getElementById("opt-hillshade").classList.contains("on"),
    };
    var w = document.getElementById("opt-workers").value;
    if (w) opts.workers = parseInt(w, 10);
    var r = document.getElementById("opt-resolution").value;
    if (r) opts.resolution_target = parseFloat(r);
    return JSON.stringify(opts);
}

function runFetch() {
    runCommand("fetch", function (dir) {
        var geom = document.getElementById("opt-geometry").value || "";
        var resFilter = document.getElementById("opt-fetch-resolution").value || "";
        bridge.fetch(dir, geom, getSource(), resFilter);
    });
}

function runMosaic() {
    runCommand("mosaic", function (dir) {
        bridge.mosaic(dir, getSource(), getMosaicOptions());
    });
}

var S102_NO_MOSAIC = ["s102v22", "s102v30"];

function toggleExportMosaics() {
    var source = getSource();
    if (S102_NO_MOSAIC.indexOf(source) >= 0) {
        showToast("Exporting mosaics is not supported for this data source.");
        return;
    }
    document.getElementById("opt-export-mosaics").classList.toggle("on");
}

function updateMosaicToggle() {
    var source = getSource();
    var el = document.getElementById("opt-export-mosaics");
    var label = el.closest(".switch-label");
    if (S102_NO_MOSAIC.indexOf(source) >= 0) {
        el.classList.remove("on");
        label.classList.add("disabled");
    } else {
        if (label.classList.contains("disabled")) {
            el.classList.add("on");
        }
        label.classList.remove("disabled");
    }
}

function runExport() {
    runCommand("export", function (dir) {
        var includeMosaics = document.getElementById("opt-export-mosaics").classList.contains("on");
        var flagForRepair = document.getElementById("opt-export-repair").classList.contains("on");
        bridge.export(dir, getSource(), includeMosaics, flagForRepair);
    });
}



// rrweb-recorder.js - Enhanced session recording with console, network, and navigation capture
(function() {
    'use strict';

    // Ensure rrweb is loaded
    if (typeof window.rrweb === 'undefined') {
        console.error('rrweb is not loaded. Please include rrweb script before this recorder.');
        return;
    }

    const session = [];
    let stopRecording = null;

    // Custom event emitter function
    function addCustomEvent(tag, payload) {
        session.push({
            type: 5, // Custom event type
            data: {
                tag: tag,
                payload: payload
            },
            timestamp: Date.now()
        });
    }

    // Start recording and get the stopFn
    stopRecording = window.rrweb.record({
        emit(e) {
            session.push(e);
        },
        recordCanvas: true,
    });

    // --- Console capture ---
    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug
    };

    // Intercept all console methods
    ['log', 'error', 'warn', 'info', 'debug'].forEach(level => {
        console[level] = function(...args) {
            // Call original console method first
            originalConsole[level].apply(console, args);

            // Capture for rrweb
            try {
                const message = args.map(arg => {
                    if (typeof arg === 'string') return arg;
                    if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`;
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch {
                        return String(arg);
                    }
                }).join(' ');

                addCustomEvent("console", {
                    level: level,
                    message: message,
                    args: args.map(arg => {
                        try {
                            return typeof arg === 'string' ? arg : JSON.stringify(arg);
                        } catch {
                            return String(arg);
                        }
                    }),
                    timestamp: Date.now(),
                    url: location.href
                });
            } catch (e) {
                // Don't break if rrweb fails
                originalConsole.error('Failed to capture console log:', e);
            }
        };
    });

    // Capture uncaught errors
    window.addEventListener('error', (event) => {
        try {
            addCustomEvent("console", {
                level: 'error',
                message: `Uncaught Error: ${event.message}`,
                args: [event.error?.stack || event.message],
                timestamp: Date.now(),
                url: location.href,
                source: event.filename,
                line: event.lineno,
                column: event.colno
            });
        } catch (e) {
            originalConsole.error('Failed to capture error event:', e);
        }
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        try {
            addCustomEvent("console", {
                level: 'error',
                message: `Unhandled Promise Rejection: ${event.reason}`,
                args: [String(event.reason)],
                timestamp: Date.now(),
                url: location.href
            });
        } catch (e) {
            originalConsole.error('Failed to capture promise rejection:', e);
        }
    });

    console.log('🎯 Console capture enabled for rrweb');

    // Helper function to safely serialize data
    function serializeData(data, maxSize = 4096) {
        if (!data) return "";

        try {
            if (typeof data === "string") {
                return data.slice(0, maxSize);
            }
            if (data instanceof FormData) {
                const entries = {};
                for (const [key, value] of data.entries()) {
                    entries[key] =
                        typeof value === "string" ? value : "[File]";
                }
                return JSON.stringify(entries).slice(0, maxSize);
            }
            if (
                data instanceof ArrayBuffer ||
                data instanceof Uint8Array
            ) {
                return `[Binary data: ${data.byteLength} bytes]`;
            }
            return JSON.stringify(data).slice(0, maxSize);
        } catch (e) {
            return String(data).slice(0, maxSize);
        }
    }

    // --- Enhanced Network capture ---
    // fetch
    const origFetch = window.fetch;
    window.fetch = async function (resource, init = {}) {
        const started = Date.now();
        const id = Math.random().toString(36).slice(2);

        // Extract request data
        let requestBody = "";
        if (init.body) {
            requestBody = serializeData(init.body);
        }

        addCustomEvent("network", {
            id,
            phase: "start",
            api: "fetch",
            url: String(resource),
            method: init.method || "GET",
            headers: init.headers || {},
            requestBody,
            timestamp: started,
        });

        try {
            const res = await origFetch.apply(this, arguments);
            const clone = res.clone();
            let responseText = "";
            let responseType = "text";

            try {
                const contentType =
                    res.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                    responseText = await clone.text();
                    responseType = "json";
                } else if (contentType.includes("text/")) {
                    responseText = await clone.text();
                    responseType = "text";
                } else if (
                    contentType.includes("image/") ||
                    contentType.includes("video/") ||
                    contentType.includes("audio/")
                ) {
                    responseText = `[${contentType} - ${res.headers.get("content-length") || "unknown"} bytes]`;
                    responseType = "binary";
                } else {
                    responseText = await clone.text();
                }
            } catch (err) {
                responseText = `[Error reading response: ${err.message}]`;
            }

            addCustomEvent("network", {
                id,
                phase: "end",
                status: res.status,
                statusText: res.statusText,
                ok: res.ok,
                headers: Object.fromEntries(res.headers.entries()),
                responseBody: serializeData(responseText),
                responseType,
                duration: Date.now() - started,
                timestamp: Date.now(),
            });
            return res;
        } catch (err) {
            addCustomEvent("network", {
                id,
                phase: "error",
                error: err.message,
                stack: err.stack,
                duration: Date.now() - started,
                timestamp: Date.now(),
            });
            throw err;
        }
    };

    // Enhanced XMLHttpRequest
    const X = window.XMLHttpRequest;
    window.XMLHttpRequest = function WrappedXHR() {
        const xhr = new X();
        const id = Math.random().toString(36).slice(2);
        let url = "",
            method = "GET",
            started = 0;
        let requestHeaders = {};
        let requestBody = "";

        const open = xhr.open;
        xhr.open = function (m, u) {
            method = m;
            url = u;
            return open.apply(xhr, arguments);
        };

        const setRequestHeader = xhr.setRequestHeader;
        xhr.setRequestHeader = function (header, value) {
            requestHeaders[header] = value;
            return setRequestHeader.apply(xhr, arguments);
        };

        const send = xhr.send;
        xhr.send = function (body) {
            started = Date.now();
            requestBody = serializeData(body);

            addCustomEvent("network", {
                id,
                phase: "start",
                api: "xhr",
                url,
                method,
                headers: requestHeaders,
                requestBody,
                timestamp: started,
            });

            // Add event listeners BEFORE calling send
            const handleResponse = () => {
                let responseBody = "";
                let responseType = "text";

                try {
                    if (
                        xhr.responseType === "json" ||
                        xhr
                            .getResponseHeader("content-type")
                            ?.includes("application/json")
                    ) {
                        responseBody = xhr.responseText || xhr.response;
                        responseType = "json";
                    } else if (
                        xhr.responseType === "blob" ||
                        xhr.responseType === "arraybuffer"
                    ) {
                        responseBody = `[Binary response: ${xhr.response?.size || xhr.response?.byteLength || "unknown"} bytes]`;
                        responseType = "binary";
                    } else {
                        responseBody =
                            xhr.responseText ||
                            String(xhr.response || "");
                    }
                } catch (e) {
                    responseBody = `[Error reading response: ${e.message}]`;
                }

                addCustomEvent("network", {
                    id,
                    phase: "end",
                    status: xhr.status,
                    statusText: xhr.statusText,
                    ok: xhr.status >= 200 && xhr.status < 400,
                    responseHeaders: xhr.getAllResponseHeaders(),
                    responseBody: serializeData(responseBody),
                    responseType,
                    duration: Date.now() - started,
                    timestamp: Date.now(),
                });
            };

            const handleError = () => {
                addCustomEvent("network", {
                    id,
                    phase: "error",
                    error: "Network error",
                    duration: Date.now() - started,
                    timestamp: Date.now(),
                });
            };

            // Use multiple event types to ensure we catch the response
            xhr.addEventListener("load", handleResponse);
            xhr.addEventListener("loadend", handleResponse);
            xhr.addEventListener("error", handleError);
            xhr.addEventListener("abort", handleError);
            xhr.addEventListener("timeout", handleError);

            return send.apply(xhr, arguments);
        };
        return xhr;
    };

    // SPA navigations (history API)
    const push = history.pushState,
        replace = history.replaceState;
    const emitNav = () =>
        addCustomEvent("nav", {
            href: location.href,
            t: Date.now(),
        });
    history.pushState = function () {
        const r = push.apply(this, arguments);
        emitNav();
        return r;
    };
    history.replaceState = function () {
        const r = replace.apply(this, arguments);
        emitNav();
        return r;
    };
    window.addEventListener("popstate", emitNav);
    window.addEventListener("hashchange", emitNav);

    // Expose controls
    window.__rr = {
        stop: () => stopRecording(),
        dump: () => session.slice(),
        download: () => {
            const blob = new Blob([JSON.stringify(session, null, 2)], {
                type: "application/json",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `rrweb-session-${Date.now()}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },
        getNetworkEvents: () => {
            return session.filter(
                (event) =>
                    event.type === 5 && // custom event
                    event.data.tag === "network",
            );
        },
    };

    // Check for test mode activation and store in sessionStorage for tab-level persistence
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.get("testmode") === "1" || urlParams.get("debug") === "1") {
        sessionStorage.setItem("rrweb_testmode", "true");
    }

    // Replace the existing test mode UI section in your base script with this:

// Optional "test mode" switch - persists across redirections in same tab
if (sessionStorage.getItem("rrweb_testmode") === "true") {
    // Wait for DOM to be ready before creating test mode UI
    function createTestModeUI() {
        if (!document.body) {
            setTimeout(createTestModeUI, 100);
            return;
        }

        const hud = document.createElement("div");
        hud.style.cssText =
            "position:fixed;left:50%;bottom:12px;transform:translateX(-50%);background:#111;color:#fff;padding:8px 16px;border-radius:8px;z-index:999999;display:flex;align-items:center;justify-content:space-between;min-width:200px";
        
        const startTime = Date.now();
        const timeDisplay = document.createElement("span");
        timeDisplay.style.cssText = "color:#FFF;font-family:Brockmann;font-size:16px;font-style:normal;font-weight:600;line-height:20px;letter-spacing:-0.32px;opacity:0.3";
        
        // Update timer every second
        const updateTimer = () => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            timeDisplay.textContent = `${mins}:${secs}`;
        };
        updateTimer();
        const timerInterval = setInterval(updateTimer, 1000);
        
        hud.innerHTML = `
            <div style="cursor:pointer" id="record-indicator">
                <svg width="37" height="36" viewBox="0 0 37 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" width="36" height="36" rx="18" fill="#2EE572" fill-opacity="0.1"/>
                    <circle opacity="0.2" cx="18.5004" cy="18.0004" r="9.6" fill="#2EE572"/>
                    <circle cx="18.5004" cy="18.0004" r="3" stroke="#2EE572" stroke-width="1.2"/>
                    <circle cx="18.4992" cy="17.9992" r="4.8" fill="#2EE572"/>
                </svg>
            </div>
            <div style="width:1px;height:12px;background:#FFF;opacity:0.3"></div>
            <span></span>
            <div style="width:1px;height:12px;background:#FFF;opacity:0.3"></div>
            <div style="cursor:pointer" id="dl-btn">
                <svg width="37" height="36" viewBox="0 0 37 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" width="36" height="36" rx="12" fill="#4A90E2"/>
                    <path d="M18.5 12v8M18.5 20l-3-3M18.5 20l3-3M12.5 22h12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <div style="cursor:pointer" id="net-btn">
                <svg width="37" height="36" viewBox="0 0 37 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" width="36" height="36" rx="12" fill="#9B59B6"/>
                    <path d="M12.5 14h12M12.5 18h12M12.5 22h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
            <div style="cursor:pointer" id="stop-btn">
                <svg width="37" height="36" viewBox="0 0 37 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" width="36" height="36" rx="12" fill="#FF6A4D"/>
                    <path d="M10.166 17.9993C10.166 14.071 10.166 12.1068 11.386 10.886C12.6077 9.66602 14.571 9.66602 18.4993 9.66602C22.4277 9.66602 24.3918 9.66602 25.6118 10.886C26.8327 12.1077 26.8327 14.071 26.8327 17.9993C26.8327 21.9277 26.8327 23.8918 25.6118 25.1118C24.3927 26.3327 22.4277 26.3327 18.4993 26.3327C14.571 26.3327 12.6068 26.3327 11.386 25.1118C10.166 23.8927 10.166 21.9277 10.166 17.9993Z" fill="white"/>
                </svg>
            </div>
            <div style="cursor:pointer" id="clear-btn">
                <svg width="37" height="36" viewBox="0 0 37 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" width="36" height="36" rx="12" fill="#7F8C8D"/>
                    <path d="M14.5 14.5l8 8M22.5 14.5l-8 8" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
        `;
        
        // Replace the middle span with our timer
        hud.children[2].replaceWith(timeDisplay);
        
        document.body.appendChild(hud);

        // Event handlers
        hud.querySelector("#dl-btn").onclick = () => window.__rr.download();
        hud.querySelector("#net-btn").onclick = () => {
            console.table(window.__rr.getNetworkEvents());
        };
        hud.querySelector("#stop-btn").onclick = () => {
            clearInterval(timerInterval);
            window.__rr.stop();
            window.opener?.postMessage(
                {
                    type: "rrweb_events",
                    data: JSON.stringify(session),
                },
                "*",
            );
            hud.remove();
        };
        hud.querySelector("#clear-btn").onclick = () => {
            clearInterval(timerInterval);
            sessionStorage.removeItem("rrweb_testmode");
            hud.remove();
            console.log("🧪 Test mode disabled");
        };
    }

    // Initialize test mode UI when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createTestModeUI);
    } else {
        createTestModeUI();
    }
}
})();

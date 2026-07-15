"use strict";
(() => {
  // src/analysis/util.ts
  function tryParseJson(s) {
    if (!s) return void 0;
    const t = s.trim();
    if (!t || t[0] !== "{" && t[0] !== "[") return void 0;
    try {
      return JSON.parse(t);
    } catch {
      return void 0;
    }
  }

  // src/analysis/json-summary.ts
  function depthOf(v, d = 0) {
    if (d >= 10 || v === null || typeof v !== "object") return d;
    const vals = Array.isArray(v) ? v.slice(0, 10) : Object.values(v).slice(0, 20);
    let max = d;
    for (const x of vals) max = Math.max(max, depthOf(x, d + 1));
    return max;
  }
  function summarizeJson(body) {
    const v = tryParseJson(body);
    if (v === void 0) return void 0;
    const depth = depthOf(v);
    if (Array.isArray(v)) {
      const first = v[0];
      const keys = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first).slice(0, 15) : [];
      return {
        kind: "array",
        arrayLength: v.length,
        topKeys: keys,
        depth,
        description: `Array of ${v.length} item(s)${keys.length ? `, items look like {${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", \u2026" : ""}}` : ""}, depth ${depth}`
      };
    }
    if (v !== null && typeof v === "object") {
      const keys = Object.keys(v).slice(0, 15);
      return {
        kind: "object",
        topKeys: keys,
        depth,
        description: `Object with ${Object.keys(v).length} key(s): ${keys.slice(0, 8).join(", ")}${Object.keys(v).length > 8 ? ", \u2026" : ""}, depth ${depth}`
      };
    }
    return { kind: "scalar", topKeys: [], depth: 0, description: `Scalar JSON value: ${JSON.stringify(v)}` };
  }

  // src/panel/state.ts
  var CAPS = {
    requests: 5e3,
    consoleEntries: 5e3,
    framesPerConn: 1e3
  };
  var store = {
    requests: [],
    wsConns: /* @__PURE__ */ new Map(),
    sseConns: /* @__PURE__ */ new Map(),
    consoleEntries: [],
    sources: [],
    analysis: null,
    preserveLog: false,
    eventsDropped: 0,
    pageOrigin: ""
  };
  var nextReqId = 1;
  var newReqId = () => nextReqId++;
  function clearStore() {
    store.requests = [];
    store.wsConns = /* @__PURE__ */ new Map();
    store.sseConns = /* @__PURE__ */ new Map();
    store.consoleEntries = [];
    store.sources = [];
    store.analysis = null;
    store.eventsDropped = 0;
    notify();
  }
  function pushRequest(r) {
    store.requests.push(r);
    if (store.requests.length > CAPS.requests) store.requests.splice(0, store.requests.length - CAPS.requests);
    notify();
  }
  function pushConsole(e) {
    store.consoleEntries.push(e);
    if (store.consoleEntries.length > CAPS.consoleEntries)
      store.consoleEntries.splice(0, store.consoleEntries.length - CAPS.consoleEntries);
    notify();
  }
  var listeners = /* @__PURE__ */ new Set();
  var scheduled = false;
  function subscribe(fn) {
    listeners.add(fn);
  }
  function notify() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const fn of listeners) fn();
    });
  }

  // src/panel/capture.ts
  var BODY_CAP = 1e6;
  var TEXTUAL_MIME = /json|text|xml|javascript|x-www-form-urlencoded|graphql/i;
  function harToEntry(e, backfilled = false) {
    return {
      id: newReqId(),
      startedAt: Date.parse(e.startedDateTime) || Date.now(),
      method: e.request.method,
      url: e.request.url,
      status: e.response.status,
      statusText: e.response.statusText,
      mimeType: e.response.content?.mimeType || "",
      resourceType: e._resourceType || "",
      reqHeaders: e.request.headers || [],
      resHeaders: e.response.headers || [],
      queryString: e.request.queryString || [],
      postData: e.request.postData?.text,
      bodySize: e.response.content?.size ?? -1,
      transferSize: e.response._transferSize ?? -1,
      time: Math.round(e.time || 0),
      fromCache: !!(e.cache && (e.cache.beforeRequest || e.cache.afterRequest)),
      isBackfilled: backfilled,
      bodyUnavailable: backfilled
    };
  }
  function startCapture() {
    store.pageOrigin = "";
    chrome.devtools.inspectedWindow.eval("location.origin", (result) => {
      if (typeof result === "string") store.pageOrigin = result;
    });
    chrome.devtools.network.getHAR((harLog) => {
      for (const e of harLog.entries || []) pushRequest(harToEntry(e, true));
    });
    chrome.devtools.network.onRequestFinished.addListener((req) => {
      const e = req;
      const entry = harToEntry(e);
      pushRequest(entry);
      const size = e.response.content?.size ?? 0;
      if (TEXTUAL_MIME.test(entry.mimeType) && size >= 0 && size < BODY_CAP * 2) {
        try {
          e.getContent((content, encoding) => {
            if (content == null) {
              entry.bodyUnavailable = true;
            } else if (encoding === "base64") {
              entry.bodyUnavailable = true;
            } else {
              entry.body = content.length > BODY_CAP ? content.slice(0, BODY_CAP) : content;
              entry.bodyTruncated = content.length > BODY_CAP;
            }
            notify();
          });
        } catch {
          entry.bodyUnavailable = true;
        }
      }
    });
    chrome.devtools.network.onNavigated.addListener((url) => {
      if (!store.preserveLog) clearStore();
      try {
        store.pageOrigin = new URL(url).origin;
      } catch {
      }
      notify();
    });
    const port = chrome.runtime.connect({ name: "wh-panel" });
    port.postMessage({ type: "init", tabId: chrome.devtools.inspectedWindow.tabId });
    port.onMessage.addListener((msg) => {
      if (msg.type !== "events" || !msg.events) return;
      if (msg.dropped) store.eventsDropped += msg.dropped;
      for (const ev of msg.events) handleEvent(ev);
      notify();
    });
  }
  function connFor(map, id, url = "?", ts = Date.now()) {
    let c = map.get(id);
    if (!c) {
      c = { id, url, openedAt: ts, frames: [], framesDropped: 0 };
      map.set(id, c);
    }
    return c;
  }
  function handleEvent(ev) {
    const p = ev.payload;
    switch (ev.kind) {
      case "ws-open": {
        const c = connFor(store.wsConns, p.id, p.url, ev.ts);
        c.url = p.url;
        c.protocols = p.protocols;
        break;
      }
      case "ws-frame": {
        const c = connFor(store.wsConns, p.id, void 0, ev.ts);
        if (c.frames.length >= CAPS.framesPerConn) {
          c.framesDropped++;
          break;
        }
        c.frames.push({
          ts: ev.ts,
          dir: p.dir,
          data: p.data,
          truncated: p.truncated,
          binary: p.binary,
          size: p.size ?? 0
        });
        break;
      }
      case "ws-close": {
        const c = connFor(store.wsConns, p.id, void 0, ev.ts);
        c.closedAt = ev.ts;
        c.closeCode = p.code;
        c.closeReason = p.reason;
        break;
      }
      case "ws-error": {
        connFor(store.wsConns, p.id, void 0, ev.ts).error = true;
        break;
      }
      case "sse-open": {
        const c = connFor(store.sseConns, p.id, p.url, ev.ts);
        c.url = p.url;
        break;
      }
      case "sse-message": {
        const c = connFor(store.sseConns, p.id, void 0, ev.ts);
        if (c.frames.length >= CAPS.framesPerConn) {
          c.framesDropped++;
          break;
        }
        c.frames.push({
          ts: ev.ts,
          dir: "in",
          data: p.data,
          truncated: p.truncated,
          binary: false,
          size: p.size ?? 0
        });
        break;
      }
      case "sse-error": {
        connFor(store.sseConns, p.id, void 0, ev.ts).error = true;
        break;
      }
      case "console": {
        pushConsole({ ts: ev.ts, level: p.level, args: p.args || [] });
        break;
      }
    }
  }
  function refreshSources(cb) {
    chrome.devtools.inspectedWindow.getResources((resources) => {
      const metas = [];
      let pending = 0;
      const MAX_CONTENT = 200;
      const finish = () => {
        store.sources = metas;
        cb();
        notify();
      };
      resources.slice(0, 500).forEach((res, i) => {
        const url = res.url || "";
        if (!url || url.startsWith("chrome-extension:")) return;
        const meta = {
          url,
          type: res.type || "other",
          size: -1,
          thirdParty: !sameBase(url, store.pageOrigin)
        };
        metas.push(meta);
        if (i < MAX_CONTENT) {
          pending++;
          try {
            res.getContent((content) => {
              if (content) {
                meta.size = content.length;
                if (!meta.thirdParty && (meta.type === "script" || meta.type === "document")) {
                  meta.contentSample = content.slice(0, 2e5);
                }
              }
              if (--pending === 0) finish();
            });
          } catch {
            if (--pending === 0) finish();
          }
        }
      });
      if (pending === 0) finish();
    });
  }
  function sameBase(url, origin) {
    try {
      const a = new URL(url).hostname.split(".").slice(-2).join(".");
      const b = new URL(origin || "http://x").hostname.split(".").slice(-2).join(".");
      return a === b;
    } catch {
      return false;
    }
  }

  // src/panel/dom.ts
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      el.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }
  function download(filename, content, mime = "application/json") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5e3);
  }
  function copyText(s) {
    navigator.clipboard?.writeText(s).catch(() => {
    });
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }
  function prettyJson(s) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return void 0;
    }
  }

  // src/panel/main.ts
  var app = document.getElementById("app");
  var activeTab = "requests";
  var filterText = "";
  var selectedReq = null;
  var selectedConn = null;
  var consoleLevels = /* @__PURE__ */ new Set(["log", "info", "warn", "error", "debug", "trace", "uncaught", "unhandledrejection"]);
  var analyzing = false;
  var worker = new Worker("worker.js");
  worker.onmessage = (e) => {
    store.analysis = e.data;
    analyzing = false;
    render();
  };
  function runAnalysis() {
    analyzing = true;
    render();
    const input = {
      requests: store.requests,
      wsConns: [...store.wsConns.values()],
      consoleEntries: store.consoleEntries,
      sources: store.sources,
      pageOrigin: store.pageOrigin
    };
    worker.postMessage(JSON.parse(JSON.stringify(input)));
  }
  function exportSession() {
    const trim = (s) => s && s.length > 5e4 ? s.slice(0, 5e4) + "\u2026[truncated]" : s;
    const data = {
      tool: "woodhouse",
      version: "0.1.0",
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      pageOrigin: store.pageOrigin,
      counts: {
        requests: store.requests.length,
        wsConnections: store.wsConns.size,
        sseConnections: store.sseConns.size,
        consoleEntries: store.consoleEntries.length,
        sources: store.sources.length
      },
      findings: store.analysis?.findings ?? [],
      requests: store.requests.map((r) => ({ ...r, body: trim(r.body), postData: trim(r.postData) })),
      websockets: [...store.wsConns.values()],
      sse: [...store.sseConns.values()],
      console: store.consoleEntries,
      sources: store.sources.map((s) => ({ ...s, contentSample: void 0 }))
    };
    download(`woodhouse-session-${Date.now()}.json`, JSON.stringify(data, null, 2));
  }
  function render() {
    const active = document.activeElement;
    const restoreFilter = active?.id === "wh-filter" ? { start: active.selectionStart, end: active.selectionEnd } : null;
    app.textContent = "";
    app.append(renderToolbar(), renderTabs(), renderContent());
    if (restoreFilter) {
      const el = document.getElementById("wh-filter");
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(restoreFilter.start ?? el.value.length, restoreFilter.end ?? el.value.length);
        } catch {
        }
      }
    }
  }
  function renderToolbar() {
    const input = h("input", {
      id: "wh-filter",
      type: "text",
      placeholder: "Filter (url, method, status)\u2026",
      oninput: (e) => {
        filterText = e.target.value.toLowerCase();
        render();
      }
    });
    input.value = filterText;
    const preserve = h("input", {
      type: "checkbox",
      onchange: (e) => {
        store.preserveLog = e.target.checked;
      }
    });
    preserve.checked = store.preserveLog;
    return h(
      "div",
      { class: "toolbar" },
      input,
      h("label", {}, preserve, "Preserve log"),
      h("button", { onclick: () => {
        clearStore();
        selectedReq = null;
        selectedConn = null;
        render();
      } }, "Clear"),
      h("div", { class: "spacer" }),
      store.eventsDropped > 0 ? h("span", { class: "muted" }, `${store.eventsDropped} events dropped`) : null,
      h("span", { class: "muted" }, `${store.requests.length} req \xB7 ${store.wsConns.size} ws \xB7 ${store.consoleEntries.length} logs`),
      h("button", { onclick: exportSession }, "Export session"),
      h("button", { class: "primary", onclick: runAnalysis }, analyzing ? "Analyzing\u2026" : "Analyze")
    );
  }
  function renderTabs() {
    const defs = [
      { id: "requests", label: "Requests", badge: store.requests.length },
      { id: "websockets", label: "WS/SSE", badge: store.wsConns.size + store.sseConns.size },
      { id: "console", label: "Console", badge: store.consoleEntries.length },
      { id: "sources", label: "Sources", badge: store.sources.length },
      { id: "insights", label: "Insights", badge: store.analysis?.findings.length }
    ];
    return h(
      "div",
      { class: "tabs" },
      ...defs.map(
        (d) => h(
          "div",
          {
            class: `tab${activeTab === d.id ? " active" : ""}`,
            onclick: () => {
              activeTab = d.id;
              render();
            }
          },
          d.label,
          d.badge !== void 0 ? h("span", { class: "badge" }, String(d.badge)) : null
        )
      )
    );
  }
  function renderContent() {
    switch (activeTab) {
      case "requests":
        return renderRequests();
      case "websockets":
        return renderWs();
      case "console":
        return renderConsole();
      case "sources":
        return renderSources();
      case "insights":
        return renderInsights();
    }
  }
  var MAX_ROWS = 500;
  function matchesFilter(r) {
    if (!filterText) return true;
    return r.url.toLowerCase().includes(filterText) || r.method.toLowerCase() === filterText || String(r.status).startsWith(filterText);
  }
  function renderRequests() {
    const rows = store.requests.filter(matchesFilter);
    const shown = rows.slice(-MAX_ROWS);
    const table = h(
      "table",
      {},
      h("thead", {}, h("tr", {}, ...["", "Method", "Status", "Type", "Size", "Time", "URL"].map((c) => h("th", {}, c)))),
      h(
        "tbody",
        {},
        ...shown.map((r) => {
          const cls = `status-${Math.floor(r.status / 100)}xx`;
          const tr = h(
            "tr",
            {
              class: `row${selectedReq?.id === r.id ? " selected" : ""}`,
              onclick: () => {
                selectedReq = r;
                render();
              }
            },
            h("td", { class: "muted" }, fmtTime(r.startedAt)),
            h("td", {}, r.method),
            h("td", { class: cls }, r.status ? String(r.status) : "\u2014"),
            h("td", { class: "muted" }, r.resourceType || r.mimeType.split(";")[0]),
            h("td", { class: "muted" }, r.bodySize >= 0 ? fmtSize(r.bodySize) : "?"),
            h("td", { class: "muted" }, `${r.time} ms`),
            h("td", { title: r.url }, r.url)
          );
          return tr;
        })
      )
    );
    const list = h("div", { class: "list-pane" });
    if (rows.length > MAX_ROWS) list.append(h("div", { class: "hint" }, `Showing last ${MAX_ROWS} of ${rows.length}`));
    list.append(rows.length ? table : h("div", { class: "empty" }, "No requests captured yet. Reload the page with this panel open."));
    const detail = h("div", { class: `detail-pane${selectedReq ? " open" : ""}` });
    if (selectedReq) detail.append(...requestDetail(selectedReq));
    return h("div", { class: "content" }, list, detail);
  }
  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  }
  function headerGrid(headers) {
    const anno = store.analysis?.headerAnnotations || {};
    const grid = h("div", { class: "kv" });
    for (const hd of headers) {
      grid.append(h("div", { class: "k" }, hd.name), h("div", { class: "v" }, hd.value));
      const a = anno[hd.name.toLowerCase()];
      if (a) grid.append(h("div", { class: "anno" }, a));
    }
    return grid;
  }
  function toCurl(r) {
    const parts = [`curl '${r.url.replace(/'/g, "'\\''")}'`];
    if (r.method !== "GET") parts.push(`-X ${r.method}`);
    for (const hd of r.reqHeaders) {
      const n = hd.name.toLowerCase();
      if (n === "content-length" || n.startsWith(":")) continue;
      parts.push(`-H '${hd.name}: ${hd.value.replace(/'/g, "'\\''")}'`);
    }
    if (r.postData) parts.push(`--data-raw '${r.postData.replace(/'/g, "'\\''")}'`);
    return parts.join(" \\\n  ");
  }
  function requestDetail(r) {
    const out = [];
    out.push(
      h(
        "div",
        { class: "btn-row" },
        h("button", { onclick: () => copyText(toCurl(r)) }, "Copy as cURL"),
        h("button", { onclick: () => copyText(r.url) }, "Copy URL")
      )
    );
    out.push(h("h3", {}, "General"));
    out.push(
      headerGrid([
        { name: "URL", value: r.url },
        { name: "Method", value: r.method },
        { name: "Status", value: `${r.status} ${r.statusText}` },
        { name: "Type", value: r.mimeType || r.resourceType },
        { name: "Duration", value: `${r.time} ms` },
        { name: "From cache", value: String(r.fromCache) }
      ])
    );
    if (r.queryString.length) {
      out.push(h("h3", {}, "Query parameters"), headerGrid(r.queryString));
    }
    out.push(h("h3", {}, `Request headers (${r.reqHeaders.length})`), headerGrid(r.reqHeaders));
    out.push(h("h3", {}, `Response headers (${r.resHeaders.length})`), headerGrid(r.resHeaders));
    if (r.postData) {
      out.push(h("h3", {}, "Request body"));
      out.push(h("pre", {}, prettyJson(r.postData) ?? r.postData.slice(0, 2e4)));
    }
    out.push(h("h3", {}, "Response body"));
    if (r.body) {
      const summary = summarizeJson(r.body);
      if (summary) {
        out.push(h("div", { class: "muted" }, summary.description));
        out.push(
          h(
            "div",
            { class: "btn-row" },
            h("button", {
              onclick: () => download(fileNameFor(r), prettyJson(r.body) ?? r.body)
            }, "Save as .json")
          )
        );
      }
      out.push(h("pre", {}, (prettyJson(r.body) ?? r.body).slice(0, 5e4) + (r.bodyTruncated ? "\n\u2026[truncated]" : "")));
    } else {
      out.push(
        h(
          "div",
          { class: "muted" },
          r.bodyUnavailable ? r.isBackfilled ? "Body unavailable (request predates panel \u2014 reload page to capture bodies)." : "Body unavailable (binary or not retrievable)." : "No body captured."
        )
      );
    }
    return out;
  }
  function fileNameFor(r) {
    try {
      const u = new URL(r.url);
      const base = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
      return `${base.replace(/[^\w.-]/g, "_")}-${r.id}.json`;
    } catch {
      return `response-${r.id}.json`;
    }
  }
  function renderWs() {
    const conns = [...store.wsConns.values()].map((c) => ({ c, kind: "WS" })).concat(
      [...store.sseConns.values()].map((c) => ({ c, kind: "SSE" }))
    );
    const list = h("div", { class: "list-pane" });
    if (!conns.length) {
      list.append(h("div", { class: "empty" }, "No WebSocket/SSE connections observed. Connections opened before the page finished loading are captured automatically; reload if the page connected before you opened DevTools."));
    } else {
      list.append(
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, ...["Kind", "State", "Frames", "URL"].map((c) => h("th", {}, c)))),
          h(
            "tbody",
            {},
            ...conns.map(
              ({ c, kind }) => h(
                "tr",
                {
                  class: `row${selectedConn?.id === c.id ? " selected" : ""}`,
                  onclick: () => {
                    selectedConn = c;
                    render();
                  }
                },
                h("td", {}, kind),
                h(
                  "td",
                  { class: c.error ? "status-5xx" : c.closedAt ? "muted" : "status-2xx" },
                  c.error ? "error" : c.closedAt ? `closed (${c.closeCode ?? "?"})` : "open"
                ),
                h("td", {}, String(c.frames.length) + (c.framesDropped ? ` (+${c.framesDropped} dropped)` : "")),
                h("td", { title: c.url }, c.url)
              )
            )
          )
        )
      );
    }
    const detail = h("div", { class: `detail-pane${selectedConn ? " open" : ""}` });
    if (selectedConn) {
      detail.append(h("h3", {}, selectedConn.url));
      for (const f of selectedConn.frames.slice(-300)) {
        detail.append(
          h(
            "div",
            { class: "frame" },
            h("span", { class: "ts muted" }, fmtTime(f.ts)),
            h("span", { class: `dir-${f.dir}` }, f.dir === "in" ? "\u2B07" : "\u2B06"),
            h("span", { class: "payload" }, f.data.slice(0, 2e3) + (f.truncated ? " \u2026[truncated]" : ""))
          )
        );
      }
      if (!selectedConn.frames.length) detail.append(h("div", { class: "muted" }, "No frames yet."));
    }
    return h("div", { class: "content" }, list, detail);
  }
  function renderConsole() {
    const wrap = h("div", { class: "list-pane" });
    const levels = ["log", "info", "warn", "error", "debug", "uncaught"];
    const bar = h(
      "div",
      { class: "toolbar" },
      ...levels.map((lv) => {
        const cb = h("input", {
          type: "checkbox",
          onchange: (e) => {
            const on = e.target.checked;
            if (lv === "uncaught") {
              for (const l of ["uncaught", "unhandledrejection"]) on ? consoleLevels.add(l) : consoleLevels.delete(l);
            } else if (lv === "debug") {
              for (const l of ["debug", "trace"]) on ? consoleLevels.add(l) : consoleLevels.delete(l);
            } else {
              on ? consoleLevels.add(lv) : consoleLevels.delete(lv);
            }
            render();
          }
        });
        cb.checked = consoleLevels.has(lv);
        return h("label", {}, cb, lv);
      })
    );
    wrap.append(bar);
    const entries = store.consoleEntries.filter((e) => consoleLevels.has(e.level)).slice(-1e3);
    if (!entries.length) wrap.append(h("div", { class: "empty" }, "No console output captured."));
    for (const e of entries) {
      wrap.append(
        h(
          "div",
          { class: `console-line level-${e.level}` },
          h("span", { class: "ts" }, fmtTime(e.ts)),
          h("span", {}, `[${e.level}] ${e.args.join(" ").slice(0, 4e3)}`)
        )
      );
    }
    return h("div", { class: "content" }, wrap);
  }
  var sourcesLoading = false;
  function renderSources() {
    const wrap = h("div", { class: "list-pane" });
    wrap.append(
      h(
        "div",
        { class: "toolbar" },
        h("button", {
          onclick: () => {
            sourcesLoading = true;
            render();
            refreshSources(() => {
              sourcesLoading = false;
              render();
            });
          }
        }, sourcesLoading ? "Scanning\u2026" : "Scan sources"),
        h("span", { class: "muted" }, "Lists loaded resources; sizes and secret scan for the first 200.")
      )
    );
    if (!store.sources.length) {
      wrap.append(h("div", { class: "empty" }, "Press \u201CScan sources\u201D to inventory scripts, styles and documents."));
    } else {
      wrap.append(
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, ...["Type", "Party", "Size", "URL"].map((c) => h("th", {}, c)))),
          h(
            "tbody",
            {},
            ...store.sources.map(
              (s) => h(
                "tr",
                {},
                h("td", {}, s.type),
                h("td", { class: "muted" }, s.thirdParty ? "3rd" : "1st"),
                h("td", { class: "muted" }, s.size >= 0 ? fmtSize(s.size) : "?"),
                h("td", { title: s.url }, s.url)
              )
            )
          )
        )
      );
    }
    return h("div", { class: "content" }, wrap);
  }
  function renderInsights() {
    const wrap = h("div", { class: "list-pane" });
    if (analyzing) {
      wrap.append(h("div", { class: "empty" }, "Analyzing\u2026"));
    } else if (!store.analysis) {
      wrap.append(
        h(
          "div",
          { class: "empty" },
          "Press Analyze (top right) to run duplicate detection, header & privacy analysis, console correlation and source checks. ",
          "Tip: scan sources first for source findings."
        )
      );
    } else {
      const findings = store.analysis.findings;
      if (!findings.length) wrap.append(h("div", { class: "empty" }, "No findings \u2014 clean session."));
      for (const f of findings) wrap.append(findingCard(f));
    }
    return h("div", { class: "content" }, wrap);
  }
  function findingCard(f) {
    return h(
      "div",
      { class: "finding" },
      h(
        "div",
        { class: "title" },
        h("span", { class: `sev sev-${f.severity}` }, f.severity),
        f.title,
        h("span", { class: "cat" }, f.category)
      ),
      h("div", { class: "detail" }, f.detail),
      f.refs?.length ? h("div", { class: "refs" }, f.refs.join("  \xB7  ")) : null
    );
  }
  startCapture();
  subscribe(render);
  render();
})();

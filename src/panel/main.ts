import type { AnalysisInput, AnalysisResult, Finding, Header, ReqEntry, WsConn } from "../shared/types";
import { summarizeJson } from "../analysis/json-summary";
import { refreshSources, startCapture } from "./capture";
import { copyText, download, fmtTime, h, prettyJson } from "./dom";
import { clearStore, store, subscribe } from "./state";

type TabId = "requests" | "websockets" | "console" | "sources" | "insights";

const app = document.getElementById("app")!;
let activeTab: TabId = "requests";
let filterText = "";
let selectedReq: ReqEntry | null = null;
let selectedConn: WsConn | null = null;
let consoleLevels = new Set(["log", "info", "warn", "error", "debug", "trace", "uncaught", "unhandledrejection"]);
let analyzing = false;

const worker = new Worker("worker.js");
worker.onmessage = (e: MessageEvent) => {
  store.analysis = e.data as AnalysisResult;
  analyzing = false;
  render();
};

function runAnalysis(): void {
  analyzing = true;
  render();
  const input: AnalysisInput = {
    requests: store.requests,
    wsConns: [...store.wsConns.values()],
    consoleEntries: store.consoleEntries,
    sources: store.sources,
    pageOrigin: store.pageOrigin,
  };
  worker.postMessage(JSON.parse(JSON.stringify(input)));
}

function exportSession(): void {
  const trim = (s?: string) => (s && s.length > 50_000 ? s.slice(0, 50_000) + "…[truncated]" : s);
  const data = {
    tool: "woodhouse",
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    pageOrigin: store.pageOrigin,
    counts: {
      requests: store.requests.length,
      wsConnections: store.wsConns.size,
      sseConnections: store.sseConns.size,
      consoleEntries: store.consoleEntries.length,
      sources: store.sources.length,
    },
    findings: store.analysis?.findings ?? [],
    requests: store.requests.map((r) => ({ ...r, body: trim(r.body), postData: trim(r.postData) })),
    websockets: [...store.wsConns.values()],
    sse: [...store.sseConns.values()],
    console: store.consoleEntries,
    sources: store.sources.map((s) => ({ ...s, contentSample: undefined })),
  };
  download(`woodhouse-session-${Date.now()}.json`, JSON.stringify(data, null, 2));
}

// ---------------- render ----------------

function render(): void {
  // Preserve filter-input focus/caret across full re-renders (captures stream in continuously).
  const active = document.activeElement as HTMLInputElement | null;
  const restoreFilter = active?.id === "wh-filter" ? { start: active.selectionStart, end: active.selectionEnd } : null;
  app.textContent = "";
  app.append(renderToolbar(), renderTabs(), renderContent());
  if (restoreFilter) {
    const el = document.getElementById("wh-filter") as HTMLInputElement | null;
    if (el) {
      el.focus();
      try {
        el.setSelectionRange(restoreFilter.start ?? el.value.length, restoreFilter.end ?? el.value.length);
      } catch {
        /* ignore */
      }
    }
  }
}

function renderToolbar(): HTMLElement {
  const input = h("input", {
    id: "wh-filter",
    type: "text",
    placeholder: "Filter (url, method, status)…",
    oninput: (e) => {
      filterText = (e.target as HTMLInputElement).value.toLowerCase();
      render();
    },
  }) as HTMLInputElement;
  input.value = filterText;

  const preserve = h("input", {
    type: "checkbox",
    onchange: (e) => {
      store.preserveLog = (e.target as HTMLInputElement).checked;
    },
  }) as HTMLInputElement;
  preserve.checked = store.preserveLog;

  return h(
    "div",
    { class: "toolbar" },
    input,
    h("label", {}, preserve, "Preserve log"),
    h("button", { onclick: () => { clearStore(); selectedReq = null; selectedConn = null; render(); } }, "Clear"),
    h("div", { class: "spacer" }),
    store.eventsDropped > 0 ? h("span", { class: "muted" }, `${store.eventsDropped} events dropped`) : null,
    h("span", { class: "muted" }, `${store.requests.length} req · ${store.wsConns.size} ws · ${store.consoleEntries.length} logs`),
    h("button", { onclick: exportSession }, "Export session"),
    h("button", { class: "primary", onclick: runAnalysis }, analyzing ? "Analyzing…" : "Analyze")
  );
}

function renderTabs(): HTMLElement {
  const defs: { id: TabId; label: string; badge?: number }[] = [
    { id: "requests", label: "Requests", badge: store.requests.length },
    { id: "websockets", label: "WS/SSE", badge: store.wsConns.size + store.sseConns.size },
    { id: "console", label: "Console", badge: store.consoleEntries.length },
    { id: "sources", label: "Sources", badge: store.sources.length },
    { id: "insights", label: "Insights", badge: store.analysis?.findings.length },
  ];
  return h(
    "div",
    { class: "tabs" },
    ...defs.map((d) =>
      h(
        "div",
        {
          class: `tab${activeTab === d.id ? " active" : ""}`,
          onclick: () => {
            activeTab = d.id;
            render();
          },
        },
        d.label,
        d.badge !== undefined ? h("span", { class: "badge" }, String(d.badge)) : null
      )
    )
  );
}

function renderContent(): HTMLElement {
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

// ---------------- requests tab ----------------

const MAX_ROWS = 500;

function matchesFilter(r: ReqEntry): boolean {
  if (!filterText) return true;
  return (
    r.url.toLowerCase().includes(filterText) ||
    r.method.toLowerCase() === filterText ||
    String(r.status).startsWith(filterText)
  );
}

function renderRequests(): HTMLElement {
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
            },
          },
          h("td", { class: "muted" }, fmtTime(r.startedAt)),
          h("td", {}, r.method),
          h("td", { class: cls }, r.status ? String(r.status) : "—"),
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

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

function headerGrid(headers: Header[]): HTMLElement {
  const anno = store.analysis?.headerAnnotations || {};
  const grid = h("div", { class: "kv" });
  for (const hd of headers) {
    grid.append(h("div", { class: "k" }, hd.name), h("div", { class: "v" }, hd.value));
    const a = anno[hd.name.toLowerCase()];
    if (a) grid.append(h("div", { class: "anno" }, a));
  }
  return grid;
}

function toCurl(r: ReqEntry): string {
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

function requestDetail(r: ReqEntry): HTMLElement[] {
  const out: HTMLElement[] = [];
  out.push(
    h("div", { class: "btn-row" },
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
      { name: "From cache", value: String(r.fromCache) },
    ])
  );
  if (r.queryString.length) {
    out.push(h("h3", {}, "Query parameters"), headerGrid(r.queryString));
  }
  out.push(h("h3", {}, `Request headers (${r.reqHeaders.length})`), headerGrid(r.reqHeaders));
  out.push(h("h3", {}, `Response headers (${r.resHeaders.length})`), headerGrid(r.resHeaders));
  if (r.postData) {
    out.push(h("h3", {}, "Request body"));
    out.push(h("pre", {}, prettyJson(r.postData) ?? r.postData.slice(0, 20_000)));
  }
  out.push(h("h3", {}, "Response body"));
  if (r.body) {
    const summary = summarizeJson(r.body);
    if (summary) {
      out.push(h("div", { class: "muted" }, summary.description));
      out.push(
        h("div", { class: "btn-row" },
          h("button", {
            onclick: () => download(fileNameFor(r), prettyJson(r.body!) ?? r.body!),
          }, "Save as .json")
        )
      );
    }
    out.push(h("pre", {}, (prettyJson(r.body) ?? r.body).slice(0, 50_000) + (r.bodyTruncated ? "\n…[truncated]" : "")));
  } else {
    out.push(
      h("div", { class: "muted" },
        r.bodyUnavailable
          ? r.isBackfilled
            ? "Body unavailable (request predates panel — reload page to capture bodies)."
            : "Body unavailable (binary or not retrievable)."
          : "No body captured."
      )
    );
  }
  return out;
}

function fileNameFor(r: ReqEntry): string {
  try {
    const u = new URL(r.url);
    const base = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return `${base.replace(/[^\w.-]/g, "_")}-${r.id}.json`;
  } catch {
    return `response-${r.id}.json`;
  }
}

// ---------------- ws/sse tab ----------------

function renderWs(): HTMLElement {
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
          ...conns.map(({ c, kind }) =>
            h(
              "tr",
              {
                class: `row${selectedConn?.id === c.id ? " selected" : ""}`,
                onclick: () => {
                  selectedConn = c;
                  render();
                },
              },
              h("td", {}, kind),
              h("td", { class: c.error ? "status-5xx" : c.closedAt ? "muted" : "status-2xx" },
                c.error ? "error" : c.closedAt ? `closed (${c.closeCode ?? "?"})` : "open"),
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
        h("div", { class: "frame" },
          h("span", { class: "ts muted" }, fmtTime(f.ts)),
          h("span", { class: `dir-${f.dir}` }, f.dir === "in" ? "⬇" : "⬆"),
          h("span", { class: "payload" }, f.data.slice(0, 2000) + (f.truncated ? " …[truncated]" : ""))
        )
      );
    }
    if (!selectedConn.frames.length) detail.append(h("div", { class: "muted" }, "No frames yet."));
  }
  return h("div", { class: "content" }, list, detail);
}

// ---------------- console tab ----------------

function renderConsole(): HTMLElement {
  const wrap = h("div", { class: "list-pane" });
  const levels = ["log", "info", "warn", "error", "debug", "uncaught"];
  const bar = h(
    "div",
    { class: "toolbar" },
    ...levels.map((lv) => {
      const cb = h("input", {
        type: "checkbox",
        onchange: (e) => {
          const on = (e.target as HTMLInputElement).checked;
          if (lv === "uncaught") {
            for (const l of ["uncaught", "unhandledrejection"]) on ? consoleLevels.add(l) : consoleLevels.delete(l);
          } else if (lv === "debug") {
            for (const l of ["debug", "trace"]) on ? consoleLevels.add(l) : consoleLevels.delete(l);
          } else {
            on ? consoleLevels.add(lv) : consoleLevels.delete(lv);
          }
          render();
        },
      }) as HTMLInputElement;
      cb.checked = consoleLevels.has(lv);
      return h("label", {}, cb, lv);
    })
  );
  wrap.append(bar);
  const entries = store.consoleEntries.filter((e) => consoleLevels.has(e.level)).slice(-1000);
  if (!entries.length) wrap.append(h("div", { class: "empty" }, "No console output captured."));
  for (const e of entries) {
    wrap.append(
      h("div", { class: `console-line level-${e.level}` },
        h("span", { class: "ts" }, fmtTime(e.ts)),
        h("span", {}, `[${e.level}] ${e.args.join(" ").slice(0, 4000)}`)
      )
    );
  }
  return h("div", { class: "content" }, wrap);
}

// ---------------- sources tab ----------------

let sourcesLoading = false;

function renderSources(): HTMLElement {
  const wrap = h("div", { class: "list-pane" });
  wrap.append(
    h("div", { class: "toolbar" },
      h("button", {
        onclick: () => {
          sourcesLoading = true;
          render();
          refreshSources(() => {
            sourcesLoading = false;
            render();
          });
        },
      }, sourcesLoading ? "Scanning…" : "Scan sources"),
      h("span", { class: "muted" }, "Lists loaded resources; sizes and secret scan for the first 200.")
    )
  );
  if (!store.sources.length) {
    wrap.append(h("div", { class: "empty" }, "Press “Scan sources” to inventory scripts, styles and documents."));
  } else {
    wrap.append(
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ...["Type", "Party", "Size", "URL"].map((c) => h("th", {}, c)))),
        h(
          "tbody",
          {},
          ...store.sources.map((s) =>
            h("tr", {},
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

// ---------------- insights tab ----------------

function renderInsights(): HTMLElement {
  const wrap = h("div", { class: "list-pane" });
  if (analyzing) {
    wrap.append(h("div", { class: "empty" }, "Analyzing…"));
  } else if (!store.analysis) {
    wrap.append(
      h("div", { class: "empty" },
        "Press Analyze (top right) to run duplicate detection, header & privacy analysis, console correlation and source checks. ",
        "Tip: scan sources first for source findings."
      )
    );
  } else {
    const findings = store.analysis.findings;
    if (!findings.length) wrap.append(h("div", { class: "empty" }, "No findings — clean session."));
    for (const f of findings) wrap.append(findingCard(f));
  }
  return h("div", { class: "content" }, wrap);
}

function findingCard(f: Finding): HTMLElement {
  return h("div", { class: "finding" },
    h("div", { class: "title" },
      h("span", { class: `sev sev-${f.severity}` }, f.severity),
      f.title,
      h("span", { class: "cat" }, f.category)
    ),
    h("div", { class: "detail" }, f.detail),
    f.refs?.length ? h("div", { class: "refs" }, f.refs.join("  ·  ")) : null
  );
}

// ---------------- boot ----------------

startCapture();
subscribe(render);
render();

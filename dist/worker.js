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
  function structuralFingerprint(v, prefix = "", out = /* @__PURE__ */ new Set(), depth = 0) {
    const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    out.add(`${prefix}:${t}`);
    if (depth >= 6) return out;
    if (Array.isArray(v)) {
      if (v.length > 0) structuralFingerprint(v[0], `${prefix}[]`, out, depth + 1);
    } else if (t === "object") {
      for (const [k, val] of Object.entries(v).slice(0, 50)) {
        structuralFingerprint(val, `${prefix}.${k}`, out, depth + 1);
      }
    }
    return out;
  }
  function jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  }
  var VOLATILE_KEYS = /^(t|ts|time|timestamp|_|cb|cachebust(er)?|nonce|rand(om)?|r|requestid|request_id|correlationid|traceid|sid|v)$/i;
  function normalizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const params = [...u.searchParams.entries()].map(([k, v]) => VOLATILE_KEYS.test(k) ? `${k}=*` : `${k}=${v}`).sort().join("&");
      const endpoint = `${u.origin}${u.pathname}`;
      return { key: `${endpoint}?${params}`, endpoint };
    } catch {
      return { key: rawUrl, endpoint: rawUrl };
    }
  }
  function canonicalJson(v, depth = 0) {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
    if (depth >= 8) return '"[deep]"';
    if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x, depth + 1)).join(",")}]`;
    const keys = Object.keys(v).sort();
    const parts = keys.map((k) => {
      const val = VOLATILE_KEYS.test(k) ? '"*"' : canonicalJson(v[k], depth + 1);
      return `${JSON.stringify(k)}:${val}`;
    });
    return `{${parts.join(",")}}`;
  }
  function fnv1a(s) {
    let h2 = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h2 ^= s.charCodeAt(i);
      h2 = Math.imul(h2, 16777619);
    }
    return (h2 >>> 0).toString(36);
  }
  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }
  function baseDomain(host) {
    const parts = host.split(".");
    return parts.length <= 2 ? host : parts.slice(-2).join(".");
  }
  function isThirdParty(url, pageOrigin) {
    const a = baseDomain(hostOf(url));
    const b = baseDomain(hostOf(pageOrigin) || pageOrigin.replace(/^https?:\/\//, "").split("/")[0]);
    return a !== "" && b !== "" && a !== b;
  }
  function fmtBytes(n) {
    if (n < 0) return "?";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  function messageSignature(s) {
    return s.replace(/https?:\/\/\S+/g, "<url>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>").replace(/\d+/g, "<n>").slice(0, 200);
  }

  // src/analysis/console-analysis.ts
  var CORRELATION_WINDOW_MS = 500;
  function analyzeConsole(entries, requests) {
    const findings = [];
    if (entries.length === 0) return findings;
    const groups = /* @__PURE__ */ new Map();
    for (const e of entries) {
      const msg = e.args.join(" ");
      const key = `${e.level}|${messageSignature(msg)}`;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { level: e.level, count: 1, sample: msg.slice(0, 160) });
    }
    const errors = [...groups.values()].filter((g) => g.level === "error" || g.level === "uncaught" || g.level === "unhandledrejection");
    const warns = [...groups.values()].filter((g) => g.level === "warn");
    for (const g of errors) {
      findings.push({
        severity: "issue",
        category: "console",
        title: g.count > 1 ? `Error repeated ${g.count}\xD7` : "Console error",
        detail: g.sample
      });
    }
    const noisy = [...groups.values()].filter((g) => g.count >= 20 && g.level !== "error");
    for (const g of noisy) {
      findings.push({
        severity: "info",
        category: "console",
        title: `Noisy ${g.level}: ${g.count} repetitions`,
        detail: `"${g.sample}" \u2014 repeated logging hurts performance and drowns real errors.`
      });
    }
    if (warns.length > 10) {
      findings.push({
        severity: "info",
        category: "console",
        title: `${warns.length} distinct warning types`,
        detail: "High warning diversity often hides deprecations that will break on a browser update."
      });
    }
    const failed = requests.filter((r) => r.status >= 400);
    const errorEntries = entries.filter((e) => e.level === "error" || e.level === "uncaught" || e.level === "unhandledrejection");
    const correlated = /* @__PURE__ */ new Set();
    for (const err of errorEntries) {
      for (const r of failed) {
        const end = r.startedAt + r.time;
        if (Math.abs(err.ts - end) <= CORRELATION_WINDOW_MS) {
          const key = `${r.url}|${messageSignature(err.args.join(" "))}`;
          if (correlated.has(key)) continue;
          correlated.add(key);
          findings.push({
            severity: "issue",
            category: "console",
            title: `Console error correlates with HTTP ${r.status}`,
            detail: `"${err.args.join(" ").slice(0, 120)}" fired within ${CORRELATION_WINDOW_MS}ms of ${r.method} ${r.url} \u2192 ${r.status}. Likely cause & effect.`,
            refs: [r.url]
          });
        }
      }
    }
    return findings;
  }

  // src/analysis/duplicates.ts
  var PARTIAL_THRESHOLD = 0.8;
  var RESPONSE_THRESHOLD = 0.9;
  var MAX_BUCKET = 50;
  function findDuplicates(requests) {
    const findings = [];
    const httpReqs = requests.filter((r) => r.method !== "");
    const exact = /* @__PURE__ */ new Map();
    for (const r of httpReqs) {
      const { key } = normalizeUrl(r.url);
      const bodyJson = tryParseJson(r.postData);
      const bodyKey = bodyJson !== void 0 ? fnv1a(canonicalJson(bodyJson)) : fnv1a(r.postData || "");
      const k = `${r.method} ${key} ${bodyKey}`;
      const arr = exact.get(k) || [];
      arr.push(r);
      exact.set(k, arr);
    }
    for (const [, group] of exact) {
      if (group.length < 2) continue;
      const spanMs = Math.max(...group.map((g) => g.startedAt)) - Math.min(...group.map((g) => g.startedAt));
      findings.push({
        severity: group.length >= 4 ? "issue" : "warn",
        category: "duplicates",
        title: `${group.length}\xD7 identical ${group[0].method} ${shortUrl(group[0].url)}`,
        detail: `Same normalized URL and body sent ${group.length} times within ${(spanMs / 1e3).toFixed(1)}s. Consider caching, request dedup, or memoizing the caller.`,
        refs: [group[0].url]
      });
    }
    const byEndpoint = /* @__PURE__ */ new Map();
    for (const r of httpReqs) {
      if (!r.postData) continue;
      const { endpoint } = normalizeUrl(r.url);
      const arr = byEndpoint.get(`${r.method} ${endpoint}`) || [];
      arr.push(r);
      byEndpoint.set(`${r.method} ${endpoint}`, arr);
    }
    for (const [ep, group] of byEndpoint) {
      if (group.length < 2) continue;
      const sample = group.slice(0, MAX_BUCKET);
      const fps = sample.map((r) => {
        const j = tryParseJson(r.postData);
        return j === void 0 ? void 0 : structuralFingerprint(j);
      });
      let pairs = 0;
      for (let i = 0; i < sample.length && pairs < 3; i++) {
        for (let j = i + 1; j < sample.length && pairs < 3; j++) {
          const a = fps[i];
          const b = fps[j];
          if (!a || !b) continue;
          if (canonicalJson(tryParseJson(sample[i].postData)) === canonicalJson(tryParseJson(sample[j].postData))) continue;
          const sim = jaccard(a, b);
          if (sim >= PARTIAL_THRESHOLD) {
            pairs++;
            findings.push({
              severity: "info",
              category: "duplicates",
              title: `Near-duplicate requests to ${ep.split(" ")[1] ?? ep}`,
              detail: `Two requests share ${(sim * 100).toFixed(0)}% of their body structure with different values. If only ids differ, consider batching or a parameterized cache.`,
              refs: [sample[i].url, sample[j].url]
            });
          }
        }
      }
    }
    const jsonResponses = httpReqs.filter((r) => r.body && /json/i.test(r.mimeType)).slice(0, 200);
    const buckets = /* @__PURE__ */ new Map();
    for (const r of jsonResponses) {
      const parsed = tryParseJson(r.body);
      if (parsed === void 0) continue;
      const sizeBucket = Math.round(Math.log2((r.body.length || 1) + 1));
      const key = `${r.mimeType}|${sizeBucket}`;
      const arr = buckets.get(key) || [];
      if (arr.length < MAX_BUCKET) arr.push({ r, fp: structuralFingerprint(parsed) });
      buckets.set(key, arr);
    }
    const reportedPairs = /* @__PURE__ */ new Set();
    for (const [, arr] of buckets) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const epA = normalizeUrl(arr[i].r.url).endpoint;
          const epB = normalizeUrl(arr[j].r.url).endpoint;
          if (epA === epB) continue;
          const pairKey = [epA, epB].sort().join("|");
          if (reportedPairs.has(pairKey)) continue;
          const sim = jaccard(arr[i].fp, arr[j].fp);
          if (sim >= RESPONSE_THRESHOLD) {
            reportedPairs.add(pairKey);
            findings.push({
              severity: "info",
              category: "duplicates",
              title: "Different endpoints returning near-identical data",
              detail: `Responses from two endpoints share ${(sim * 100).toFixed(0)}% structure \u2014 possible over-fetching or a redundant call.`,
              refs: [arr[i].r.url, arr[j].r.url]
            });
          }
        }
      }
    }
    return findings;
  }
  function shortUrl(u) {
    try {
      const url = new URL(u);
      return url.pathname.length > 40 ? url.pathname.slice(0, 40) + "\u2026" : url.pathname;
    } catch {
      return u.slice(0, 50);
    }
  }

  // src/analysis/privacy-lists.ts
  var TRACKER_DOMAINS = /* @__PURE__ */ new Set([
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "facebook.net",
    "connect.facebook.net",
    "hotjar.com",
    "mixpanel.com",
    "segment.com",
    "segment.io",
    "amplitude.com",
    "fullstory.com",
    "mouseflow.com",
    "clarity.ms",
    "newrelic.com",
    "nr-data.net",
    "sentry.io",
    "bugsnag.com",
    "datadoghq.com",
    "branch.io",
    "adjust.com",
    "appsflyer.com",
    "criteo.com",
    "criteo.net",
    "taboola.com",
    "outbrain.com",
    "scorecardresearch.com",
    "quantserve.com",
    "chartbeat.com",
    "parsely.com",
    "optimizely.com",
    "crazyegg.com",
    "heap.io",
    "heapanalytics.com",
    "kissmetrics.com",
    "matomo.cloud",
    "plausible.io",
    "yandex.ru",
    "mc.yandex.ru",
    "vk.com",
    "tiktok.com",
    "analytics.tiktok.com",
    "snapchat.com",
    "sc-static.net",
    "pinterest.com",
    "ct.pinterest.com",
    "linkedin.com",
    "ads.linkedin.com",
    "bing.com",
    "bat.bing.com",
    "adsrvr.org",
    "rubiconproject.com",
    "pubmatic.com",
    "openx.net",
    "casalemedia.com",
    "adnxs.com",
    "amazon-adsystem.com",
    "moatads.com",
    "onetrust.com",
    "cookielaw.org",
    "braze.com",
    "iterable.com",
    "klaviyo.com",
    "intercom.io",
    "drift.com",
    "hs-analytics.net",
    "hubspot.com"
  ]);
  var TRACKING_HEADERS = {
    "x-client-data": "Chrome-specific header sent to Google properties; carries an install-specific identifier.",
    "x-fb-debug": "Facebook debugging/tracking header.",
    "x-requested-id": "Request correlation id \u2014 fine server-side, but can be used to stitch sessions."
  };
  var FINGERPRINT_CLIENT_HINTS = [
    "sec-ch-ua-full-version-list",
    "sec-ch-ua-arch",
    "sec-ch-ua-model",
    "sec-ch-ua-bitness",
    "sec-ch-ua-platform-version",
    "sec-ch-device-memory",
    "sec-ch-dpr"
  ];
  var SENSITIVE_PARAM_RE = /^(password|passwd|pwd|secret|token|access_token|auth|authorization|api[_-]?key|apikey|session|sessionid|ssn|credit_card|card_number)$/i;
  var SECRET_VALUE_PATTERNS = [
    { name: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
    { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
    { name: "Stripe-style secret key", re: /sk_(live|test)_[0-9a-zA-Z]{20,}/ },
    { name: "Generic API key assignment", re: /(api[_-]?key|secret|private[_-]?key)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/i },
    { name: "Bearer token in text", re: /Bearer\s+[A-Za-z0-9_\-.=]{20,}/ }
  ];

  // src/analysis/headers.ts
  var HEADER_ANNOTATIONS = {
    "content-type": "Media type of the body.",
    "content-length": "Body size in bytes.",
    "cache-control": "Caching policy \u2014 who may cache this and for how long.",
    etag: "Version identifier for caching; can also be abused as a tracking id.",
    "last-modified": "When the resource last changed (cache validation).",
    expires: "Legacy cache expiry timestamp (Cache-Control wins).",
    authorization: "Credentials (e.g. Bearer token) \u2014 sensitive.",
    cookie: "Cookies sent to the server \u2014 may contain session/tracking ids.",
    "set-cookie": "Server sets a cookie in the browser.",
    origin: "Origin of the requesting page (CORS).",
    referer: "URL of the page that triggered this request \u2014 can leak browsing data.",
    "referrer-policy": "How much of the Referer URL is shared with other sites.",
    "user-agent": "Browser/OS identification string.",
    accept: "Media types the client will accept.",
    "accept-language": "Preferred languages \u2014 a fingerprinting signal.",
    "accept-encoding": "Compression formats the client supports.",
    "content-security-policy": "Restricts what the page may load/execute \u2014 key XSS defence.",
    "strict-transport-security": "Forces HTTPS for future visits (HSTS).",
    "x-content-type-options": "'nosniff' stops MIME-type guessing attacks.",
    "x-frame-options": "Blocks embedding in iframes (clickjacking defence).",
    "access-control-allow-origin": "Which origins may read this response (CORS).",
    "access-control-allow-credentials": "Whether CORS requests may include cookies.",
    "x-powered-by": "Server technology disclosure \u2014 remove in production.",
    server: "Server software disclosure \u2014 version strings help attackers.",
    vary: "Request headers that change the response (caching correctness).",
    "transfer-encoding": "How the body is streamed (e.g. chunked).",
    connection: "Connection management (keep-alive).",
    "www-authenticate": "Server demands authentication.",
    location: "Redirect target.",
    "x-request-id": "Request correlation id for server logs.",
    "retry-after": "When to retry after 429/503.",
    "permissions-policy": "Disables browser features (camera, geolocation\u2026) for the page.",
    "cross-origin-opener-policy": "Isolates the browsing context from cross-origin windows.",
    "cross-origin-resource-policy": "Which origins may embed this resource.",
    "timing-allow-origin": "Who may read detailed resource timing.",
    age: "Seconds the response sat in a shared cache.",
    pragma: "Legacy no-cache directive."
  };
  var h = (headers, name) => headers.find((x) => x.name.toLowerCase() === name)?.value;
  function analyzeHeaders(requests, pageOrigin) {
    const findings = [];
    if (requests.length === 0) return findings;
    const docs = requests.filter((r) => r.resourceType === "document" && r.status > 0 && r.status < 400);
    for (const d of docs.slice(0, 5)) {
      const missing = [];
      if (!h(d.resHeaders, "content-security-policy")) missing.push("Content-Security-Policy");
      if (d.url.startsWith("https:") && !h(d.resHeaders, "strict-transport-security")) missing.push("Strict-Transport-Security");
      if (!h(d.resHeaders, "x-content-type-options")) missing.push("X-Content-Type-Options");
      if (!h(d.resHeaders, "referrer-policy")) missing.push("Referrer-Policy");
      if (missing.length) {
        findings.push({
          severity: missing.includes("Content-Security-Policy") ? "issue" : "warn",
          category: "security",
          title: `Missing security headers on ${hostOf(d.url)}`,
          detail: `Document response lacks: ${missing.join(", ")}.`,
          refs: [d.url]
        });
      }
    }
    const disclosed = /* @__PURE__ */ new Map();
    for (const r of requests) {
      for (const name of ["server", "x-powered-by"]) {
        const v = h(r.resHeaders, name);
        if (v && /\d/.test(v)) disclosed.set(`${hostOf(r.url)} ${name}: ${v}`, r.url);
      }
    }
    if (disclosed.size) {
      findings.push({
        severity: "info",
        category: "security",
        title: "Server version disclosure",
        detail: `Version strings in response headers help attackers pick exploits: ${[...disclosed.keys()].slice(0, 5).join("; ")}${disclosed.size > 5 ? " \u2026" : ""}`,
        refs: [...disclosed.values()].slice(0, 5)
      });
    }
    for (const r of requests) {
      if (h(r.resHeaders, "access-control-allow-origin") === "*" && h(r.resHeaders, "access-control-allow-credentials") === "true") {
        findings.push({
          severity: "issue",
          category: "security",
          title: "Dangerous CORS combination",
          detail: "Access-Control-Allow-Origin: * together with Allow-Credentials: true \u2014 browsers reject it, and it signals a misconfigured CORS layer.",
          refs: [r.url]
        });
      }
    }
    const badCookies = [];
    for (const r of requests) {
      for (const hd of r.resHeaders) {
        if (hd.name.toLowerCase() !== "set-cookie") continue;
        const c = hd.value;
        const cname = c.split("=")[0];
        const flags = [];
        if (r.url.startsWith("https:") && !/;\s*secure/i.test(c)) flags.push("no Secure");
        if (!/;\s*httponly/i.test(c)) flags.push("no HttpOnly");
        if (!/;\s*samesite/i.test(c)) flags.push("no SameSite");
        if (flags.length) badCookies.push(`${cname} (${flags.join(", ")}) from ${hostOf(r.url)}`);
      }
    }
    if (badCookies.length) {
      findings.push({
        severity: "warn",
        category: "security",
        title: `${badCookies.length} cookie(s) missing protective flags`,
        detail: badCookies.slice(0, 8).join("; ") + (badCookies.length > 8 ? " \u2026" : "")
      });
    }
    for (const r of requests) {
      try {
        const u = new URL(r.url);
        for (const [k, v] of u.searchParams.entries()) {
          if (SENSITIVE_PARAM_RE.test(k) && v.length >= 8) {
            findings.push({
              severity: "issue",
              category: "security",
              title: `Sensitive parameter "${k}" in URL`,
              detail: `URLs end up in server logs, proxies and browser history. Move "${k}" to a header or body. (${u.origin}${u.pathname})`,
              refs: [r.url]
            });
          }
        }
        for (const p of SECRET_VALUE_PATTERNS) {
          if (p.re.test(u.search)) {
            findings.push({
              severity: "issue",
              category: "security",
              title: `${p.name} found in URL query string`,
              detail: `A credential-shaped value is being sent in the URL to ${u.origin}${u.pathname}.`,
              refs: [r.url]
            });
            break;
          }
        }
      } catch {
      }
    }
    const trackerHits = /* @__PURE__ */ new Map();
    for (const r of requests) {
      const bd = baseDomain(hostOf(r.url));
      if (TRACKER_DOMAINS.has(bd)) trackerHits.set(bd, (trackerHits.get(bd) || 0) + 1);
    }
    if (trackerHits.size) {
      const list = [...trackerHits.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} (${n})`);
      findings.push({
        severity: trackerHits.size >= 5 ? "warn" : "info",
        category: "privacy",
        title: `${trackerHits.size} known tracking/analytics service(s) contacted`,
        detail: list.slice(0, 10).join(", ") + (list.length > 10 ? " \u2026" : "")
      });
    }
    const thirdPartyCookieHosts = /* @__PURE__ */ new Set();
    for (const r of requests) {
      if (isThirdParty(r.url, pageOrigin) && h(r.reqHeaders, "cookie")) thirdPartyCookieHosts.add(hostOf(r.url));
    }
    if (thirdPartyCookieHosts.size) {
      findings.push({
        severity: "info",
        category: "privacy",
        title: `Cookies sent to ${thirdPartyCookieHosts.size} third-party host(s)`,
        detail: [...thirdPartyCookieHosts].slice(0, 10).join(", ") + (thirdPartyCookieHosts.size > 10 ? " \u2026" : "")
      });
    }
    const seenTracking = /* @__PURE__ */ new Set();
    const hintHosts = /* @__PURE__ */ new Map();
    for (const r of requests) {
      for (const hd of r.reqHeaders) {
        const n = hd.name.toLowerCase();
        if (TRACKING_HEADERS[n] && !seenTracking.has(n)) {
          seenTracking.add(n);
          findings.push({
            severity: "info",
            category: "privacy",
            title: `Tracking-capable header: ${hd.name}`,
            detail: TRACKING_HEADERS[n],
            refs: [r.url]
          });
        }
        if (FINGERPRINT_CLIENT_HINTS.includes(n)) {
          const host = hostOf(r.url);
          const s = hintHosts.get(host) || /* @__PURE__ */ new Set();
          s.add(n);
          hintHosts.set(host, s);
        }
      }
    }
    for (const [host, hints] of hintHosts) {
      if (hints.size >= 3) {
        findings.push({
          severity: "warn",
          category: "privacy",
          title: `High-entropy client hints requested by ${host}`,
          detail: `${hints.size} fingerprinting-grade hints sent: ${[...hints].join(", ")}. Together these can uniquely identify a device.`
        });
      }
    }
    return findings;
  }

  // src/analysis/sources-analysis.ts
  var LARGE_BUNDLE = 1024 * 1024;
  function analyzeSources(sources) {
    const findings = [];
    if (sources.length === 0) return findings;
    const byType = /* @__PURE__ */ new Map();
    let thirdPartyCount = 0;
    for (const s of sources) {
      const t = byType.get(s.type) || { count: 0, size: 0 };
      t.count++;
      if (s.size > 0) t.size += s.size;
      byType.set(s.type, t);
      if (s.thirdParty) thirdPartyCount++;
    }
    const inv = [...byType.entries()].sort((a, b) => b[1].size - a[1].size).map(([t, v]) => `${t}: ${v.count} (${fmtBytes(v.size)})`).join(", ");
    findings.push({
      severity: "info",
      category: "sources",
      title: `${sources.length} resources loaded (${thirdPartyCount} third-party)`,
      detail: inv
    });
    for (const s of sources) {
      if (s.type === "script" && s.size >= LARGE_BUNDLE) {
        findings.push({
          severity: "warn",
          category: "sources",
          title: `Large script: ${fmtBytes(s.size)}`,
          detail: `${s.url} \u2014 consider code-splitting or lazy loading.`,
          refs: [s.url]
        });
      }
    }
    const bySize = /* @__PURE__ */ new Map();
    for (const s of sources) {
      if (s.type !== "script" || s.size <= 1e4) continue;
      const arr = bySize.get(s.size) || [];
      arr.push(s.url);
      bySize.set(s.size, arr);
    }
    for (const [size, urls] of bySize) {
      if (urls.length >= 2) {
        findings.push({
          severity: "info",
          category: "sources",
          title: "Possible duplicate script payloads",
          detail: `${urls.length} scripts have identical size (${fmtBytes(size)}) \u2014 the same bundle may load twice under different URLs.`,
          refs: urls.slice(0, 4)
        });
      }
    }
    for (const s of sources) {
      if (!s.contentSample || s.thirdParty) continue;
      for (const p of SECRET_VALUE_PATTERNS) {
        const m = s.contentSample.match(p.re);
        if (m) {
          findings.push({
            severity: "issue",
            category: "sources",
            title: `${p.name} in page source`,
            detail: `Credential-shaped value ("${m[0].slice(0, 24)}\u2026") found in ${s.url}. Anything shipped to the browser is public.`,
            refs: [s.url]
          });
          break;
        }
      }
    }
    return findings;
  }

  // src/analysis/worker.ts
  var ctx = self;
  ctx.onmessage = (e) => {
    const input = e.data;
    const findings = [];
    try {
      findings.push(...analyzeHeaders(input.requests, input.pageOrigin));
      findings.push(...findDuplicates(input.requests));
      findings.push(...analyzeConsole(input.consoleEntries, input.requests));
      findings.push(...analyzeSources(input.sources));
      const failed = input.requests.filter((r) => r.status >= 400);
      if (failed.length) {
        const byStatus = /* @__PURE__ */ new Map();
        for (const f of failed) byStatus.set(f.status, (byStatus.get(f.status) || 0) + 1);
        findings.push({
          severity: "issue",
          category: "network",
          title: `${failed.length} failed request(s)`,
          detail: [...byStatus.entries()].map(([s, n]) => `${n}\xD7 HTTP ${s}`).join(", "),
          refs: failed.slice(0, 5).map((f) => f.url)
        });
      }
      const slow = input.requests.filter((r) => r.time > 3e3 && !r.fromCache);
      for (const s of slow.slice(0, 5)) {
        findings.push({
          severity: "warn",
          category: "network",
          title: `Slow request: ${(s.time / 1e3).toFixed(1)}s`,
          detail: `${s.method} ${s.url}`,
          refs: [s.url]
        });
      }
    } catch (err) {
      findings.push({
        severity: "warn",
        category: "network",
        title: "Analysis error",
        detail: String(err)
      });
    }
    const order = { issue: 0, warn: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    const result = { findings, headerAnnotations: HEADER_ANNOTATIONS };
    ctx.postMessage(result);
  };
})();

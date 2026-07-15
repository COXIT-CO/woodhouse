import type { Finding, Header, ReqEntry } from "../shared/types";
import {
  FINGERPRINT_CLIENT_HINTS,
  SECRET_VALUE_PATTERNS,
  SENSITIVE_PARAM_RE,
  TRACKER_DOMAINS,
  TRACKING_HEADERS,
} from "./privacy-lists";
import { baseDomain, hostOf, isThirdParty } from "./util";

/** Plain-language meanings for common headers (lowercase names). */
export const HEADER_ANNOTATIONS: Record<string, string> = {
  "content-type": "Media type of the body.",
  "content-length": "Body size in bytes.",
  "cache-control": "Caching policy — who may cache this and for how long.",
  etag: "Version identifier for caching; can also be abused as a tracking id.",
  "last-modified": "When the resource last changed (cache validation).",
  expires: "Legacy cache expiry timestamp (Cache-Control wins).",
  authorization: "Credentials (e.g. Bearer token) — sensitive.",
  cookie: "Cookies sent to the server — may contain session/tracking ids.",
  "set-cookie": "Server sets a cookie in the browser.",
  origin: "Origin of the requesting page (CORS).",
  referer: "URL of the page that triggered this request — can leak browsing data.",
  "referrer-policy": "How much of the Referer URL is shared with other sites.",
  "user-agent": "Browser/OS identification string.",
  accept: "Media types the client will accept.",
  "accept-language": "Preferred languages — a fingerprinting signal.",
  "accept-encoding": "Compression formats the client supports.",
  "content-security-policy": "Restricts what the page may load/execute — key XSS defence.",
  "strict-transport-security": "Forces HTTPS for future visits (HSTS).",
  "x-content-type-options": "'nosniff' stops MIME-type guessing attacks.",
  "x-frame-options": "Blocks embedding in iframes (clickjacking defence).",
  "access-control-allow-origin": "Which origins may read this response (CORS).",
  "access-control-allow-credentials": "Whether CORS requests may include cookies.",
  "x-powered-by": "Server technology disclosure — remove in production.",
  server: "Server software disclosure — version strings help attackers.",
  vary: "Request headers that change the response (caching correctness).",
  "transfer-encoding": "How the body is streamed (e.g. chunked).",
  connection: "Connection management (keep-alive).",
  "www-authenticate": "Server demands authentication.",
  location: "Redirect target.",
  "x-request-id": "Request correlation id for server logs.",
  "retry-after": "When to retry after 429/503.",
  "permissions-policy": "Disables browser features (camera, geolocation…) for the page.",
  "cross-origin-opener-policy": "Isolates the browsing context from cross-origin windows.",
  "cross-origin-resource-policy": "Which origins may embed this resource.",
  "timing-allow-origin": "Who may read detailed resource timing.",
  age: "Seconds the response sat in a shared cache.",
  pragma: "Legacy no-cache directive.",
};

const h = (headers: Header[], name: string): string | undefined =>
  headers.find((x) => x.name.toLowerCase() === name)?.value;

export function analyzeHeaders(requests: ReqEntry[], pageOrigin: string): Finding[] {
  const findings: Finding[] = [];
  if (requests.length === 0) return findings;

  // ---- security posture: main document responses ----
  const docs = requests.filter((r) => r.resourceType === "document" && r.status > 0 && r.status < 400);
  for (const d of docs.slice(0, 5)) {
    const missing: string[] = [];
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
        refs: [d.url],
      });
    }
  }

  // ---- version disclosure ----
  const disclosed = new Map<string, string>();
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
      detail: `Version strings in response headers help attackers pick exploits: ${[...disclosed.keys()].slice(0, 5).join("; ")}${disclosed.size > 5 ? " …" : ""}`,
      refs: [...disclosed.values()].slice(0, 5),
    });
  }

  // ---- CORS misconfiguration ----
  for (const r of requests) {
    if (h(r.resHeaders, "access-control-allow-origin") === "*" && h(r.resHeaders, "access-control-allow-credentials") === "true") {
      findings.push({
        severity: "issue",
        category: "security",
        title: "Dangerous CORS combination",
        detail: "Access-Control-Allow-Origin: * together with Allow-Credentials: true — browsers reject it, and it signals a misconfigured CORS layer.",
        refs: [r.url],
      });
    }
  }

  // ---- cookie audit ----
  const badCookies: string[] = [];
  for (const r of requests) {
    for (const hd of r.resHeaders) {
      if (hd.name.toLowerCase() !== "set-cookie") continue;
      const c = hd.value;
      const cname = c.split("=")[0];
      const flags: string[] = [];
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
      detail: badCookies.slice(0, 8).join("; ") + (badCookies.length > 8 ? " …" : ""),
    });
  }

  // ---- secrets in URLs ----
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
            refs: [r.url],
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
            refs: [r.url],
          });
          break;
        }
      }
    } catch {
      /* invalid url */
    }
  }

  // ---- privacy: trackers ----
  const trackerHits = new Map<string, number>();
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
      detail: list.slice(0, 10).join(", ") + (list.length > 10 ? " …" : ""),
    });
  }

  // ---- privacy: third-party cookie senders ----
  const thirdPartyCookieHosts = new Set<string>();
  for (const r of requests) {
    if (isThirdParty(r.url, pageOrigin) && h(r.reqHeaders, "cookie")) thirdPartyCookieHosts.add(hostOf(r.url));
  }
  if (thirdPartyCookieHosts.size) {
    findings.push({
      severity: "info",
      category: "privacy",
      title: `Cookies sent to ${thirdPartyCookieHosts.size} third-party host(s)`,
      detail: [...thirdPartyCookieHosts].slice(0, 10).join(", ") + (thirdPartyCookieHosts.size > 10 ? " …" : ""),
    });
  }

  // ---- privacy: tracking headers & client hints ----
  const seenTracking = new Set<string>();
  const hintHosts = new Map<string, Set<string>>();
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
          refs: [r.url],
        });
      }
      if (FINGERPRINT_CLIENT_HINTS.includes(n)) {
        const host = hostOf(r.url);
        const s = hintHosts.get(host) || new Set();
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
        detail: `${hints.size} fingerprinting-grade hints sent: ${[...hints].join(", ")}. Together these can uniquely identify a device.`,
      });
    }
  }

  return findings;
}

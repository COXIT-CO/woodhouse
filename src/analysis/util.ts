/** Shared helpers for analysis modules. Pure functions only. */

export function tryParseJson(s: string | undefined): unknown | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Flatten a JSON value into a set of "path:type" strings (structural fingerprint). */
export function structuralFingerprint(v: unknown, prefix = "", out = new Set<string>(), depth = 0): Set<string> {
  const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  out.add(`${prefix}:${t}`);
  if (depth >= 6) return out;
  if (Array.isArray(v)) {
    // sample first element only — arrays are homogeneous often enough
    if (v.length > 0) structuralFingerprint(v[0], `${prefix}[]`, out, depth + 1);
  } else if (t === "object") {
    for (const [k, val] of Object.entries(v as object).slice(0, 50)) {
      structuralFingerprint(val, `${prefix}.${k}`, out, depth + 1);
    }
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const VOLATILE_KEYS = /^(t|ts|time|timestamp|_|cb|cachebust(er)?|nonce|rand(om)?|r|requestid|request_id|correlationid|traceid|sid|v)$/i;

/** Normalize a URL for duplicate grouping: sorted query keys, volatile values masked. */
export function normalizeUrl(rawUrl: string): { key: string; endpoint: string } {
  try {
    const u = new URL(rawUrl);
    const params = [...u.searchParams.entries()]
      .map(([k, v]) => (VOLATILE_KEYS.test(k) ? `${k}=*` : `${k}=${v}`))
      .sort()
      .join("&");
    const endpoint = `${u.origin}${u.pathname}`;
    return { key: `${endpoint}?${params}`, endpoint };
  } catch {
    return { key: rawUrl, endpoint: rawUrl };
  }
}

/** Canonicalize JSON for body hashing: sorted keys, volatile fields masked. */
export function canonicalJson(v: unknown, depth = 0): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (depth >= 8) return '"[deep]"';
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x, depth + 1)).join(",")}]`;
  const keys = Object.keys(v as object).sort();
  const parts = keys.map((k) => {
    const val = VOLATILE_KEYS.test(k) ? '"*"' : canonicalJson((v as Record<string, unknown>)[k], depth + 1);
    return `${JSON.stringify(k)}:${val}`;
  });
  return `{${parts.join(",")}}`;
}

/** FNV-1a — cheap stable hash for grouping. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Registrable-ish domain: last two labels (good enough without a PSL dependency). */
export function baseDomain(host: string): string {
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

export function isThirdParty(url: string, pageOrigin: string): boolean {
  const a = baseDomain(hostOf(url));
  const b = baseDomain(hostOf(pageOrigin) || pageOrigin.replace(/^https?:\/\//, "").split("/")[0]);
  return a !== "" && b !== "" && a !== b;
}

export function fmtBytes(n: number): string {
  if (n < 0) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Signature for console-message grouping: strip numbers, uuids, urls. */
export function messageSignature(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\d+/g, "<n>")
    .slice(0, 200);
}

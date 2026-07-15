/** Unit tests for the analysis engine. Run: npm test */
import assert from "node:assert/strict";
import { analyzeConsole } from "../src/analysis/console-analysis";
import { findDuplicates } from "../src/analysis/duplicates";
import { analyzeHeaders } from "../src/analysis/headers";
import { summarizeJson } from "../src/analysis/json-summary";
import { analyzeSources } from "../src/analysis/sources-analysis";
import { canonicalJson, jaccard, messageSignature, normalizeUrl, structuralFingerprint } from "../src/analysis/util";
import type { ConsoleEntry, Header, ReqEntry, SourceMeta } from "../src/shared/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const H = (o: Record<string, string>): Header[] => Object.entries(o).map(([name, value]) => ({ name, value }));

function req(over: Partial<ReqEntry>): ReqEntry {
  return {
    id: Math.floor(Math.random() * 1e9),
    startedAt: Date.now(),
    method: "GET",
    url: "https://app.example.com/api/data",
    status: 200,
    statusText: "OK",
    mimeType: "application/json",
    resourceType: "xhr",
    reqHeaders: [],
    resHeaders: [],
    queryString: [],
    bodySize: 100,
    transferSize: 120,
    time: 50,
    fromCache: false,
    ...over,
  };
}

// ---------------- util ----------------
console.log("util:");

test("normalizeUrl masks volatile query params and sorts", () => {
  const a = normalizeUrl("https://x.com/api?b=2&ts=111&a=1");
  const b = normalizeUrl("https://x.com/api?a=1&ts=999&b=2");
  assert.equal(a.key, b.key);
  assert.equal(a.endpoint, "https://x.com/api");
});

test("canonicalJson is key-order independent and masks volatile keys", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ x: 1, timestamp: 111 }), canonicalJson({ x: 1, timestamp: 999 }));
});

test("structural fingerprint + jaccard detects similar shapes", () => {
  const a = structuralFingerprint({ user: { id: 1, name: "a" }, items: [1] });
  const b = structuralFingerprint({ user: { id: 2, name: "b" }, items: [9] });
  assert.equal(jaccard(a, b), 1);
  const c = structuralFingerprint({ totally: "different", nested: { x: true } });
  assert.ok(jaccard(a, c) < 0.5);
});

test("messageSignature groups numbers/uuids/urls", () => {
  assert.equal(messageSignature("failed 3 times for id 42"), messageSignature("failed 7 times for id 99"));
});

// ---------------- json summary ----------------
console.log("json-summary:");

test("summarizes object", () => {
  const s = summarizeJson('{"a":1,"b":{"c":2}}');
  assert.equal(s?.kind, "object");
  assert.ok(s!.description.includes("2 key(s)"));
});

test("summarizes array of objects", () => {
  const s = summarizeJson('[{"id":1},{"id":2}]');
  assert.equal(s?.kind, "array");
  assert.equal(s?.arrayLength, 2);
});

test("rejects non-json", () => {
  assert.equal(summarizeJson("<html></html>"), undefined);
});

// ---------------- duplicates ----------------
console.log("duplicates:");

test("flags exact duplicates (volatile params ignored)", () => {
  const rs = [
    req({ url: "https://x.com/api/list?page=1&ts=1" }),
    req({ url: "https://x.com/api/list?page=1&ts=2" }),
    req({ url: "https://x.com/api/list?page=2&ts=3" }),
  ];
  const f = findDuplicates(rs);
  const dup = f.find((x) => x.title.includes("2× identical"));
  assert.ok(dup, `expected duplicate finding, got: ${JSON.stringify(f.map((x) => x.title))}`);
});

test("flags partial duplicates on same endpoint", () => {
  const rs = [
    req({ method: "POST", url: "https://x.com/api/save", postData: '{"user":{"id":1,"name":"a"},"flags":[true]}' }),
    req({ method: "POST", url: "https://x.com/api/save", postData: '{"user":{"id":2,"name":"b"},"flags":[false]}' }),
  ];
  const f = findDuplicates(rs);
  assert.ok(
    f.some((x) => x.title.includes("Near-duplicate")) || f.some((x) => x.title.includes("identical")),
    `got: ${JSON.stringify(f.map((x) => x.title))}`
  );
});

test("flags near-identical responses across endpoints", () => {
  const body = JSON.stringify({ items: [{ id: 1, name: "x", price: 2 }], total: 1 });
  const rs = [
    req({ url: "https://x.com/api/products", body }),
    req({ url: "https://x.com/api/catalog", body: JSON.stringify({ items: [{ id: 9, name: "y", price: 5 }], total: 1 }) }),
  ];
  const f = findDuplicates(rs);
  assert.ok(f.some((x) => x.title.includes("near-identical data")), JSON.stringify(f.map((x) => x.title)));
});

test("no duplicate findings on distinct requests", () => {
  const rs = [req({ url: "https://x.com/a" }), req({ url: "https://x.com/b" })];
  assert.equal(findDuplicates(rs).length, 0);
});

// ---------------- headers ----------------
console.log("headers:");

test("flags missing security headers on document", () => {
  const rs = [req({ resourceType: "document", url: "https://site.com/", resHeaders: H({ "content-type": "text/html" }) })];
  const f = analyzeHeaders(rs, "https://site.com");
  assert.ok(f.some((x) => x.title.includes("Missing security headers")));
});

test("clean document produces no security-header finding", () => {
  const rs = [
    req({
      resourceType: "document",
      url: "https://site.com/",
      resHeaders: H({
        "content-security-policy": "default-src 'self'",
        "strict-transport-security": "max-age=63072000",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
      }),
    }),
  ];
  const f = analyzeHeaders(rs, "https://site.com");
  assert.ok(!f.some((x) => x.title.includes("Missing security headers")));
});

test("flags token in URL", () => {
  const rs = [req({ url: "https://x.com/api?access_token=abcdefgh12345678" })];
  const f = analyzeHeaders(rs, "https://x.com");
  assert.ok(f.some((x) => x.title.includes('Sensitive parameter "access_token"')));
});

test("flags known trackers", () => {
  const rs = [req({ url: "https://www.google-analytics.com/collect?v=1" })];
  const f = analyzeHeaders(rs, "https://site.com");
  assert.ok(f.some((x) => x.category === "privacy" && x.title.includes("tracking")));
});

test("flags insecure Set-Cookie", () => {
  const rs = [req({ url: "https://site.com/login", resHeaders: H({ "set-cookie": "sid=abc123; Path=/" }) })];
  const f = analyzeHeaders(rs, "https://site.com");
  assert.ok(f.some((x) => x.title.includes("cookie")));
});

// ---------------- console ----------------
console.log("console:");

test("groups repeated errors and correlates with failed request", () => {
  const t = Date.now();
  const entries: ConsoleEntry[] = [
    { ts: t + 100, level: "error", args: ["Fetch failed with 500"] },
    { ts: t + 100, level: "error", args: ["Fetch failed with 500"] },
  ];
  const rs = [req({ url: "https://x.com/api/broken", status: 500, startedAt: t, time: 50 })];
  const f = analyzeConsole(entries, rs);
  assert.ok(f.some((x) => x.title.includes("repeated 2×")), JSON.stringify(f.map((x) => x.title)));
  assert.ok(f.some((x) => x.title.includes("correlates with HTTP 500")));
});

// ---------------- sources ----------------
console.log("sources:");

test("inventory + secret detection", () => {
  const sources: SourceMeta[] = [
    { url: "https://site.com/app.js", type: "script", size: 2_000_000, thirdParty: false, contentSample: 'const k = "AKIA' + 'ABCDEFGHIJKLMNOP";' },
    { url: "https://cdn.x.com/lib.js", type: "script", size: 5000, thirdParty: true },
  ];
  const f = analyzeSources(sources);
  assert.ok(f.some((x) => x.title.includes("resources loaded")));
  assert.ok(f.some((x) => x.title.includes("Large script")));
  assert.ok(f.some((x) => x.title.includes("AWS access key")), JSON.stringify(f.map((x) => x.title)));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

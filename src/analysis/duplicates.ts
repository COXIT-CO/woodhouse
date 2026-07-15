import type { Finding, ReqEntry } from "../shared/types";
import { canonicalJson, fnv1a, jaccard, normalizeUrl, structuralFingerprint, tryParseJson } from "./util";

const PARTIAL_THRESHOLD = 0.8;
const RESPONSE_THRESHOLD = 0.9;
const MAX_BUCKET = 50; // cap O(n²) comparisons

export function findDuplicates(requests: ReqEntry[]): Finding[] {
  const findings: Finding[] = [];
  const httpReqs = requests.filter((r) => r.method !== "");

  // ---- exact duplicates: normalized url + method + canonical body hash ----
  const exact = new Map<string, ReqEntry[]>();
  for (const r of httpReqs) {
    const { key } = normalizeUrl(r.url);
    const bodyJson = tryParseJson(r.postData);
    const bodyKey = bodyJson !== undefined ? fnv1a(canonicalJson(bodyJson)) : fnv1a(r.postData || "");
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
      title: `${group.length}× identical ${group[0].method} ${shortUrl(group[0].url)}`,
      detail: `Same normalized URL and body sent ${group.length} times within ${(spanMs / 1000).toFixed(1)}s. Consider caching, request dedup, or memoizing the caller.`,
      refs: [group[0].url],
    });
  }

  // ---- partial duplicates: same endpoint, similar-but-different bodies ----
  const byEndpoint = new Map<string, ReqEntry[]>();
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
      return j === undefined ? undefined : structuralFingerprint(j);
    });
    let pairs = 0;
    for (let i = 0; i < sample.length && pairs < 3; i++) {
      for (let j = i + 1; j < sample.length && pairs < 3; j++) {
        const a = fps[i];
        const b = fps[j];
        if (!a || !b) continue;
        // skip exact dupes (already reported)
        if (canonicalJson(tryParseJson(sample[i].postData)) === canonicalJson(tryParseJson(sample[j].postData))) continue;
        const sim = jaccard(a, b);
        if (sim >= PARTIAL_THRESHOLD) {
          pairs++;
          findings.push({
            severity: "info",
            category: "duplicates",
            title: `Near-duplicate requests to ${ep.split(" ")[1] ?? ep}`,
            detail: `Two requests share ${(sim * 100).toFixed(0)}% of their body structure with different values. If only ids differ, consider batching or a parameterized cache.`,
            refs: [sample[i].url, sample[j].url],
          });
        }
      }
    }
  }

  // ---- near-identical responses across different endpoints (over-fetching) ----
  const jsonResponses = httpReqs
    .filter((r) => r.body && /json/i.test(r.mimeType))
    .slice(0, 200);
  const buckets = new Map<string, { r: ReqEntry; fp: Set<string> }[]>();
  for (const r of jsonResponses) {
    const parsed = tryParseJson(r.body);
    if (parsed === undefined) continue;
    const sizeBucket = Math.round(Math.log2((r.body!.length || 1) + 1));
    const key = `${r.mimeType}|${sizeBucket}`;
    const arr = buckets.get(key) || [];
    if (arr.length < MAX_BUCKET) arr.push({ r, fp: structuralFingerprint(parsed) });
    buckets.set(key, arr);
  }
  const reportedPairs = new Set<string>();
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
            detail: `Responses from two endpoints share ${(sim * 100).toFixed(0)}% structure — possible over-fetching or a redundant call.`,
            refs: [arr[i].r.url, arr[j].r.url],
          });
        }
      }
    }
  }

  return findings;
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname.length > 40 ? url.pathname.slice(0, 40) + "…" : url.pathname;
  } catch {
    return u.slice(0, 50);
  }
}

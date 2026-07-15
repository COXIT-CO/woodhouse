import { tryParseJson } from "./util";

export interface JsonSummary {
  kind: "object" | "array" | "scalar";
  description: string;
  topKeys: string[];
  arrayLength?: number;
  depth: number;
}

function depthOf(v: unknown, d = 0): number {
  if (d >= 10 || v === null || typeof v !== "object") return d;
  const vals = Array.isArray(v) ? v.slice(0, 10) : Object.values(v as object).slice(0, 20);
  let max = d;
  for (const x of vals) max = Math.max(max, depthOf(x, d + 1));
  return max;
}

export function summarizeJson(body: string | undefined): JsonSummary | undefined {
  const v = tryParseJson(body);
  if (v === undefined) return undefined;
  const depth = depthOf(v);
  if (Array.isArray(v)) {
    const first = v[0];
    const keys = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first).slice(0, 15) : [];
    return {
      kind: "array",
      arrayLength: v.length,
      topKeys: keys,
      depth,
      description: `Array of ${v.length} item(s)${keys.length ? `, items look like {${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", …" : ""}}` : ""}, depth ${depth}`,
    };
  }
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v).slice(0, 15);
    return {
      kind: "object",
      topKeys: keys,
      depth,
      description: `Object with ${Object.keys(v).length} key(s): ${keys.slice(0, 8).join(", ")}${Object.keys(v).length > 8 ? ", …" : ""}, depth ${depth}`,
    };
  }
  return { kind: "scalar", topKeys: [], depth: 0, description: `Scalar JSON value: ${JSON.stringify(v)}` };
}

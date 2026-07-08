import type { Document } from "mongodb";
import { getDb } from "./mongo";
import type { HistoryPoint, PlayerEvent } from "./types";

const RANGES = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000
} as const;

const BUCKETS = {
  "10s": 10_000,
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000
} as const;

export type RangeKey = keyof typeof RANGES;
export type BucketKey = keyof typeof BUCKETS | "auto";
export type TimeWindow =
  | { mode: "range"; range: RangeKey; start: Date; end: Date }
  | { mode: "custom"; range: "custom"; start: Date; end: Date };

export function normalizeRange(value: string | null): RangeKey {
  return isRange(value) ? value : "1h";
}

export function normalizeTimeWindow(params: URLSearchParams): TimeWindow {
  const rawRange = params.get("range");
  if (rawRange === "custom") {
    const start = parseDateParam(params.get("start"));
    const end = parseDateParam(params.get("end"));
    if (!start || !end) throw new Error("custom range requires valid start and end");
    if (start >= end) throw new Error("custom range start must be before end");
    return { mode: "custom", range: "custom", start, end };
  }

  const range = normalizeRange(rawRange);
  return {
    mode: "range",
    range,
    start: new Date(Date.now() - RANGES[range]),
    end: new Date()
  };
}

export function normalizeBucket(value: string | null, window: TimeWindow): keyof typeof BUCKETS {
  if (isBucket(value)) return value;
  if (window.mode === "custom") return autoBucketForSpan(window.end.getTime() - window.start.getTime());
  switch (window.range) {
    case "15m":
      return "10s";
    case "1h":
      return "1m";
    case "6h":
      return "5m";
    case "24h":
      return "15m";
    case "7d":
      return "1h";
  }
}

export async function getHistory(params: {
  server?: string | null;
  window: TimeWindow;
  bucket: keyof typeof BUCKETS;
}): Promise<HistoryPoint[]> {
  const db = await getDb();
  const match: Document = { timestamp: { $gte: params.window.start, $lte: params.window.end } };
  if (params.server) match.server = params.server;

  const bucketMs = BUCKETS[params.bucket];
  const rows = await db.collection("history")
    .find(match, {
      projection: {
        timestamp: 1,
        tps: 1,
        mspt: 1,
        playerCount: 1
      }
    })
    .sort({ timestamp: 1 })
    .toArray();

  const buckets = new Map<number, {
    samples: number;
    tpsSum: number;
    tpsCount: number;
    msptSum: number;
    msptCount: number;
    playerCountSum: number;
    playerCountCount: number;
  }>();

  for (const row of rows) {
    const timestamp = toDate(row.timestamp);
    if (!timestamp) continue;

    const bucketTime = Math.floor(timestamp.getTime() / bucketMs) * bucketMs;
    const current = buckets.get(bucketTime) || {
      samples: 0,
      tpsSum: 0,
      tpsCount: 0,
      msptSum: 0,
      msptCount: 0,
      playerCountSum: 0,
      playerCountCount: 0
    };

    current.samples += 1;
    addNumber(current, "tps", row.tps);
    addNumber(current, "mspt", row.mspt);
    addNumber(current, "playerCount", row.playerCount);
    buckets.set(bucketTime, current);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([timestamp, bucket]) => ({
      timestamp: new Date(timestamp).toISOString(),
      tps: averageOrNull(bucket.tpsSum, bucket.tpsCount),
      mspt: averageOrNull(bucket.msptSum, bucket.msptCount),
      playerCount: averageOrNull(bucket.playerCountSum, bucket.playerCountCount),
      samples: bucket.samples
    }));
}

export async function getEvents(params: {
  server?: string | null;
  window: TimeWindow;
}): Promise<PlayerEvent[]> {
  const db = await getDb();
  const match: Document = { timestamp: { $gte: params.window.start, $lte: params.window.end } };
  if (params.server) match.server = params.server;

  const rows = await db.collection("logs")
    .find(match)
    .sort({ timestamp: -1 })
    .limit(200)
    .toArray();

  return rows.map(row => ({
    id: String(row._id),
    type: row.type,
    uuid: row.uuid,
    username: row.username,
    server: row.server,
    timestamp: row.timestamp.toISOString()
  }));
}

export async function getServers(): Promise<string[]> {
  const db = await getDb();
  const [historyServers, logServers] = await Promise.all([
    db.collection("history").distinct("server", { server: { $type: "string", $ne: "" } }),
    db.collection("logs").distinct("server", { server: { $type: "string", $ne: "" } })
  ]);

  return Array.from(new Set([...historyServers, ...logServers].map(String)))
    .sort((a, b) => a.localeCompare(b));
}

function isRange(value: string | null): value is RangeKey {
  return value !== null && Object.prototype.hasOwnProperty.call(RANGES, value);
}

function isBucket(value: string | null): value is keyof typeof BUCKETS {
  return value !== null && Object.prototype.hasOwnProperty.call(BUCKETS, value);
}

function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function autoBucketForSpan(spanMs: number): keyof typeof BUCKETS {
  if (spanMs <= 30 * 60_000) return "10s";
  if (spanMs <= 2 * 60 * 60_000) return "1m";
  if (spanMs <= 12 * 60 * 60_000) return "5m";
  if (spanMs <= 48 * 60 * 60_000) return "15m";
  return "1h";
}

function roundOrNull(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function addNumber(
  bucket: {
    tpsSum: number;
    tpsCount: number;
    msptSum: number;
    msptCount: number;
    playerCountSum: number;
    playerCountCount: number;
  },
  key: "tps" | "mspt" | "playerCount",
  value: unknown
) {
  const parsed = toNumber(value);
  if (parsed === null) return;

  if (key === "tps") {
    bucket.tpsSum += parsed;
    bucket.tpsCount += 1;
  } else if (key === "mspt") {
    bucket.msptSum += parsed;
    bucket.msptCount += 1;
  } else {
    bucket.playerCountSum += parsed;
    bucket.playerCountCount += 1;
  }
}

function averageOrNull(sum: number, count: number): number | null {
  if (count === 0) return null;
  return Math.round((sum / count) * 100) / 100;
}

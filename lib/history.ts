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
    .aggregate([
      { $match: match },
      {
        $addFields: {
          bucketTime: {
            $toDate: {
              $subtract: [
                { $toLong: "$timestamp" },
                { $mod: [{ $toLong: "$timestamp" }, bucketMs] }
              ]
            }
          },
          tpsNum: { $convert: { input: "$tps", to: "double", onError: null, onNull: null } },
          msptNum: { $convert: { input: "$mspt", to: "double", onError: null, onNull: null } },
          playerCountNum: { $convert: { input: "$playerCount", to: "double", onError: null, onNull: null } }
        }
      },
      {
        $group: {
          _id: "$bucketTime",
          tps: { $avg: "$tpsNum" },
          mspt: { $avg: "$msptNum" },
          playerCount: { $avg: "$playerCountNum" },
          samples: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
    .toArray();

  return rows.map(row => ({
    timestamp: (row._id as Date).toISOString(),
    tps: roundOrNull(row.tps),
    mspt: roundOrNull(row.mspt),
    playerCount: roundOrNull(row.playerCount),
    samples: row.samples
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

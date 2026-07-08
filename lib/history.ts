import type { Document } from "mongodb";
import { getDb } from "./mongo";
import type { DataBounds, HistoryPoint, PlayerEvent, PlayerSession, ServerCatalog } from "./types";

const RANGES = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
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
type NormalizedLogEvent = {
  id: string;
  type: "join" | "leave";
  uuid: string;
  username: string;
  server: string;
  timestamp: Date;
};

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
    case "12h":
      return "15m";
    case "24h":
      return "15m";
    case "3d":
      return "1h";
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
    playerCountLast: number | null;
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
      playerCountLast: null
    };

    current.samples += 1;
    addNumber(current, "tps", row.tps);
    addNumber(current, "mspt", row.mspt);
    const playerCount = toNumber(row.playerCount);
    if (playerCount !== null) current.playerCountLast = playerCount;
    buckets.set(bucketTime, current);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([timestamp, bucket]) => ({
      timestamp: new Date(timestamp).toISOString(),
      tps: averageOrNull(bucket.tpsSum, bucket.tpsCount),
      mspt: averageOrNull(bucket.msptSum, bucket.msptCount),
      playerCount: bucket.playerCountLast,
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

export async function getPlayerSessions(params: {
  server?: string | null;
  window: TimeWindow;
}): Promise<PlayerSession[]> {
  const db = await getDb();
  const serverMatch: Document = {};
  if (params.server) serverMatch.server = params.server;

  const [beforeRows, windowRows, afterRows, historyRows] = await Promise.all([
    db.collection("logs")
      .find({ ...serverMatch, timestamp: { $lt: params.window.start } }, {
        projection: {
          type: 1,
          uuid: 1,
          username: 1,
          server: 1,
          timestamp: 1
        }
      })
      .sort({ timestamp: -1 })
      .limit(5000)
      .toArray(),
    db.collection("logs")
      .find({ ...serverMatch, timestamp: { $gte: params.window.start, $lte: params.window.end } }, {
        projection: {
          type: 1,
          uuid: 1,
          username: 1,
          server: 1,
          timestamp: 1
        }
      })
      .sort({ timestamp: 1 })
      .limit(10000)
      .toArray(),
    db.collection("logs")
      .find({ ...serverMatch, timestamp: { $gt: params.window.end } }, {
        projection: {
          type: 1,
          uuid: 1,
          username: 1,
          server: 1,
          timestamp: 1
        }
      })
      .sort({ timestamp: 1 })
      .limit(5000)
      .toArray(),
    db.collection("history")
      .find({ ...serverMatch, timestamp: { $gte: params.window.start, $lte: params.window.end } }, {
        projection: {
          timestamp: 1,
          playerCount: 1,
          server: 1
        }
      })
      .sort({ timestamp: 1 })
      .limit(20000)
      .toArray()
  ]);

  const active = new Map<string, {
    uuid: string;
    username: string;
    server: string;
    start: Date;
  }>();
  const lastBefore = new Map<string, Document>();

  for (const row of beforeRows) {
    const key = eventKey(row);
    if (!key || lastBefore.has(key)) continue;
    lastBefore.set(key, row);
  }

  for (const row of lastBefore.values()) {
    if (row.type !== "join") continue;
    const normalized = normalizeLogEvent(row);
    if (!normalized) continue;
    active.set(eventKey(normalized)!, {
      uuid: normalized.uuid,
      username: normalized.username,
      server: normalized.server,
      start: normalized.timestamp
    });
  }

  const sessions: PlayerSession[] = [];
  for (const row of windowRows) {
    const event = normalizeLogEvent(row);
    if (!event) continue;

    const key = eventKey(event)!;
    if (event.type === "join") {
      if (!active.has(key)) {
        active.set(key, {
          uuid: event.uuid,
          username: event.username,
          server: event.server,
          start: event.timestamp
        });
      }
      continue;
    }

    const session = active.get(key);
    if (!session) continue;
    sessions.push(toPlayerSession(session, event.timestamp, { open: false, inferred: false }));
    active.delete(key);
  }

  for (const row of afterRows) {
    const event = normalizeLogEvent(row);
    if (!event) continue;

    const key = eventKey(event)!;
    if (event.type !== "leave") continue;

    const session = active.get(key);
    if (!session) continue;
    sessions.push(toPlayerSession(session, event.timestamp, { open: false, inferred: false }));
    active.delete(key);
  }

  sessions.push(...inferMissingSessions(Array.from(active.values()), historyRows));

  return sessions
    .filter(session => new Date(session.end) > new Date(session.start))
    .sort((left, right) => {
      const nameOrder = left.username.localeCompare(right.username);
      if (nameOrder !== 0) return nameOrder;
      return new Date(left.start).getTime() - new Date(right.start).getTime();
    });
}

export async function getServers(): Promise<ServerCatalog> {
  const db = await getDb();
  const [historyServers, logServers, latest] = await Promise.all([
    db.collection("history").distinct("server", { server: { $type: "string", $ne: "" } }),
    db.collection("logs").distinct("server", { server: { $type: "string", $ne: "" } }),
    db.collection("history")
      .find({ server: { $type: "string", $ne: "" } }, { projection: { server: 1 } })
      .sort({ timestamp: -1 })
      .limit(1)
      .next()
  ]);

  return {
    servers: Array.from(new Set([...historyServers, ...logServers].map(String)))
      .sort((a, b) => a.localeCompare(b)),
    latestServer: latest?.server ? String(latest.server) : null
  };
}

export async function getDataBounds(server?: string | null): Promise<DataBounds> {
  const db = await getDb();
  const match: Document = {};
  if (server) match.server = server;

  const [oldestHistory, latestHistory, oldestLog, latestLog] = await Promise.all([
    db.collection("history")
      .find(match, { projection: { timestamp: 1 } })
      .sort({ timestamp: 1 })
      .limit(1)
      .next(),
    db.collection("history")
      .find(match, { projection: { timestamp: 1 } })
      .sort({ timestamp: -1 })
      .limit(1)
      .next(),
    db.collection("logs")
      .find(match, { projection: { timestamp: 1 } })
      .sort({ timestamp: 1 })
      .limit(1)
      .next(),
    db.collection("logs")
      .find(match, { projection: { timestamp: 1 } })
      .sort({ timestamp: -1 })
      .limit(1)
      .next()
  ]);

  const starts = [toDate(oldestHistory?.timestamp), toDate(oldestLog?.timestamp)]
    .filter((date): date is Date => Boolean(date));
  const ends = [toDate(latestHistory?.timestamp), toDate(latestLog?.timestamp)]
    .filter((date): date is Date => Boolean(date));

  return {
    start: starts.length ? new Date(Math.min(...starts.map(date => date.getTime()))).toISOString() : null,
    end: ends.length ? new Date(Math.max(...ends.map(date => date.getTime()))).toISOString() : null
  };
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
  },
  key: "tps" | "mspt",
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
  }
}

function averageOrNull(sum: number, count: number): number | null {
  if (count === 0) return null;
  return Math.round((sum / count) * 100) / 100;
}

function normalizeLogEvent(row: Document): NormalizedLogEvent | null {
  const timestamp = toDate(row.timestamp);
  if (!timestamp || (row.type !== "join" && row.type !== "leave")) return null;

  return {
    id: String(row._id || `${row.uuid}-${timestamp.getTime()}`),
    type: row.type,
    uuid: String(row.uuid || ""),
    username: String(row.username || row.uuid || "unknown"),
    server: String(row.server || "default"),
    timestamp
  };
}

function eventKey(row: Document | { uuid: string; server: string }): string | null {
  if (!row.uuid) return null;
  return `${String(row.server || "default")}:${String(row.uuid)}`;
}

function toPlayerSession(
  session: { uuid: string; username: string; server: string; start: Date },
  end: Date,
  options: { open: boolean; inferred: boolean }
): PlayerSession {
  return {
    id: `${session.server}:${session.uuid}:${session.start.getTime()}:${end.getTime()}`,
    uuid: session.uuid,
    username: session.username,
    server: session.server,
    start: session.start.toISOString(),
    end: end.toISOString(),
    open: options.open,
    inferred: options.inferred
  };
}

function inferMissingSessions(
  sessions: Array<{ uuid: string; username: string; server: string; start: Date }>,
  rows: Document[]
): PlayerSession[] {
  const dropTimesByServer = new Map<string, Date[]>();
  for (const row of rows) {
    const server = String(row.server || "default");
    const timestamp = toDate(row.timestamp);
    const playerCount = toNumber(row.playerCount);
    if (!timestamp || playerCount === null) continue;

    const samples = dropTimesByServer.get(server) || [];
    const previousCount = (samples as Array<Date> & { lastCount?: number }).lastCount;
    if (previousCount !== undefined && playerCount < previousCount) {
      const dropCount = Math.max(1, Math.round(previousCount - playerCount));
      for (let index = 0; index < dropCount; index += 1) {
        samples.push(timestamp);
      }
    }
    (samples as Array<Date> & { lastCount?: number }).lastCount = playerCount;
    dropTimesByServer.set(server, samples);
  }

  return sessions
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .flatMap(session => {
      const dropTimes = dropTimesByServer.get(session.server) || [];
      const dropIndex = dropTimes.findIndex(timestamp => timestamp > session.start);
      if (dropIndex === -1) return [];

      const [end] = dropTimes.splice(dropIndex, 1);
      return [toPlayerSession(session, end, { open: false, inferred: true })];
    });
}

"use client";

import {
  Activity,
  Clock3,
  KeyRound,
  LogOut,
  Moon,
  RefreshCw,
  Server,
  Signal,
  Sun,
  Users
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { HistoryPoint, LiveMessage, Player, PlayerEvent, PlayerSession, ServerStatus } from "@/lib/types";

const ranges = [
  { value: "15m", label: "15 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "6h", label: "6 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "custom", label: "指定时间" }
];

const buckets = [
  { value: "auto", label: "自动粒度" },
  { value: "10s", label: "10 秒" },
  { value: "1m", label: "1 分钟" },
  { value: "5m", label: "5 分钟" },
  { value: "15m", label: "15 分钟" },
  { value: "1h", label: "1 小时" }
];

type LiveState = "connecting" | "connected" | "disconnected";
type Theme = "light" | "dark";

export function Dashboard() {
  const router = useRouter();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const [liveError, setLiveError] = useState("");
  const [servers, setServers] = useState<string[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [range, setRange] = useState("1h");
  const [bucket, setBucket] = useState("auto");
  const [customStart, setCustomStart] = useState(() => toInputDateTime(new Date(Date.now() - 60 * 60_000)));
  const [customEnd, setCustomEnd] = useState(() => toInputDateTime(new Date()));
  const [theme, setTheme] = useState<Theme>("light");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [events, setEvents] = useState<PlayerEvent[]>([]);
  const [sessions, setSessions] = useState<PlayerSession[]>([]);
  const [dataWindow, setDataWindow] = useState<{ start: string; end: string } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const reconnectTimer = useRef<number | null>(null);
  const socketPollTimer = useRef<number | null>(null);
  const liveHistoryTimer = useRef<number | null>(null);
  const scheduledHistoryTimer = useRef<number | null>(null);
  const loadHistoryRef = useRef<(options?: { silent?: boolean }) => Promise<void>>(async () => undefined);

  const serverName = status?.motd || "Minecraft Server";
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.username.localeCompare(b.username)),
    [players]
  );

  useEffect(() => {
    loadCurrent();
    loadServers();
  }, []);

  useEffect(() => {
    loadHistory();
  }, [range, bucket, selectedServer, customStart, customEnd]);

  useEffect(() => {
    loadHistoryRef.current = loadHistory;
  });

  useEffect(() => {
    if (liveState !== "connected") {
      if (liveHistoryTimer.current) window.clearInterval(liveHistoryTimer.current);
      liveHistoryTimer.current = null;
      return;
    }

    scheduleHistoryRefresh(0);
    liveHistoryTimer.current = window.setInterval(() => {
      void loadHistoryRef.current({ silent: true });
    }, 10_000);

    return () => {
      if (liveHistoryTimer.current) window.clearInterval(liveHistoryTimer.current);
      liveHistoryTimer.current = null;
    };
  }, [liveState]);

  useEffect(() => {
    const stored = localStorage.getItem("mc-dashboard-theme");
    const initial = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setLiveState("connecting");
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/api/live`);

      socket.onopen = () => {
        setLiveState("connected");
        setLiveError("");
        socket?.send(JSON.stringify({ path: "/players" }));
        scheduleHistoryRefresh(0);
        if (socketPollTimer.current) window.clearInterval(socketPollTimer.current);
        socketPollTimer.current = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ path: "/players" }));
          }
        }, 10_000);
      };

      socket.onmessage = event => {
        try {
          applyLiveMessage(JSON.parse(event.data) as LiveMessage);
        } catch {
          setLiveError("收到无法解析的实时消息");
        }
      };

      socket.onerror = () => {
        setLiveError("实时连接异常");
      };

      socket.onclose = () => {
        if (cancelled) return;
        setLiveState("disconnected");
        if (socketPollTimer.current) window.clearInterval(socketPollTimer.current);
        socketPollTimer.current = null;
        reconnectTimer.current = window.setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      if (socketPollTimer.current) window.clearInterval(socketPollTimer.current);
      if (scheduledHistoryTimer.current) window.clearTimeout(scheduledHistoryTimer.current);
      socket?.close();
    };
  }, []);

  async function loadCurrent() {
    const response = await fetch("/api/current", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    if (body.ok && body.data) {
      setStatus(body.data.status);
      setPlayers(body.data.players || []);
    }
  }

  async function loadServers() {
    const response = await fetch("/api/servers", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    if (body.ok && Array.isArray(body.data)) setServers(body.data);
  }

  async function loadHistory(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoadingHistory(true);
    setHistoryError("");

    try {
      const query = buildHistoryQuery();
      const [historyResponse, eventsResponse, sessionsResponse] = await Promise.all([
        fetch(`/api/history?${query}`, { cache: "no-store" }),
        fetch(`/api/events?${query}`, { cache: "no-store" }),
        fetch(`/api/sessions?${query}`, { cache: "no-store" })
      ]);

      const historyBody = await historyResponse.json();
      const eventsBody = await eventsResponse.json();
      const sessionsBody = await sessionsResponse.json();
      if (!historyResponse.ok || !historyBody.ok) throw new Error(historyBody.error || "历史数据读取失败");
      if (!eventsResponse.ok || !eventsBody.ok) throw new Error(eventsBody.error || "事件数据读取失败");
      if (!sessionsResponse.ok || !sessionsBody.ok) throw new Error(sessionsBody.error || "在线时长读取失败");

      setHistory(historyBody.data);
      setEvents(eventsBody.data);
      setSessions(sessionsBody.data);
      setDataWindow({ start: historyBody.start, end: historyBody.end });
    } catch (error) {
      setHistory([]);
      setEvents([]);
      setSessions([]);
      setDataWindow(null);
      setHistoryError(error instanceof Error ? error.message : "历史数据读取失败");
    } finally {
      if (!options.silent) setLoadingHistory(false);
    }
  }

  function scheduleHistoryRefresh(delay = 1200) {
    if (scheduledHistoryTimer.current) window.clearTimeout(scheduledHistoryTimer.current);
    scheduledHistoryTimer.current = window.setTimeout(() => {
      void loadHistoryRef.current({ silent: true });
    }, delay);
  }

  function buildHistoryQuery() {
    const query = new URLSearchParams({ range, bucket });
    if (selectedServer) query.set("server", selectedServer);
    if (range === "custom") {
      if (!customStart || !customEnd) throw new Error("请选择完整的开始和结束时间");
      if (new Date(customStart) >= new Date(customEnd)) throw new Error("开始时间必须早于结束时间");
      query.set("start", new Date(customStart).toISOString());
      query.set("end", new Date(customEnd).toISOString());
    }
    return query;
  }

  function applyLiveMessage(message: LiveMessage) {
    if (message.type === "liveConnection") {
      setLiveState(message.ok ? "connected" : "disconnected");
      setLiveError(message.error || "");
      if (message.ok) scheduleHistoryRefresh(0);
      if (!message.ok && socketPollTimer.current) {
        window.clearInterval(socketPollTimer.current);
        socketPollTimer.current = null;
      }
      return;
    }

    if ((message.type === "init" || message.type === "players") && message.status) {
      setStatus(message.status);
      setPlayers(message.players || []);
      scheduleHistoryRefresh(800);
      return;
    }

    if (message.type === "status" && isStatus(message.data)) {
      setStatus(message.data);
      scheduleHistoryRefresh(800);
      return;
    }

    if (message.type === "join" && isPlayer(message.data)) {
      const player = message.data;
      setPlayers(current => {
        const next = upsertPlayer(current, player);
        setStatus(statusNow => statusNow ? { ...statusNow, playersOnline: next.length } : statusNow);
        return next;
      });
      scheduleHistoryRefresh(300);
      return;
    }

    if (message.type === "leave" && isPlayer(message.data)) {
      const player = message.data;
      setPlayers(current => {
        const next = current.filter(item => item.uuid !== player.uuid);
        setStatus(statusNow => statusNow ? { ...statusNow, playersOnline: next.length } : statusNow);
        return next;
      });
      scheduleHistoryRefresh(300);
      return;
    }

    if (message.type === "update" && isPlayer(message.data)) {
      setPlayers(current => upsertPlayer(current, message.data as Player));
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("mc-dashboard-theme", next);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 md:px-6">
      <header className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
            <Server size={16} aria-hidden="true" />
            <span className="text-fit">{status?.version || "unknown version"}</span>
            <span>|</span>
            <span>{status?.modLoader || (status?.isForge ? "forge" : "vanilla")}</span>
          </div>
          <h1 className="text-2xl font-semibold md:text-3xl">{serverName}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ConnectionBadge state={liveState} error={liveError} />
          <button
            onClick={() => loadHistory()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm"
            title="刷新历史数据"
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
          <button
            onClick={toggleTheme}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm"
            title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            {theme === "dark" ? "浅色" : "深色"}
          </button>
          <button
            onClick={() => router.push("/setup-password")}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm"
            title="修改密码"
          >
            <KeyRound size={16} aria-hidden="true" />
            密码
          </button>
          <button
            onClick={logout}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm"
            title="退出登录"
          >
            <LogOut size={16} aria-hidden="true" />
            退出
          </button>
        </div>
      </header>

      <section className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric title="服务器状态" value={status?.online ? "在线" : "离线"} tone={status?.online ? "good" : "bad"} icon={<Signal size={18} />} />
        <Metric title="TPS" value={status?.tps || "-"} detail={`MSPT ${status?.mspt || "-"}`} icon={<Activity size={18} />} />
        <Metric title="在线玩家" value={`${players.length}`} detail={`上限 ${status?.playersMax ?? "-"}`} icon={<Users size={18} />} />
        <Metric title="协议" value={status?.protocol ? `${status.protocol}` : "-"} detail={status?.fmlVersion || "FML unknown"} icon={<Clock3 size={18} />} />
      </section>

      <section className="panel mb-5 p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">历史数据</h2>
            <p className="text-sm text-slate-500">
              TPS、MSPT 和在线人数来自 MongoDB history 集合；服务器筛选来自 DB server 字段
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedServer}
              onChange={event => setSelectedServer(event.target.value)}
              className="h-9 max-w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
              aria-label="服务器"
            >
              <option value="">全部服务器</option>
              {servers.map(server => <option key={server} value={server}>{server}</option>)}
            </select>
            <select
              value={range}
              onChange={event => setRange(event.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
              aria-label="时间范围"
            >
              {ranges.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {range === "custom" ? (
              <>
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={event => setCustomStart(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                  aria-label="开始时间"
                />
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={event => setCustomEnd(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                  aria-label="结束时间"
                />
              </>
            ) : null}
            <select
              value={bucket}
              onChange={event => setBucket(event.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
              aria-label="数据粒度"
            >
              {buckets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      {historyError ? (
        <div className="panel mb-5 border-red-200 bg-red-50 p-4 text-sm text-red-800">{historyError}</div>
      ) : null}

      <section className="mb-5 grid gap-5 xl:grid-cols-3">
        <div className="panel p-4 xl:col-span-2">
          <ChartHeader title="TPS / MSPT" loading={loadingHistory} />
          <div className="chart-box">
            {history.length ? <TpsChart data={history} /> : <EmptyChart />}
          </div>
        </div>
        <div className="panel p-4">
          <ChartHeader title="在线人数采样" loading={loadingHistory} />
          <div className="small-chart-box">
            {history.length ? <PlayersChart data={history} /> : <EmptyChart />}
          </div>
        </div>
      </section>

      <section className="panel mb-5 p-4">
        <ChartHeader title="在线时长追踪" loading={loadingHistory} />
        <div className="sessions-chart-box">
          {sessions.length && dataWindow
            ? <OnlineSessionsChart sessions={sessions} windowStart={dataWindow.start} windowEnd={dataWindow.end} showServer={!selectedServer} />
            : <EmptyChart />}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <div className="panel p-4 xl:col-span-2">
          <h2 className="mb-3 font-semibold">当前在线玩家</h2>
          <p className="mb-3 text-sm text-slate-500">实时列表来自当前 bot WebSocket 连接，不受历史服务器筛选影响</p>
          <div className="grid max-h-[420px] gap-2 overflow-auto md:grid-cols-2">
            {sortedPlayers.length ? sortedPlayers.map(player => (
              <div key={player.uuid} className="flex min-h-12 items-center justify-between rounded-md border border-slate-200 px-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{player.username}</p>
                  <p className="truncate text-xs text-slate-500">{player.uuid}</p>
                </div>
                <span className="ml-3 shrink-0 text-sm text-slate-600">{player.latency} ms</span>
              </div>
            )) : <p className="text-sm text-slate-500">暂无在线玩家</p>}
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="mb-3 font-semibold">进退服事件</h2>
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {events.length ? events.map(event => (
              <div key={event.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={event.type === "join" ? "text-sm font-medium text-green-700" : "text-sm font-medium text-amber-700"}>
                    {event.type === "join" ? "加入" : "离开"}
                  </span>
                  <time className="text-xs text-slate-500">{formatTime(event.timestamp)}</time>
                </div>
                <p className="truncate font-medium">{event.username}</p>
                <p className="truncate text-xs text-slate-500">{event.server}</p>
              </div>
            )) : <p className="text-sm text-slate-500">当前范围内没有事件</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric(props: { title: string; value: string; detail?: string; icon: ReactNode; tone?: "good" | "bad" }) {
  const color = props.tone === "good" ? "text-green-700" : props.tone === "bad" ? "text-red-700" : "text-slate-900";
  return (
    <div className="panel metric p-4">
      <div className="mb-3 flex items-center justify-between text-slate-500">
        <span className="text-sm">{props.title}</span>
        {props.icon}
      </div>
      <p className={`text-fit text-3xl font-semibold ${color}`}>{props.value}</p>
      {props.detail ? <p className="mt-1 text-sm text-slate-500">{props.detail}</p> : null}
    </div>
  );
}

function ConnectionBadge({ state, error }: { state: LiveState; error: string }) {
  const color = state === "connected" ? "bg-green-600" : state === "connecting" ? "bg-amber-500" : "bg-red-600";
  const label = state === "connected" ? "实时已连接" : state === "connecting" ? "实时连接中" : "实时已断开";
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm" title={error || label}>
      <span className={`status-dot ${color}`} />
      {label}
    </span>
  );
}

function ChartHeader({ title, loading }: { title: string; loading: boolean }) {
  return (
    <div className="mb-3 flex h-8 items-center justify-between">
      <h2 className="font-semibold">{title}</h2>
      {loading ? <span className="text-sm text-slate-500">加载中</span> : null}
    </div>
  );
}

function TpsChart({ data }: { data: HistoryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
        <XAxis dataKey="timestamp" tickFormatter={formatTime} minTickGap={30} tick={{ fontSize: 12, fill: "var(--muted)" }} />
        <YAxis yAxisId="left" domain={[0, 20]} tick={{ fontSize: 12, fill: "var(--muted)" }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: "var(--muted)" }} />
        <Tooltip
          labelFormatter={formatDateTime}
          formatter={(value, name) => [value, name === "tps" ? "TPS" : "MSPT"]}
          contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--text)" }}
          labelStyle={{ color: "var(--text)" }}
        />
        <Line yAxisId="left" type="monotone" dataKey="tps" stroke="var(--good)" strokeWidth={2} dot={false} connectNulls />
        <Line yAxisId="right" type="monotone" dataKey="mspt" stroke="var(--blue)" strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PlayersChart({ data }: { data: HistoryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
        <XAxis dataKey="timestamp" tickFormatter={formatTime} minTickGap={28} tick={{ fontSize: 12, fill: "var(--muted)" }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted)" }} />
        <Tooltip
          labelFormatter={formatDateTime}
          formatter={value => [value, "在线人数"]}
          contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--text)" }}
          labelStyle={{ color: "var(--text)" }}
        />
        <Area type="monotone" dataKey="playerCount" stroke="var(--teal)" fill="var(--teal-fill)" strokeWidth={2} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function OnlineSessionsChart({
  sessions,
  windowStart,
  windowEnd,
  showServer
}: {
  sessions: PlayerSession[];
  windowStart: string;
  windowEnd: string;
  showServer: boolean;
}) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const groups = groupSessions(sessions, showServer);
  const ticks = buildTicks(startMs, endMs, 6);

  return (
    <div className="session-chart">
      <div className="session-axis-row">
        <div className="session-label-spacer" />
        <div className="session-timeline">
          {ticks.map(tick => (
            <div key={tick.value} className="session-tick" style={{ left: `${tick.left}%` }}>
              <span>{formatTime(new Date(tick.value).toISOString())}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="session-rows">
        {groups.map(group => (
          <div key={group.key} className="session-row">
            <div className="session-label" title={group.label}>{group.label}</div>
            <div className="session-track">
              {ticks.map(tick => <span key={tick.value} className="session-grid-line" style={{ left: `${tick.left}%` }} />)}
              {group.sessions.map(session => {
                const sessionStart = Math.max(new Date(session.start).getTime(), startMs);
                const sessionEnd = Math.min(new Date(session.end).getTime(), endMs);
                const left = ((sessionStart - startMs) / spanMs) * 100;
                const width = Math.max(((sessionEnd - sessionStart) / spanMs) * 100, 0.5);
                const title = `${group.label}\n${formatDateTime(session.start)} - ${formatDateTime(session.end)}\n${formatDuration(sessionEnd - sessionStart)}${session.open ? "，仍在线" : ""}`;
                return (
                  <span
                    key={session.id}
                    className={session.open ? "session-bar session-bar-open" : "session-bar"}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={title}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="grid h-full place-items-center rounded-md border border-dashed border-slate-300 text-sm text-slate-500">
      没有可展示的数据
    </div>
  );
}

function upsertPlayer(players: Player[], player: Player) {
  const exists = players.some(item => item.uuid === player.uuid);
  if (!exists) return [...players, player];
  return players.map(item => item.uuid === player.uuid ? player : item);
}

function isPlayer(value: unknown): value is Player {
  return Boolean(value && typeof value === "object" && "uuid" in value && "username" in value);
}

function isStatus(value: unknown): value is ServerStatus {
  return Boolean(value && typeof value === "object" && "playersOnline" in value);
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(value: number) {
  const totalSeconds = Math.max(Math.round(value / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes > 0) return `${minutes} 分钟 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function groupSessions(sessions: PlayerSession[], showServer: boolean) {
  const groups = new Map<string, { key: string; label: string; sessions: PlayerSession[] }>();

  for (const session of sessions) {
    const key = `${session.server}:${session.uuid}`;
    const label = showServer ? `${session.username} · ${session.server}` : session.username;
    const group = groups.get(key) || { key, label, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      sessions: group.sessions.sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildTicks(startMs: number, endMs: number, count: number) {
  const spanMs = Math.max(endMs - startMs, 1);
  return Array.from({ length: count }, (_, index) => {
    const value = startMs + (spanMs * index) / (count - 1);
    return {
      value,
      left: ((value - startMs) / spanMs) * 100
    };
  });
}

function toInputDateTime(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

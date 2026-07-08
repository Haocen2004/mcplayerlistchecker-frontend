export interface Player {
  uuid: string;
  username: string;
  latency: number;
}

export interface ServerStatus {
  online: boolean;
  version?: string;
  protocol?: number;
  motd?: string;
  playersOnline: number;
  playersMax: number;
  isForge: boolean;
  isNeoForge?: boolean;
  modLoader?: "vanilla" | "forge" | "neoforge" | "modded";
  fmlVersion?: string;
  tps?: string;
  mspt?: string;
}

export interface CurrentPayload {
  status: ServerStatus;
  players: Player[];
}

export interface HistoryPoint {
  timestamp: string;
  tps: number | null;
  mspt: number | null;
  playerCount: number | null;
  samples: number;
}

export interface PlayerEvent {
  id: string;
  type: "join" | "leave";
  uuid: string;
  username: string;
  server: string;
  timestamp: string;
}

export interface PlayerSession {
  id: string;
  uuid: string;
  username: string;
  server: string;
  start: string;
  end: string;
  open: boolean;
}

export interface LiveMessage {
  type: string;
  status?: ServerStatus;
  players?: Player[];
  data?: unknown;
  ok?: boolean;
  error?: string;
}

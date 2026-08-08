import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { NodeSpec, WorkloadSpec } from "./control-plane";
import type { DataPlaneUnit } from "./data-plane";
import type { FederationPeer } from "./federation";
import type { HealthCheck, ObservabilityEvent } from "./observability";
import type { SharedStoragePool, StorageVolume } from "./storage";

export type GuardianStatus = "approved" | "denied" | "suspended" | "quarantined" | "revoked";

export type GuardianDecision = {
  id: string;
  toolId: string;
  scope: "exposure" | "domain" | "runtime";
  subjectId: string;
  status: GuardianStatus;
  reason: string;
  actor: "system" | "operator";
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, string>;
};

export type PlatformState = {
  nodes: NodeSpec[];
  workloads: WorkloadSpec[];
  peers: FederationPeer[];
  events: ObservabilityEvent[];
  volumes: StorageVolume[];
  sharedStoragePools: SharedStoragePool[];
  units: DataPlaneUnit[];
  healthChecks: HealthCheck[];
  guardianDecisions: GuardianDecision[];
};

export type PlatformStateMetadata = {
  path: string;
  exists: boolean;
  sizeBytes: number;
  lastWriteAt: string | null;
  ageSeconds: number | null;
};

export type PlatformStateRecovery = {
  source: "primary" | "temp" | "backup" | "empty";
  recovered: boolean;
  repaired: boolean;
  recoveredAt: string;
};

function resolveStatePath(): string {
  const override = process.env.NEXUS_CLOUD_STATE_PATH?.trim();
  if (!override) return join(process.cwd(), "data", "platform-state.json");
  return isAbsolute(override) ? override : join(process.cwd(), override);
}

const STATE_PATH = resolveStatePath();
const STATE_TEMP_PATH = `${STATE_PATH}.tmp`;
const STATE_BACKUP_PATH = `${STATE_PATH}.bak`;

const EMPTY_STATE: PlatformState = {
  nodes: [],
  workloads: [],
  peers: [],
  events: [],
  volumes: [],
  sharedStoragePools: [],
  units: [],
  healthChecks: [],
  guardianDecisions: [],
};

function ensureStorageDir(): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
}

function safeUnlink(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // Best effort cleanup.
  }
}

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function cloneState(next: PlatformState): PlatformState {
  return {
    nodes: next.nodes.map((item) => ({
      ...item,
      labels: { ...item.labels },
      capacity: { ...item.capacity },
    })),
    workloads: next.workloads.map((item) => ({
      ...item,
      env: { ...item.env },
      ports: [...item.ports],
      storage: [...item.storage],
    })),
    peers: next.peers.map((item) => ({ ...item, trust: { ...item.trust } })),
    events: next.events.map((item) => ({
      ...item,
      ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
    })),
    volumes: next.volumes.map((item) => ({ ...item })),
    sharedStoragePools: (next.sharedStoragePools ?? []).map((item) => ({ ...item })),
    units: next.units.map((item) => ({
      ...item,
      ...(item.ports ? { ports: [...item.ports] } : {}),
      ...(item.env ? { env: { ...item.env } } : {}),
      ...(item.mounts ? { mounts: item.mounts.map((mount) => ({ ...mount })) } : {}),
    })),
    healthChecks: next.healthChecks.map((item) => ({
      ...item,
      ...(item.details ? { details: { ...item.details } } : {}),
    })),
    guardianDecisions: next.guardianDecisions.map((item) => ({
      ...item,
      ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeNodeSpec(value: unknown): NodeSpec | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";
  const region = typeof value.region === "string" ? value.region : "";
  const zone = typeof value.zone === "string" ? value.zone : "";
  if (!id || !name || !region || !zone || !isRecord(value.capacity)) return null;
  const cpu = typeof value.capacity.cpu === "number" ? value.capacity.cpu : Number.NaN;
  const memoryMb =
    typeof value.capacity.memoryMb === "number" ? value.capacity.memoryMb : Number.NaN;
  const storageGb =
    typeof value.capacity.storageGb === "number" ? value.capacity.storageGb : Number.NaN;
  if (!Number.isFinite(cpu) || !Number.isFinite(memoryMb) || !Number.isFinite(storageGb))
    return null;

  return {
    id,
    name,
    region,
    zone,
    labels: isRecord(value.labels)
      ? (Object.fromEntries(
          Object.entries(value.labels).filter(([, item]) => typeof item === "string"),
        ) as Record<string, string>)
      : {},
    capacity: {
      cpu,
      memoryMb,
      storageGb,
      ...(typeof value.capacity.publicIpv4 === "string"
        ? { publicIpv4: value.capacity.publicIpv4 }
        : {}),
    },
    status:
      value.status === "pending" ||
      value.status === "ready" ||
      value.status === "draining" ||
      value.status === "offline"
        ? value.status
        : "pending",
    trustState:
      value.trustState === "pending" ||
      value.trustState === "verified" ||
      value.trustState === "trusted" ||
      value.trustState === "quarantined" ||
      value.trustState === "revoked" ||
      value.trustState === "expired"
        ? value.trustState
        : "pending",
    ...(typeof value.trustExpiresAt === "string" ? { trustExpiresAt: value.trustExpiresAt } : {}),
    ...(typeof value.trustUpdatedAt === "string" ? { trustUpdatedAt: value.trustUpdatedAt } : {}),
    ...(typeof value.lastSeenAt === "string" ? { lastSeenAt: value.lastSeenAt } : {}),
  };
}

function sanitizeFederationPeer(value: unknown): FederationPeer | null {
  if (!isRecord(value) || !isRecord(value.trust)) return null;
  const domain = typeof value.domain === "string" ? value.domain : "";
  const trustIdentity = typeof value.trust.identity === "string" ? value.trust.identity : "";
  if (!domain || !trustIdentity) return null;

  return {
    domain,
    ...(typeof value.did === "string" ? { did: value.did } : {}),
    trust: {
      identity: trustIdentity,
      issuer: typeof value.trust.issuer === "string" ? value.trust.issuer : trustIdentity,
      audience: typeof value.trust.audience === "string" ? value.trust.audience : "nexus-cloud",
      publicKeyHint:
        typeof value.trust.publicKeyHint === "string" ? value.trust.publicKeyHint : "manual",
      signatureScheme:
        typeof value.trust.signatureScheme === "string" ? value.trust.signatureScheme : "ed25519",
      expiresAt:
        typeof value.trust.expiresAt === "string"
          ? value.trust.expiresAt
          : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    },
    trustState:
      value.trustState === "pending" ||
      value.trustState === "verified" ||
      value.trustState === "trusted" ||
      value.trustState === "quarantined" ||
      value.trustState === "revoked" ||
      value.trustState === "expired"
        ? value.trustState
        : "pending",
    ...(typeof value.trustUpdatedAt === "string" ? { trustUpdatedAt: value.trustUpdatedAt } : {}),
    ...(typeof value.trustExpiresAt === "string" ? { trustExpiresAt: value.trustExpiresAt } : {}),
    status:
      value.status === "unknown" ||
      value.status === "healthy" ||
      value.status === "degraded" ||
      value.status === "blocked"
        ? value.status
        : "unknown",
    ...(typeof value.lastSeenAt === "string" ? { lastSeenAt: value.lastSeenAt } : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
  };
}

function sanitizeState(value: unknown): PlatformState {
  if (!isRecord(value)) return cloneState(EMPTY_STATE);
  return {
    nodes: Array.isArray(value.nodes)
      ? value.nodes.map(sanitizeNodeSpec).filter((item): item is NodeSpec => item !== null)
      : [],
    workloads: Array.isArray(value.workloads) ? (value.workloads as WorkloadSpec[]) : [],
    peers: Array.isArray(value.peers)
      ? value.peers
          .map(sanitizeFederationPeer)
          .filter((item): item is FederationPeer => item !== null)
      : [],
    events: Array.isArray(value.events) ? (value.events as ObservabilityEvent[]) : [],
    volumes: Array.isArray(value.volumes) ? (value.volumes as StorageVolume[]) : [],
    sharedStoragePools: Array.isArray(value.sharedStoragePools)
      ? (value.sharedStoragePools as SharedStoragePool[])
      : [],
    units: Array.isArray(value.units) ? (value.units as DataPlaneUnit[]) : [],
    healthChecks: Array.isArray(value.healthChecks) ? (value.healthChecks as HealthCheck[]) : [],
    guardianDecisions: Array.isArray(value.guardianDecisions)
      ? (value.guardianDecisions as GuardianDecision[])
      : [],
  };
}

function applyStateSnapshot(next: PlatformState): void {
  state.nodes = next.nodes;
  state.workloads = next.workloads;
  state.peers = next.peers;
  state.events = next.events;
  state.volumes = next.volumes;
  state.units = next.units;
  state.healthChecks = next.healthChecks;
  state.guardianDecisions = next.guardianDecisions;
}

type StateCandidate = {
  path: string;
  source: "primary" | "temp" | "backup";
  state: PlatformState;
  mtimeMs: number;
};

function readStateCandidate(path: string, source: StateCandidate["source"]): StateCandidate | null {
  if (!existsSync(path)) return null;
  try {
    const stats = statSync(path);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      path,
      source,
      state: sanitizeState(parsed),
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

function writeSnapshotAtomic(
  next: PlatformState,
  options: { backupCurrentPrimary: boolean },
): void {
  ensureStorageDir();
  const payload = `${JSON.stringify(next, null, 2)}\n`;

  try {
    writeFileSync(STATE_TEMP_PATH, payload, { mode: 0o600 });
    fsyncPath(STATE_TEMP_PATH);

    if (options.backupCurrentPrimary && existsSync(STATE_PATH)) {
      copyFileSync(STATE_PATH, STATE_BACKUP_PATH);
      fsyncPath(STATE_BACKUP_PATH);
    }

    renameSync(STATE_TEMP_PATH, STATE_PATH);
    fsyncDirectory(dirname(STATE_PATH));
  } catch (error) {
    safeUnlink(STATE_TEMP_PATH);
    throw error;
  }
}

function loadStateWithRecovery(): { state: PlatformState; recovery: PlatformStateRecovery } {
  const candidates = [
    readStateCandidate(STATE_PATH, "primary"),
    readStateCandidate(STATE_TEMP_PATH, "temp"),
    readStateCandidate(STATE_BACKUP_PATH, "backup"),
  ].filter((candidate): candidate is StateCandidate => candidate !== null);

  if (candidates.length === 0) {
    return {
      state: cloneState(EMPTY_STATE),
      recovery: {
        source: "empty",
        recovered: false,
        repaired: false,
        recoveredAt: new Date().toISOString(),
      },
    };
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const winner = candidates[0];

  let repaired = false;
  if (!winner) {
    return {
      state: cloneState(EMPTY_STATE),
      recovery: {
        source: "empty",
        recovered: false,
        repaired: false,
        recoveredAt: new Date().toISOString(),
      },
    };
  }
  if (winner.source !== "primary" || !existsSync(STATE_PATH)) {
    try {
      writeSnapshotAtomic(winner.state, { backupCurrentPrimary: false });
      repaired = true;
    } catch {
      repaired = false;
    }
  }

  if (winner.source !== "temp") {
    safeUnlink(STATE_TEMP_PATH);
  }

  return {
    state: cloneState(winner.state),
    recovery: {
      source: winner.source,
      recovered: winner.source !== "primary",
      repaired,
      recoveredAt: new Date().toISOString(),
    },
  };
}

function saveState(): void {
  writeSnapshotAtomic(snapshot(), { backupCurrentPrimary: true });
}

const initial = loadStateWithRecovery();
export const state: PlatformState = initial.state;
let lastRecovery: PlatformStateRecovery = initial.recovery;

export function persistState(): void {
  saveState();
}

export function mutateState<T>(mutator: (draft: PlatformState) => T): T {
  const before = snapshot();
  try {
    const result = mutator(state);
    saveState();
    return result;
  } catch (error) {
    applyStateSnapshot(before);
    throw error;
  }
}

export function replaceState(next: PlatformState): void {
  const before = snapshot();
  const nextSnapshot = cloneState(next);
  applyStateSnapshot(nextSnapshot);
  try {
    saveState();
  } catch (error) {
    applyStateSnapshot(before);
    throw error;
  }
}

export function resetPlatformStateForTests(next: PlatformState = cloneState(EMPTY_STATE)): void {
  replaceState(next);
}

export function recoverPlatformStateFromDisk(): PlatformStateRecovery {
  const loaded = loadStateWithRecovery();
  applyStateSnapshot(loaded.state);
  lastRecovery = loaded.recovery;
  return { ...lastRecovery };
}

export function getPlatformStateRecovery(): PlatformStateRecovery {
  return { ...lastRecovery };
}

export function getPlatformStateMetadata(): PlatformStateMetadata {
  if (!existsSync(STATE_PATH)) {
    return {
      path: STATE_PATH,
      exists: false,
      sizeBytes: 0,
      lastWriteAt: null,
      ageSeconds: null,
    };
  }

  const stats = statSync(STATE_PATH);
  return {
    path: STATE_PATH,
    exists: true,
    sizeBytes: stats.size,
    lastWriteAt: stats.mtime.toISOString(),
    ageSeconds: Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000)),
  };
}

export function snapshot() {
  return cloneState(state);
}

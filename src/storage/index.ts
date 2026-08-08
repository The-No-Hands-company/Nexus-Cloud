import { mutateState, snapshot } from "../state";
import { type S3Config, headBucket, makeBucket } from "./s3";

export type StorageKind = "object" | "block" | "snapshot";

export type StorageClass = {
  name: string;
  kind: StorageKind;
  replicated: boolean;
  encryptedAtRest: boolean;
  backend?: "minio" | "none" | "shared";
  /** For shared backend: pool selection strategy */
  poolSelector?: "round-robin" | "least-used" | "first-writer";
};

export type StorageBackendStatus = {
  provider: "minio" | "none";
  endpoint: string;
  region: string;
  bucketPrefix: string;
  configured: boolean;
  reachable: boolean;
  buckets: number;
};

export type SharedStoragePool = {
  id: string;
  name: string;
  ownerNodeId: string;
  ownerNodeDid: string;
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  totalCapacityGb: number;
  availableCapacityGb: number;
  status: "active" | "draining" | "offline";
  tags: string[];
  replicationFactor: number;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt?: string;
};

export type SharedStoragePoolRequest = {
  name: string;
  totalCapacityGb: number;
  tags?: string[];
  replicationFactor?: number;
};

export type StorageVolume = {
  id: string;
  name: string;
  className: string;
  kind: StorageKind;
  sizeGb: number;
  backend: "minio" | "none" | "shared";
  bucket: string;
  endpoint: string;
  status: "provisioning" | "provisioned" | "failed";
  attachedToNodeId?: string;
  /** For shared backend: which pool this volume resides on */
  poolId?: string;
  /** For shared backend: owner node DID of the pool */
  poolOwnerDid?: string;
  createdAt: string;
  updatedAt: string;
};

export const storage = {
  classes: [
    {
      name: "standard",
      kind: "object" as const,
      replicated: true,
      encryptedAtRest: true,
      backend: "minio",
    },
    {
      name: "block",
      kind: "block" as const,
      replicated: true,
      encryptedAtRest: true,
      backend: "none",
    },
    {
      name: "snapshot",
      kind: "snapshot" as const,
      replicated: false,
      encryptedAtRest: true,
      backend: "none",
    },
    {
      name: "shared",
      kind: "object" as const,
      replicated: true,
      encryptedAtRest: true,
      backend: "shared",
      poolSelector: "first-writer",
    },
  ] satisfies StorageClass[],
};

export type StorageVolumeRequest = {
  name: string;
  className?: string;
  sizeGb?: number;
  /** For shared backend: optional preferred pool ID */
  poolId?: string;
};

function region(): string {
  return process.env.NEXUS_STORAGE_S3_REGION?.trim() || "us-east-1";
}

function endpoint(): string {
  return (
    process.env.NEXUS_STORAGE_S3_ENDPOINT?.trim() ||
    process.env.NEXUS__STORAGE__ENDPOINT?.trim() ||
    "http://127.0.0.1:9000"
  );
}

function accessKey(): string {
  return (
    process.env.NEXUS_STORAGE_S3_ACCESS_KEY?.trim() ||
    process.env.NEXUS__STORAGE__ACCESS_KEY?.trim() ||
    "minioadmin"
  );
}

function secretKey(): string {
  return (
    process.env.NEXUS_STORAGE_S3_SECRET_KEY?.trim() ||
    process.env.NEXUS__STORAGE__SECRET_KEY?.trim() ||
    "minioadmin"
  );
}

function bucketPrefix(): string {
  return process.env.NEXUS_STORAGE_S3_BUCKET_PREFIX?.trim() || "nexus";
}

export function s3Config(): S3Config {
  return { endpoint: endpoint(), accessKey: accessKey(), secretKey: secretKey(), region: region() };
}

export function hasStorageBackend(): boolean {
  return Boolean(
    process.env.NEXUS_STORAGE_S3_ENDPOINT?.trim() || process.env.NEXUS__STORAGE__ENDPOINT?.trim(),
  );
}

function bucketForEndpoint(volumeId: string): string {
  return `${bucketPrefix()}-${volumeId}`.toLowerCase();
}

function now(): string {
  return new Date().toISOString();
}

// ─── Shared Storage Pool Management ────────────────────────────────────────────

function sanitizePoolId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+$/, "") || `pool-${crypto.randomUUID().slice(0, 8)}`
  );
}

export function listPools(): SharedStoragePool[] {
  return snapshot().sharedStoragePools ?? [];
}

export function getPool(poolId: string): SharedStoragePool | null {
  return (snapshot().sharedStoragePools ?? []).find((p) => p.id === poolId) ?? null;
}

export async function registerPool(
  input: SharedStoragePoolRequest,
  ownerNodeId: string,
  ownerNodeDid: string,
): Promise<SharedStoragePool> {
  const config = s3Config();
  const pool: SharedStoragePool = {
    id: sanitizePoolId(input.name),
    name: input.name.trim(),
    ownerNodeId,
    ownerNodeDid,
    endpoint: config.endpoint,
    region: config.region,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    totalCapacityGb: input.totalCapacityGb,
    availableCapacityGb: input.totalCapacityGb,
    status: "active",
    tags: input.tags ?? [],
    replicationFactor: input.replicationFactor ?? 1,
    createdAt: now(),
    updatedAt: now(),
  };
  mutateState((draft) => {
    if (!draft.sharedStoragePools) draft.sharedStoragePools = [];
    const index = draft.sharedStoragePools.findIndex((p) => p.id === pool.id);
    if (index >= 0) draft.sharedStoragePools[index] = pool;
    else draft.sharedStoragePools.push(pool);
  });
  return pool;
}

export function updatePoolHeartbeat(poolId: string): SharedStoragePool | null {
  let updated: SharedStoragePool | null = null;
  mutateState((draft) => {
    if (!draft.sharedStoragePools) return;
    const pool = draft.sharedStoragePools.find((p) => p.id === poolId);
    if (!pool) return;
    pool.lastHeartbeatAt = now();
    pool.updatedAt = now();
    updated = { ...pool };
  });
  return updated;
}

export function drainPool(poolId: string): SharedStoragePool | null {
  let updated: SharedStoragePool | null = null;
  mutateState((draft) => {
    if (!draft.sharedStoragePools) return;
    const pool = draft.sharedStoragePools.find((p) => p.id === poolId);
    if (!pool) return;
    pool.status = "draining";
    pool.updatedAt = now();
    updated = { ...pool };
  });
  return updated;
}

export function removePool(poolId: string): boolean {
  let removed = false;
  mutateState((draft) => {
    if (!draft.sharedStoragePools) return;
    const before = draft.sharedStoragePools.length;
    draft.sharedStoragePools = draft.sharedStoragePools.filter((p) => p.id !== poolId);
    removed = draft.sharedStoragePools.length < before;
  });
  return removed;
}

function selectPoolForVolume(pools: SharedStoragePool[], sizeGb: number): SharedStoragePool | null {
  const candidates = pools.filter((p) => p.status === "active" && p.availableCapacityGb >= sizeGb);
  if (candidates.length === 0) return null;
  // first-writer: pick the one with most available capacity (first writer wins capacity)
  candidates.sort((a, b) => b.availableCapacityGb - a.availableCapacityGb);
  const selected = candidates[0];
  if (!selected) return null;
  return selected;
}

export async function listFederatedPools(): Promise<SharedStoragePool[]> {
  // Get local pools
  const localPools = listPools();
  // TODO: Extend to query peer nodes for their pools via federation
  // For now, return local pools
  return localPools;
}

export async function checkStorageBackend(): Promise<StorageBackendStatus> {
  const config = s3Config();
  const probe = `${bucketPrefix()}-health-probe`;
  let reachable = false;
  let buckets = 0;
  try {
    await makeBucket(config, probe);
    reachable = await headBucket(config, probe);
    buckets = 1;
  } catch {
    reachable = false;
  }
  return {
    provider: hasStorageBackend() ? "minio" : "none",
    endpoint: config.endpoint,
    region: config.region,
    bucketPrefix: bucketPrefix(),
    configured: hasStorageBackend(),
    reachable,
    buckets,
  };
}

export function listVolumes(): StorageVolume[] {
  return snapshot().volumes;
}

export function getVolume(volumeId: string): StorageVolume | null {
  return snapshot().volumes.find((volume) => volume.id === volumeId) ?? null;
}

function sanitizeClassName(className?: string): string {
  const normalized = className?.trim() || "standard";
  return storage.classes.some((item) => item.name === normalized) ? normalized : "standard";
}

function sanitizeSizeGb(requested?: number): number {
  const value = typeof requested === "number" && Number.isFinite(requested) ? requested : 10;
  return Math.max(1, Math.min(1024, Math.round(value)));
}

function createVolumeRecord(input: StorageVolumeRequest): StorageVolume {
  const cls = storage.classes.find((item) => item.name === sanitizeClassName(input.className));
  const id =
    input.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+$/, "") || `volume-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: input.name.trim() || id,
    className: cls?.name ?? "standard",
    kind: cls?.kind ?? "object",
    sizeGb: sanitizeSizeGb(input.sizeGb),
    backend: cls?.name === "standard" ? "minio" : cls?.name === "shared" ? "shared" : "none",
    bucket: bucketForEndpoint(id),
    endpoint: endpoint(),
    status: "provisioning",
    ...(input.poolId ? { poolId: input.poolId } : {}),
    createdAt: now(),
    updatedAt: now(),
  };
}

export async function createVolume(input: StorageVolumeRequest): Promise<StorageVolume> {
  const record = createVolumeRecord(input);
  if (record.backend === "shared") {
    // Select a pool for this volume
    const pools = listPools();
    const selectedPool = input.poolId
      ? pools.find((p) => p.id === input.poolId)
      : selectPoolForVolume(pools, record.sizeGb);

    if (!selectedPool) {
      record.status = "failed";
      record.endpoint = "";
      record.bucket = "";
    } else {
      try {
        const config: S3Config = {
          endpoint: selectedPool.endpoint,
          accessKey: selectedPool.accessKey,
          secretKey: selectedPool.secretKey,
          region: selectedPool.region,
        };
        await makeBucket(config, record.bucket);
        record.endpoint = selectedPool.endpoint;
        record.poolId = selectedPool.id;
        record.poolOwnerDid = selectedPool.ownerNodeDid;
        // Reserve capacity on the pool
        mutateState((draft) => {
          if (!draft.sharedStoragePools) return;
          const pool = draft.sharedStoragePools.find((p) => p.id === selectedPool.id);
          if (pool) pool.availableCapacityGb -= record.sizeGb;
        });
        record.status = "provisioned";
      } catch {
        record.status = "failed";
      }
    }
  } else if (record.backend === "minio") {
    try {
      const config = s3Config();
      await makeBucket(config, record.bucket);
      record.status = "provisioned";
    } catch {
      record.status = "failed";
    }
  } else {
    record.status = "provisioned";
  }
  mutateState((draft) => {
    const index = draft.volumes.findIndex((item) => item.id === record.id);
    if (index >= 0) draft.volumes[index] = record;
    else draft.volumes.push(record);
  });
  return record;
}

export function deleteVolume(volumeId: string): boolean {
  let removed = false;
  mutateState((draft) => {
    const before = draft.volumes.length;
    draft.volumes = draft.volumes.filter((item) => item.id !== volumeId);
    removed = draft.volumes.length < before;
  });
  return removed;
}

export function attachVolume(volumeId: string, nodeId: string): StorageVolume | null {
  const existing = getVolume(volumeId);
  if (!existing || existing.status !== "provisioned") return null;
  let updated: StorageVolume | null = null;
  mutateState((draft) => {
    const volume = draft.volumes.find((item) => item.id === volumeId);
    if (!volume) return;
    volume.attachedToNodeId = nodeId;
    volume.updatedAt = now();
    updated = { ...volume };
  });
  return updated;
}

export const storageService = {
  backend: checkStorageBackend,
  create: createVolume,
  delete: deleteVolume,
  get: getVolume,
  list: listVolumes,
  attach: attachVolume,
  classes: storage.classes,
  // Pool management
  listPools,
  getPool,
  registerPool,
  updatePoolHeartbeat,
  drainPool,
  removePool,
  // Federated pool discovery
  listFederatedPools,
};

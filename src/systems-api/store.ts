import {
  type JsonStoreRecovery,
  getJsonStoreMetadata,
  loadJsonStoreWithRecovery,
  resolveJsonStorePath,
  writeJsonStoreAtomic,
} from "../persistence/json-store";
import type {
  SystemsApiAddress,
  SystemsApiAddressStatus,
  SystemsApiDomainBinding,
  SystemsApiExposureRecord,
  SystemsApiExposureStatus,
  SystemsApiMode,
  SystemsApiPhantomProtectionLevel,
  SystemsApiPhantomSecurityMetadata,
  SystemsApiPhantomSecurityProfile,
  SystemsApiPublicUrl,
  SystemsApiPublicUrlStatus,
  SystemsApiTool,
  SystemsApiToolExposure,
  SystemsApiToolHealth,
  SystemsApiToolHistoryEntry,
  SystemsApiToolRegistrationStatus,
} from "./types";

export type SystemsApiRegistryData = {
  tools: SystemsApiTool[];
  publicUrls: SystemsApiPublicUrl[];
  addresses: SystemsApiAddress[];
  history: SystemsApiToolHistoryEntry[];
  exposures: SystemsApiExposureRecord[];
  domains: SystemsApiDomainBinding[];
};

export type SystemsApiRegistryMetadata = {
  path: string;
  exists: boolean;
  sizeBytes: number;
  lastWriteAt: string | null;
  ageSeconds: number | null;
};

export type SystemsApiRegistryRecovery = JsonStoreRecovery;

const EMPTY_REGISTRY: SystemsApiRegistryData = {
  tools: [],
  publicUrls: [],
  addresses: [],
  history: [],
  exposures: [],
  domains: [],
};

function ensureStorageDir(): void {
  // Persistence directory creation is handled by the shared JSON store helper.
}

function getRegistryPath(): string {
  return resolveJsonStorePath(
    "data/systems-api-registry.json",
    "NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH",
  );
}

function sanitizeMode(value: unknown): SystemsApiMode | undefined {
  return value === "standalone" || value === "orchestrated" ? value : undefined;
}

function sanitizeHealth(value: unknown): SystemsApiToolHealth | undefined {
  return value === "healthy" || value === "degraded" || value === "offline" ? value : undefined;
}

function sanitizeRegistrationStatus(value: unknown): SystemsApiToolRegistrationStatus | undefined {
  return value === "registered" || value === "active" || value === "offline" ? value : undefined;
}

function sanitizeExposure(value: unknown): SystemsApiToolExposure | undefined {
  return value === "private" || value === "public" || value === "pending" ? value : undefined;
}

function sanitizePhantomProtectionLevel(
  value: unknown,
): SystemsApiPhantomProtectionLevel | undefined {
  return value === "transitional" || value === "hardened" || value === "maximum"
    ? value
    : undefined;
}

function sanitizePublicUrlStatus(value: unknown): SystemsApiPublicUrlStatus | undefined {
  return value === "active" || value === "pending" || value === "revoked" ? value : undefined;
}

function sanitizeExposureStatus(value: unknown): SystemsApiExposureStatus | undefined {
  return value === "requested" ||
    value === "active" ||
    value === "suspended" ||
    value === "quarantined" ||
    value === "denied" ||
    value === "revoked"
    ? value
    : undefined;
}

function sanitizeAddressStatus(value: unknown): SystemsApiAddressStatus | undefined {
  return value === "requested" || value === "active" || value === "revoked" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sanitizePhantomSecurityMetadata(
  value: unknown,
): SystemsApiPhantomSecurityMetadata | undefined {
  if (!isObject(value)) return undefined;
  const metadata: SystemsApiPhantomSecurityMetadata = {};
  const pqAlgorithms = toStringArray(value.pqAlgorithms);
  if (pqAlgorithms.length > 0) metadata.pqAlgorithms = pqAlgorithms;
  if (typeof value.fheScheme === "string") metadata.fheScheme = value.fheScheme;
  if (typeof value.zkProofSystem === "string") metadata.zkProofSystem = value.zkProofSystem;
  if (typeof value.proofAttestation === "string")
    metadata.proofAttestation = value.proofAttestation;
  if (typeof value.proofEndpoint === "string") metadata.proofEndpoint = value.proofEndpoint;
  if (typeof value.lastVerifiedAt === "string") metadata.lastVerifiedAt = value.lastVerifiedAt;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sanitizePhantomSecurityProfile(
  value: unknown,
): SystemsApiPhantomSecurityProfile | undefined {
  if (!isObject(value) || !isObject(value.guarantees)) return undefined;
  if (typeof value.claimedSecured !== "boolean") return undefined;
  const protectionLevel = sanitizePhantomProtectionLevel(value.protectionLevel) ?? "transitional";
  if (
    typeof value.guarantees.postQuantum !== "boolean" ||
    typeof value.guarantees.fheTransport !== "boolean" ||
    typeof value.guarantees.zkProofs !== "boolean"
  ) {
    return undefined;
  }
  const phantomMetadata = sanitizePhantomSecurityMetadata(value.metadata);
  return {
    claimedSecured: value.claimedSecured,
    protectionLevel,
    guarantees: {
      postQuantum: value.guarantees.postQuantum,
      fheTransport: value.guarantees.fheTransport,
      zkProofs: value.guarantees.zkProofs,
    },
    ...(phantomMetadata !== undefined ? { metadata: phantomMetadata } : {}),
  };
}

function sanitizeTool(value: unknown): SystemsApiTool | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";
  const description = typeof value.description === "string" ? value.description : "";
  const registeredAt =
    typeof value.registeredAt === "string" ? value.registeredAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : registeredAt;
  if (!id || !name || !description) return null;
  const phantomSecurityProfile = sanitizePhantomSecurityProfile(value.phantomSecurityProfile);
  const publicUrl = typeof value.publicUrl === "string" ? value.publicUrl : undefined;
  const upstreamUrl = typeof value.upstreamUrl === "string" ? value.upstreamUrl : undefined;
  const lastHeartbeatAt =
    typeof value.lastHeartbeatAt === "string" ? value.lastHeartbeatAt : undefined;
  const toolResult = {
    id,
    name,
    description,
    mode: sanitizeMode(value.mode) ?? "standalone",
    exposed: Boolean(value.exposed),
    exposure: sanitizeExposure(value.exposure) ?? (value.exposed ? "public" : "private"),
    health: sanitizeHealth(value.health) ?? "healthy",
    registrationStatus: sanitizeRegistrationStatus(value.registrationStatus) ?? "registered",
    capabilities: toStringArray(value.capabilities),
    heartbeatCount:
      typeof value.heartbeatCount === "number" && Number.isFinite(value.heartbeatCount)
        ? value.heartbeatCount
        : 0,
    registeredAt,
    updatedAt,
  } satisfies SystemsApiTool;
  return {
    ...toolResult,
    ...(phantomSecurityProfile !== undefined ? { phantomSecurityProfile } : {}),
    ...(publicUrl !== undefined ? { publicUrl } : {}),
    ...(upstreamUrl !== undefined ? { upstreamUrl } : {}),
    ...(lastHeartbeatAt !== undefined ? { lastHeartbeatAt } : {}),
  };
}

function sanitizePublicUrl(value: unknown): SystemsApiPublicUrl | null {
  if (!isObject(value)) return null;
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const url = typeof value.url === "string" ? value.url : "";
  const issuedAt = typeof value.issuedAt === "string" ? value.issuedAt : new Date().toISOString();
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt : issuedAt;
  if (!toolId || !url) return null;
  return {
    toolId,
    url,
    status: sanitizePublicUrlStatus(value.status) ?? "active",
    issuedAt,
    expiresAt,
  };
}

function sanitizeAddress(value: unknown): SystemsApiAddress | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const kind =
    value.kind === "website" ||
    value.kind === "email" ||
    value.kind === "server" ||
    value.kind === "custom"
      ? value.kind
      : null;
  const subject = typeof value.subject === "string" ? value.subject : "";
  const canonicalTarget = typeof value.canonicalTarget === "string" ? value.canonicalTarget : "";
  const publicAddress = typeof value.publicAddress === "string" ? value.publicAddress : "";
  const requestedAt =
    typeof value.requestedAt === "string" ? value.requestedAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : requestedAt;
  if (!id || !toolId || !kind || !subject || !canonicalTarget || !publicAddress) return null;
  const desiredHost = typeof value.desiredHost === "string" ? value.desiredHost : undefined;
  const activatedAt = typeof value.activatedAt === "string" ? value.activatedAt : undefined;
  const revokedAt = typeof value.revokedAt === "string" ? value.revokedAt : undefined;
  return {
    id,
    toolId,
    kind,
    subject,
    canonicalTarget,
    publicAddress,
    ...(desiredHost !== undefined ? { desiredHost } : {}),
    status: sanitizeAddressStatus(value.status) ?? "requested",
    requestedAt,
    ...(activatedAt !== undefined ? { activatedAt } : {}),
    ...(revokedAt !== undefined ? { revokedAt } : {}),
    updatedAt,
  };
}

function sanitizeHistoryEntry(value: unknown): SystemsApiToolHistoryEntry | null {
  if (!isObject(value)) return null;
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const action =
    value.action === "registered" ||
    value.action === "updated" ||
    value.action === "enabled" ||
    value.action === "disabled" ||
    value.action === "heartbeat-received" ||
    value.action === "public-url-issued" ||
    value.action === "public-url-revoked" ||
    value.action === "address-issued" ||
    value.action === "address-revoked" ||
    value.action === "domain-bound" ||
    value.action === "domain-verified" ||
    value.action === "domain-revoked" ||
    value.action === "exposure-requested" ||
    value.action === "exposure-activated" ||
    value.action === "exposure-revoked"
      ? value.action
      : "updated";
  const summary = typeof value.summary === "string" ? value.summary : "";
  const at = typeof value.at === "string" ? value.at : new Date().toISOString();
  if (!toolId || !summary) return null;
  return { toolId, action, summary, at };
}

function sanitizeExposureRecord(value: unknown): SystemsApiExposureRecord | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const canonicalUrl = typeof value.canonicalUrl === "string" ? value.canonicalUrl : "";
  const publicUrl = typeof value.publicUrl === "string" ? value.publicUrl : "";
  const requestedAt =
    typeof value.requestedAt === "string" ? value.requestedAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : requestedAt;
  if (!id || !toolId || !canonicalUrl || !publicUrl) return null;
  const desiredHost = typeof value.desiredHost === "string" ? value.desiredHost : undefined;
  const activatedAt = typeof value.activatedAt === "string" ? value.activatedAt : undefined;
  const revokedAt = typeof value.revokedAt === "string" ? value.revokedAt : undefined;
  return {
    id,
    toolId,
    canonicalUrl,
    publicUrl,
    ...(desiredHost !== undefined ? { desiredHost } : {}),
    status: sanitizeExposureStatus(value.status) ?? "requested",
    requestedAt,
    ...(activatedAt !== undefined ? { activatedAt } : {}),
    ...(revokedAt !== undefined ? { revokedAt } : {}),
    updatedAt,
  };
}

function sanitizeDomainBinding(value: unknown): SystemsApiDomainBinding | null {
  if (!isObject(value)) return null;
  const domain = typeof value.domain === "string" ? value.domain : "";
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const canonicalUrl = typeof value.canonicalUrl === "string" ? value.canonicalUrl : "";
  const publicUrl = typeof value.publicUrl === "string" ? value.publicUrl : "";
  const verificationToken =
    typeof value.verificationToken === "string" ? value.verificationToken : "";
  const verificationIssuedAt =
    typeof value.verificationIssuedAt === "string"
      ? value.verificationIssuedAt
      : new Date().toISOString();
  const verificationExpiresAt =
    typeof value.verificationExpiresAt === "string"
      ? value.verificationExpiresAt
      : verificationIssuedAt;
  const requestedAt =
    typeof value.requestedAt === "string" ? value.requestedAt : verificationIssuedAt;
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : requestedAt;
  if (!domain || !toolId || !canonicalUrl || !publicUrl || !verificationToken) return null;
  return {
    domain,
    toolId,
    canonicalUrl,
    publicUrl,
    verificationToken,
    verificationIssuedAt,
    verificationExpiresAt,
    status:
      value.status === "pending" ||
      value.status === "verified" ||
      value.status === "quarantined" ||
      value.status === "denied" ||
      value.status === "revoked" ||
      value.status === "expired"
        ? value.status
        : "pending",
    requestedAt,
    ...(typeof value.verifiedAt === "string" ? { verifiedAt: value.verifiedAt } : {}),
    ...(typeof value.revokedAt === "string" ? { revokedAt: value.revokedAt } : {}),
    updatedAt,
  };
}

function sanitizeRegistry(value: unknown): SystemsApiRegistryData {
  if (!isObject(value)) return EMPTY_REGISTRY;
  const tools = Array.isArray(value.tools)
    ? value.tools.map(sanitizeTool).filter((item): item is SystemsApiTool => item !== null)
    : [];
  const publicUrls = Array.isArray(value.publicUrls)
    ? value.publicUrls
        .map(sanitizePublicUrl)
        .filter((item): item is SystemsApiPublicUrl => item !== null)
    : [];
  const addresses = Array.isArray(value.addresses)
    ? value.addresses
        .map(sanitizeAddress)
        .filter((item): item is SystemsApiAddress => item !== null)
    : [];
  const history = Array.isArray(value.history)
    ? value.history
        .map(sanitizeHistoryEntry)
        .filter((item): item is SystemsApiToolHistoryEntry => item !== null)
    : [];
  const exposures = Array.isArray(value.exposures)
    ? value.exposures
        .map(sanitizeExposureRecord)
        .filter((item): item is SystemsApiExposureRecord => item !== null)
    : [];
  const domains = Array.isArray(value.domains)
    ? value.domains
        .map(sanitizeDomainBinding)
        .filter((item): item is SystemsApiDomainBinding => item !== null)
    : [];
  return { tools, publicUrls, addresses, history, exposures, domains };
}

export function loadSystemsApiRegistry(): SystemsApiRegistryData {
  return loadJsonStoreWithRecovery(getRegistryPath(), EMPTY_REGISTRY, sanitizeRegistry).value;
}

export function saveSystemsApiRegistry(registry: SystemsApiRegistryData): void {
  ensureStorageDir();
  writeJsonStoreAtomic(getRegistryPath(), registry, { backupCurrentPrimary: true });
}

export function getSystemsApiRegistryPath(): string {
  return getRegistryPath();
}

export function getSystemsApiRegistryMetadata(): SystemsApiRegistryMetadata {
  return getJsonStoreMetadata(getRegistryPath());
}

export function recoverSystemsApiRegistryFromDisk(): {
  registry: SystemsApiRegistryData;
  recovery: SystemsApiRegistryRecovery;
} {
  const loaded = loadJsonStoreWithRecovery(getRegistryPath(), EMPTY_REGISTRY, sanitizeRegistry);
  return {
    registry: loaded.value,
    recovery: loaded.recovery,
  };
}

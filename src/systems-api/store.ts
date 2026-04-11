import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SystemsApiAddress, SystemsApiAddressKind, SystemsApiAddressStatus, SystemsApiDomainBinding, SystemsApiDomainBindingStatus, SystemsApiExposureRecord, SystemsApiExposureStatus, SystemsApiMode, SystemsApiPublicUrl, SystemsApiPublicUrlStatus, SystemsApiTool, SystemsApiToolExposure, SystemsApiToolHealth, SystemsApiToolHistoryEntry } from "./types";

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

const REGISTRY_PATH = join(process.cwd(), "data", "systems-api-registry.json");

const EMPTY_REGISTRY: SystemsApiRegistryData = {
  tools: [],
  publicUrls: [],
  addresses: [],
  history: [],
  exposures: [],
  domains: [],
};

function ensureStorageDir(): void {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
}

function sanitizeMode(value: unknown): SystemsApiMode | undefined {
  return value === "standalone" || value === "orchestrated" ? value : undefined;
}

function sanitizeHealth(value: unknown): SystemsApiToolHealth | undefined {
  return value === "healthy" || value === "degraded" || value === "offline" ? value : undefined;
}

function sanitizeExposure(value: unknown): SystemsApiToolExposure | undefined {
  return value === "private" || value === "public" || value === "pending" ? value : undefined;
}

function sanitizePublicUrlStatus(value: unknown): SystemsApiPublicUrlStatus | undefined {
  return value === "active" || value === "pending" || value === "revoked" ? value : undefined;
}

function sanitizeExposureStatus(value: unknown): SystemsApiExposureStatus | undefined {
  return value === "requested" || value === "active" || value === "suspended" || value === "revoked" ? value : undefined;
}

function sanitizeAddressStatus(value: unknown): SystemsApiAddressStatus | undefined {
  return value === "requested" || value === "active" || value === "revoked" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sanitizeTool(value: unknown): SystemsApiTool | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";
  const description = typeof value.description === "string" ? value.description : "";
  const registeredAt = typeof value.registeredAt === "string" ? value.registeredAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : registeredAt;
  if (!id || !name || !description) return null;
  return {
    id,
    name,
    description,
    mode: sanitizeMode(value.mode) ?? "standalone",
    exposed: Boolean(value.exposed),
    exposure: sanitizeExposure(value.exposure) ?? (Boolean(value.exposed) ? "public" : "private"),
    health: sanitizeHealth(value.health) ?? "healthy",
    capabilities: toStringArray(value.capabilities),
    publicUrl: typeof value.publicUrl === "string" ? value.publicUrl : undefined,
    upstreamUrl: typeof value.upstreamUrl === "string" ? value.upstreamUrl : undefined,
    registeredAt,
    updatedAt,
  };
}

function sanitizePublicUrl(value: unknown): SystemsApiPublicUrl | null {
  if (!isObject(value)) return null;
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const url = typeof value.url === "string" ? value.url : "";
  const issuedAt = typeof value.issuedAt === "string" ? value.issuedAt : new Date().toISOString();
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt : issuedAt;
  if (!toolId || !url) return null;
  return { toolId, url, status: sanitizePublicUrlStatus(value.status) ?? "active", issuedAt, expiresAt };
}

function sanitizeAddress(value: unknown): SystemsApiAddress | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const kind = value.kind === "website" || value.kind === "email" || value.kind === "server" || value.kind === "custom" ? value.kind : null;
  const subject = typeof value.subject === "string" ? value.subject : "";
  const canonicalTarget = typeof value.canonicalTarget === "string" ? value.canonicalTarget : "";
  const publicAddress = typeof value.publicAddress === "string" ? value.publicAddress : "";
  const requestedAt = typeof value.requestedAt === "string" ? value.requestedAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : requestedAt;
  if (!id || !toolId || !kind || !subject || !canonicalTarget || !publicAddress) return null;
  return {
    id,
    toolId,
    kind,
    subject,
    canonicalTarget,
    publicAddress,
    desiredHost: typeof value.desiredHost === "string" ? value.desiredHost : undefined,
    status: sanitizeAddressStatus(value.status) ?? "requested",
    requestedAt,
    activatedAt: typeof value.activatedAt === "string" ? value.activatedAt : undefined,
    revokedAt: typeof value.revokedAt === "string" ? value.revokedAt : undefined,
    updatedAt,
  };
}

function sanitizeHistoryEntry(value: unknown): SystemsApiToolHistoryEntry | null {
  if (!isObject(value)) return null;
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const action = value.action === "registered" || value.action === "updated" || value.action === "enabled" || value.action === "disabled" || value.action === "public-url-issued" || value.action === "address-issued" || value.action === "domain-bound" || value.action === "domain-verified" || value.action === "domain-revoked" || value.action === "exposure-requested" || value.action === "exposure-activated" || value.action === "exposure-revoked" ? value.action : "updated";
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
  const requestedAt = typeof value.requestedAt === "string" ? value.requestedAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : requestedAt;
  if (!id || !toolId || !canonicalUrl || !publicUrl) return null;
  return {
    id,
    toolId,
    canonicalUrl,
    publicUrl,
    desiredHost: typeof value.desiredHost === "string" ? value.desiredHost : undefined,
    status: sanitizeExposureStatus(value.status) ?? "requested",
    requestedAt,
    activatedAt: typeof value.activatedAt === "string" ? value.activatedAt : undefined,
    revokedAt: typeof value.revokedAt === "string" ? value.revokedAt : undefined,
    updatedAt,
  };
}

function sanitizeDomainBinding(value: unknown): SystemsApiDomainBinding | null {
  if (!isObject(value)) return null;
  const domain = typeof value.domain === "string" ? value.domain : "";
  const toolId = typeof value.toolId === "string" ? value.toolId : "";
  const canonicalUrl = typeof value.canonicalUrl === "string" ? value.canonicalUrl : "";
  const publicUrl = typeof value.publicUrl === "string" ? value.publicUrl : "";
  const verificationToken = typeof value.verificationToken === "string" ? value.verificationToken : "";
  const verificationIssuedAt = typeof value.verificationIssuedAt === "string" ? value.verificationIssuedAt : new Date().toISOString();
  const verificationExpiresAt = typeof value.verificationExpiresAt === "string" ? value.verificationExpiresAt : verificationIssuedAt;
  const requestedAt = typeof value.requestedAt === "string" ? value.requestedAt : verificationIssuedAt;
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
    status: value.status === "pending" || value.status === "verified" || value.status === "revoked" || value.status === "expired" ? value.status : "pending",
    requestedAt,
    verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : undefined,
    revokedAt: typeof value.revokedAt === "string" ? value.revokedAt : undefined,
    updatedAt,
  };
}

function sanitizeRegistry(value: unknown): SystemsApiRegistryData {
  if (!isObject(value)) return EMPTY_REGISTRY;
  const tools = Array.isArray(value.tools) ? value.tools.map(sanitizeTool).filter((item): item is SystemsApiTool => item !== null) : [];
  const publicUrls = Array.isArray(value.publicUrls) ? value.publicUrls.map(sanitizePublicUrl).filter((item): item is SystemsApiPublicUrl => item !== null) : [];
  const addresses = Array.isArray(value.addresses) ? value.addresses.map(sanitizeAddress).filter((item): item is SystemsApiAddress => item !== null) : [];
  const history = Array.isArray(value.history) ? value.history.map(sanitizeHistoryEntry).filter((item): item is SystemsApiToolHistoryEntry => item !== null) : [];
  const exposures = Array.isArray(value.exposures) ? value.exposures.map(sanitizeExposureRecord).filter((item): item is SystemsApiExposureRecord => item !== null) : [];
  const domains = Array.isArray(value.domains) ? value.domains.map(sanitizeDomainBinding).filter((item): item is SystemsApiDomainBinding => item !== null) : [];
  return { tools, publicUrls, addresses, history, exposures, domains };
}

export function loadSystemsApiRegistry(): SystemsApiRegistryData {
  if (!existsSync(REGISTRY_PATH)) return EMPTY_REGISTRY;
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf8");
    return sanitizeRegistry(JSON.parse(raw));
  } catch {
    return EMPTY_REGISTRY;
  }
}

export function saveSystemsApiRegistry(registry: SystemsApiRegistryData): void {
  ensureStorageDir();
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

export function getSystemsApiRegistryPath(): string {
  return REGISTRY_PATH;
}

export function getSystemsApiRegistryMetadata(): SystemsApiRegistryMetadata {
  if (!existsSync(REGISTRY_PATH)) {
    return {
      path: REGISTRY_PATH,
      exists: false,
      sizeBytes: 0,
      lastWriteAt: null,
      ageSeconds: null,
    };
  }

  const stats = statSync(REGISTRY_PATH);
  return {
    path: REGISTRY_PATH,
    exists: true,
    sizeBytes: stats.size,
    lastWriteAt: stats.mtime.toISOString(),
    ageSeconds: Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000)),
  };
}

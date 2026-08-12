import { cloudConfig } from "../config";
import { systemsApiDeployIntegration as deployIntegration } from "./deploy";
import {
  deregisterTool,
  describeStatus,
  disableSystemsApiTool as disableTool,
  enableSystemsApiTool as enableTool,
  expireToolHeartbeat,
  getAddress,
  getDomainBinding,
  getDomainVerificationChallenge,
  getExposure,
  getPublicUrl,
  getTool,
  listActiveRoutes,
  listAddresses,
  listDomainBindings,
  listExposures,
  listPublicUrls,
  listToolHistory,
  listTools,
  updateTool as patchTool,
  recordToolHeartbeat,
  registerSystemsApiTool as registerTool,
  requestSystemsApiAddress as requestAddressRecord,
  requestDomainBinding,
  requestExposure,
  revokeSystemsApiAddress as revokeAddressRecords,
  revokeDomainBinding,
  revokeSystemsApiExposure as revokeExposure,
  verifyDomainBinding,
} from "./registry";
import type {
  SystemsApiAddress,
  SystemsApiAddressKind,
  SystemsApiApp,
  SystemsApiAppIntegrationMode,
  SystemsApiAppKind,
  SystemsApiCapability,
  SystemsApiConnection,
  SystemsApiDomainBinding,
  SystemsApiDomainVerificationChallenge,
  SystemsApiEndpoint,
  SystemsApiExposureRecord,
  SystemsApiMode,
  SystemsApiPhantomSecurityProfile,
  SystemsApiPublicUrl,
  SystemsApiStatus,
  SystemsApiSummary,
  SystemsApiTool,
  SystemsApiToolHealth,
  SystemsApiToolHistoryEntry,
  SystemsApiTopology,
} from "./types";

const _addressKinds: readonly SystemsApiAddressKind[] = ["website", "email", "server", "custom"];

import { topologyApps, topologyConnections } from "./topology-data";

function _appIntegrationMode(
  kind: SystemsApiAppKind,
  embeddedIn: string | null,
): SystemsApiAppIntegrationMode {
  if (embeddedIn) return "embedded";
  if (kind === "platform" || kind === "application") return "hybrid";
  return "standalone";
}

export type SystemsApiPublicUrlRequest = {
  toolId: string;
  desiredHost?: string;
  refresh?: boolean;
};

export type SystemsApiAddressRequest = {
  toolId: string;
  kind: SystemsApiAddressKind;
  subject?: string;
  desiredHost?: string;
};

export type SystemsApiExposureRequest = {
  toolId: string;
  desiredHost?: string;
};

export type SystemsApiDomainBindingRequest = {
  toolId: string;
  domain: string;
  desiredHost?: string;
};

export type SystemsApiDomainVerificationRequest = {
  domain: string;
  token: string;
};

export type SystemsApiToolRegistrationInput = {
  id: string;
  name: string;
  description: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: import("./types").SystemsApiToolHealth;
  capabilities?: readonly string[];
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  publicUrl?: string;
  upstreamUrl?: string;
};

export type SystemsApiToolPatchInput = {
  name?: string;
  description?: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: import("./types").SystemsApiToolHealth;
  capabilities?: readonly string[];
  upstreamUrl?: string;
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  /** Operator-only gate switch; see SystemsApiTool.requiresAuth. */
  requiresAuth?: boolean;
};

const endpoints = [
  { method: "GET", path: "/api/v1/tools", description: "List registered tools" },
  { method: "POST", path: "/api/v1/tools", description: "Register or upsert a tool" },
  { method: "GET", path: "/api/v1/tools/:toolId", description: "Inspect a registered tool" },
  {
    method: "GET",
    path: "/api/v1/tools/:toolId/history",
    description: "Inspect tool lifecycle history",
  },
  {
    method: "PATCH",
    path: "/api/v1/tools/:toolId",
    description: "Update registered tool metadata",
  },
  { method: "POST", path: "/api/v1/tools/:toolId/enable", description: "Enable a registered tool" },
  {
    method: "POST",
    path: "/api/v1/tools/:toolId/disable",
    description: "Disable a registered tool",
  },
  {
    method: "POST",
    path: "/api/v1/tools/:toolId/heartbeat",
    description: "Update tool liveness and upstream URL",
  },
  {
    method: "GET",
    path: "/api/v1/routes",
    description: "Live proxy routing table (domain → upstream)",
  },
  {
    method: "GET",
    path: "/api/v1/routes/caddy",
    description: "Caddy admin API format routing config",
  },
  {
    method: "GET",
    path: "/.well-known/nexus-cloud",
    description: "Nexus Cloud discovery document",
  },
  { method: "GET", path: "/api/v1/status", description: "Return normalized platform status" },
  {
    method: "GET",
    path: "/api/v1/compliance/phantom",
    description: "List PHANTOM security compliance entries",
  },
  {
    method: "GET",
    path: "/api/v1/compliance/phantom/summary",
    description: "Counts-only PHANTOM compliance summary",
  },
  { method: "POST", path: "/api/v1/public-url", description: "Request or refresh a public URL" },
  { method: "GET", path: "/api/v1/addresses", description: "List public address records" },
  {
    method: "GET",
    path: "/api/v1/addresses/:toolId",
    description: "Inspect public address records for a tool",
  },
  { method: "POST", path: "/api/v1/addresses", description: "Request a public address" },
  {
    method: "POST",
    path: "/api/v1/addresses/:toolId/revoke",
    description: "Revoke public address records for a tool",
  },
  { method: "GET", path: "/api/v1/exposures", description: "List exposure records" },
  { method: "GET", path: "/api/v1/exposures/:toolId", description: "Inspect an exposure record" },
  { method: "POST", path: "/api/v1/exposures", description: "Request a new exposure" },
  {
    method: "POST",
    path: "/api/v1/exposures/:toolId/revoke",
    description: "Revoke an exposure record",
  },
  { method: "GET", path: "/api/v1/domains", description: "List domain bindings" },
  { method: "POST", path: "/api/v1/domains", description: "Bind a custom domain" },
  { method: "GET", path: "/api/v1/domains/:domain", description: "Inspect a domain binding" },
  {
    method: "POST",
    path: "/api/v1/domains/:domain/verify",
    description: "Verify a domain binding",
  },
  { method: "DELETE", path: "/api/v1/domains/:domain", description: "Revoke a domain binding" },
  {
    method: "GET",
    path: "/api/v1/deployments/integration",
    description: "Inspect the Deploy backend integration",
  },
  {
    method: "POST",
    path: "/api/v1/deployments",
    description: "Request a managed Deploy deployment",
  },
] as const satisfies readonly SystemsApiEndpoint[];

const capabilities = [
  { id: "tools.discovery", description: "Discover tool metadata and exposure state" },
  { id: "tools.lifecycle", description: "Inspect and toggle tool exposure state" },
  { id: "tools.metadata", description: "Update tool metadata and capabilities" },
  { id: "tools.history", description: "Inspect tool lifecycle history" },
  { id: "status.health", description: "Read normalized health and platform summaries" },
  { id: "public-url.exposure", description: "Request public backend exposure" },
  {
    id: "addresses.issue",
    description: "Request website, email, server, and custom public addresses",
  },
  { id: "domains.binding", description: "Bind and verify custom domains" },
  { id: "domains.verification", description: "Generate and check domain verification challenges" },
  { id: "exposures.lifecycle", description: "Track exposure records and revocation state" },
  {
    id: "deploy.request",
    description: "Request and inspect managed deployments through Nexus Deploy",
  },
] as const satisfies readonly SystemsApiCapability[];

export function listSystemsApiEndpoints(): readonly SystemsApiEndpoint[] {
  return endpoints;
}

export function listSystemsApiCapabilities(): readonly SystemsApiCapability[] {
  return capabilities;
}

export function listSystemsApiTools(): readonly SystemsApiTool[] {
  return listTools();
}

export function getSystemsApiTool(toolId: string): SystemsApiTool | null {
  return getTool(toolId);
}

export function listSystemsApiToolHistory(toolId: string): readonly SystemsApiToolHistoryEntry[] {
  return listToolHistory(toolId);
}

export function listSystemsApiPublicUrls(): readonly SystemsApiPublicUrl[] {
  return listPublicUrls();
}

export function getSystemsApiPublicUrl(toolId: string): SystemsApiPublicUrl | null {
  return getPublicUrl(toolId);
}

export function listSystemsApiAddresses(): readonly SystemsApiAddress[] {
  return listAddresses();
}

export function listSystemsApiAddressesForTool(toolId: string): readonly SystemsApiAddress[] {
  return listAddresses().filter((item) => item.toolId === toolId);
}

export function getSystemsApiAddress(
  toolId: string,
  kind?: SystemsApiAddressKind,
): SystemsApiAddress | null {
  return getAddress(toolId, kind);
}

export function requestSystemsApiAddress(
  input: SystemsApiAddressRequest,
): SystemsApiAddress | null {
  return requestAddressRecord(input);
}

export function revokeSystemsApiAddress(input: {
  toolId: string;
  kind?: SystemsApiAddressKind;
}): readonly SystemsApiAddress[] {
  return revokeAddressRecords(input);
}

export function listSystemsApiExposures(): readonly SystemsApiExposureRecord[] {
  return listExposures();
}

export function getSystemsApiExposure(toolId: string): SystemsApiExposureRecord | null {
  return getExposure(toolId);
}

export function requestSystemsApiExposure(
  input: SystemsApiExposureRequest,
): SystemsApiExposureRecord | null {
  return requestExposure(input);
}

export function revokeSystemsApiExposure(toolId: string): SystemsApiExposureRecord | null {
  return revokeExposure(toolId);
}

export function listSystemsApiDomainBindings(): readonly SystemsApiDomainBinding[] {
  return listDomainBindings();
}

export function getSystemsApiDomainBinding(domain: string): SystemsApiDomainBinding | null {
  return getDomainBinding(domain);
}

export function requestSystemsApiDomainBinding(
  input: SystemsApiDomainBindingRequest,
): SystemsApiDomainBinding | null {
  return requestDomainBinding(input);
}

export function getSystemsApiDomainVerification(
  domain: string,
): SystemsApiDomainVerificationChallenge | null {
  return getDomainVerificationChallenge(domain);
}

export function verifySystemsApiDomain(
  domain: string,
  token: string,
): SystemsApiDomainBinding | null {
  return verifyDomainBinding(domain, token);
}

export function revokeSystemsApiDomain(domain: string): SystemsApiDomainBinding | null {
  return revokeDomainBinding(domain);
}

export function deregisterSystemsApiTool(toolId: string): SystemsApiTool | null {
  return deregisterTool(toolId);
}

export function registerSystemsApiTool(input: SystemsApiToolRegistrationInput): SystemsApiTool {
  return registerTool(input);
}

export function updateSystemsApiTool(
  toolId: string,
  patch: SystemsApiToolPatchInput,
): SystemsApiTool | null {
  return patchTool(toolId, patch);
}

export function exposeSystemsApiTool(toolId: string, exposed: boolean): SystemsApiTool | null {
  return exposed ? enableTool(toolId) : disableTool(toolId);
}

export function issueSystemsApiPublicUrl(
  input: SystemsApiPublicUrlRequest,
): SystemsApiPublicUrl | null {
  const tool = getSystemsApiTool(input.toolId);
  if (!tool) return null;
  const subject = input.desiredHost?.replace(/^https?:\/\//, "") || input.toolId;
  const addressRequest: SystemsApiAddressRequest = {
    toolId: input.toolId,
    kind: "website",
    subject,
  };
  if (input.desiredHost) addressRequest.desiredHost = input.desiredHost;
  const address = requestAddressRecord(addressRequest);
  if (!address) return null;
  return getPublicUrl(input.toolId);
}

export function describeSystemsApiStatus(): SystemsApiStatus {
  return describeStatus();
}

export function listSystemsApiApps(): readonly SystemsApiApp[] {
  return topologyApps;
}

export function listSystemsApiConnections(): readonly SystemsApiConnection[] {
  return topologyConnections;
}

export function describeSystemsApiTopology(): SystemsApiTopology {
  const embeddedAppCount = topologyApps.filter((app) => app.integrationMode === "embedded").length;
  const referencedAppCount = topologyApps.filter(
    (app) => app.integrationMode === "referenced",
  ).length;
  const hybridAppCount = topologyApps.filter((app) => app.integrationMode === "hybrid").length;
  return {
    apps: topologyApps,
    connections: topologyConnections,
    summary: {
      appCount: topologyApps.length,
      connectionCount: topologyConnections.length,
      embeddedAppCount,
      referencedAppCount,
      hybridAppCount,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function describeSystemsApi(): SystemsApiSummary {
  const status = describeSystemsApiStatus();
  return {
    version: status.version,
    scope: "canonical platform contract for Nexus tools and orchestrated services",
    endpoints,
    capabilities,
    toolCount: status.toolCount,
    status,
    addressKinds: status.addressKinds,
    deploy: deployIntegration,
  };
}

export function describeSystemsApiDeployIntegration(): typeof deployIntegration {
  return deployIntegration;
}

export const systemsApiDeployIntegration = deployIntegration;

export function listSystemsApiRoutes() {
  return listActiveRoutes();
}

export function heartbeatSystemsApiTool(
  toolId: string,
  patch: {
    upstreamUrl?: string;
    health?: SystemsApiToolHealth;
    phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  },
): SystemsApiTool | null {
  return recordToolHeartbeat(toolId, patch);
}

/**
 * Mark tools as `offline` when they have previously heartbeated but have not
 * done so within `thresholdMs` milliseconds. Tools that have never heartbeated
 * since Cloud started are left untouched (they keep their persisted state).
 * Returns the number of tools transitioned.
 */
export function applyHeartbeatExpiry(thresholdMs = 90_000): number {
  const cutoff = Date.now() - thresholdMs;
  let count = 0;
  for (const tool of listTools()) {
    if (tool.registrationStatus === "offline") continue;
    if (!tool.lastHeartbeatAt) continue;
    const lastHeartbeatMs = Date.parse(tool.lastHeartbeatAt);
    if (Number.isNaN(lastHeartbeatMs)) continue;
    if (lastHeartbeatMs < cutoff) {
      expireToolHeartbeat(tool.id, new Date().toISOString());
      count++;
    }
  }
  return count;
}

export function getCloudDomain(): string {
  return cloudConfig.cloudDomain;
}

export const systemsApiService = {
  deregisterSystemsApiTool,
  describeSystemsApi,
  describeSystemsApiDeployIntegration,
  describeSystemsApiStatus,
  describeSystemsApiTopology,
  disableSystemsApiTool: disableTool,
  enableSystemsApiTool: enableTool,
  exposeSystemsApiTool,
  getSystemsApiAddress,
  getSystemsApiAddressForTool: listSystemsApiAddressesForTool,
  getSystemsApiDomainBinding,
  getSystemsApiDomainVerification,
  getSystemsApiExposure,
  getSystemsApiPublicUrl,
  getSystemsApiTool,
  issueSystemsApiAddress: requestSystemsApiAddress,
  issueSystemsApiPublicUrl,
  listSystemsApiAddresses,
  listSystemsApiAddressesForTool,
  listSystemsApiApps,
  listSystemsApiCapabilities,
  listSystemsApiConnections,
  listSystemsApiDomainBindings,
  listSystemsApiEndpoints,
  listSystemsApiExposures,
  listSystemsApiPublicUrls,
  listSystemsApiToolHistory,
  listSystemsApiTools,
  registerSystemsApiTool,
  requestSystemsApiAddress,
  requestSystemsApiDomainBinding,
  requestSystemsApiExposure,
  revokeSystemsApiAddress,
  revokeSystemsApiDomain,
  revokeSystemsApiExposure,
  updateSystemsApiTool,
  verifySystemsApiDomain,
  listSystemsApiRoutes,
  heartbeatSystemsApiTool,
  applyHeartbeatExpiry,
  getCloudDomain,
};

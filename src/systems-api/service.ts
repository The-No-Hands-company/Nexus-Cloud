import {
  describeStatus,
  disableSystemsApiTool as disableTool,
  enableSystemsApiTool as enableTool,
  getAddress,
  getDomainBinding,
  getTool,
  getDomainVerificationChallenge,
  getExposure,
  getPublicUrl,
  listAddresses,
  listDomainBindings,
  listExposures,
  listPublicUrls,
  listToolHistory,
  listTools,
  registerSystemsApiTool as registerTool,
  requestDomainBinding,
  requestExposure,
  requestSystemsApiAddress as requestAddressRecord,
  revokeDomainBinding,
  revokeSystemsApiAddress as revokeAddressRecords,
  revokeSystemsApiExposure as revokeExposure,
  updateTool as patchTool,
  verifyDomainBinding,
} from "./registry";
import type {
  SystemsApiAddress,
  SystemsApiAddressKind,
  SystemsApiCapability,
  SystemsApiDomainBinding,
  SystemsApiDomainVerificationChallenge,
  SystemsApiEndpoint,
  SystemsApiExposureRecord,
  SystemsApiMode,
  SystemsApiPublicUrl,
  SystemsApiStatus,
  SystemsApiSummary,
  SystemsApiTool,
  SystemsApiToolHistoryEntry,
} from "./types";

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
  publicUrl?: string;
};

export type SystemsApiToolPatchInput = {
  name?: string;
  description?: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: import("./types").SystemsApiToolHealth;
  capabilities?: readonly string[];
};

const endpoints = [
  { method: "GET", path: "/api/v1/tools", description: "List registered tools" },
  { method: "GET", path: "/api/v1/tools/:toolId", description: "Inspect a registered tool" },
  { method: "GET", path: "/api/v1/tools/:toolId/history", description: "Inspect tool lifecycle history" },
  { method: "PATCH", path: "/api/v1/tools/:toolId", description: "Update registered tool metadata" },
  { method: "POST", path: "/api/v1/tools/:toolId/enable", description: "Enable a registered tool" },
  { method: "POST", path: "/api/v1/tools/:toolId/disable", description: "Disable a registered tool" },
  { method: "GET", path: "/api/v1/status", description: "Return normalized platform status" },
  { method: "POST", path: "/api/v1/public-url", description: "Request or refresh a public URL" },
  { method: "GET", path: "/api/v1/addresses", description: "List public address records" },
  { method: "GET", path: "/api/v1/addresses/:toolId", description: "Inspect public address records for a tool" },
  { method: "POST", path: "/api/v1/addresses", description: "Request a public address" },
  { method: "POST", path: "/api/v1/addresses/:toolId/revoke", description: "Revoke public address records for a tool" },
  { method: "GET", path: "/api/v1/exposures", description: "List exposure records" },
  { method: "GET", path: "/api/v1/exposures/:toolId", description: "Inspect an exposure record" },
  { method: "POST", path: "/api/v1/exposures", description: "Request a new exposure" },
  { method: "POST", path: "/api/v1/exposures/:toolId/revoke", description: "Revoke an exposure record" },
  { method: "GET", path: "/api/v1/domains", description: "List domain bindings" },
  { method: "POST", path: "/api/v1/domains", description: "Bind a custom domain" },
  { method: "GET", path: "/api/v1/domains/:domain", description: "Inspect a domain binding" },
  { method: "POST", path: "/api/v1/domains/:domain/verify", description: "Verify a domain binding" },
  { method: "DELETE", path: "/api/v1/domains/:domain", description: "Revoke a domain binding" },
] as const satisfies readonly SystemsApiEndpoint[];

const capabilities = [
  { id: "tools.discovery", description: "Discover tool metadata and exposure state" },
  { id: "tools.lifecycle", description: "Inspect and toggle tool exposure state" },
  { id: "tools.metadata", description: "Update tool metadata and capabilities" },
  { id: "tools.history", description: "Inspect tool lifecycle history" },
  { id: "status.health", description: "Read normalized health and platform summaries" },
  { id: "public-url.exposure", description: "Request public backend exposure" },
  { id: "addresses.issue", description: "Request website, email, server, and custom public addresses" },
  { id: "domains.binding", description: "Bind and verify custom domains" },
  { id: "domains.verification", description: "Generate and check domain verification challenges" },
  { id: "exposures.lifecycle", description: "Track exposure records and revocation state" },
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

export function getSystemsApiAddress(toolId: string, kind?: SystemsApiAddressKind): SystemsApiAddress | null {
  return getAddress(toolId, kind);
}

export function requestSystemsApiAddress(input: SystemsApiAddressRequest): SystemsApiAddress | null {
  return requestAddressRecord(input);
}

export function revokeSystemsApiAddress(input: { toolId: string; kind?: SystemsApiAddressKind }): readonly SystemsApiAddress[] {
  return revokeAddressRecords(input);
}

export function listSystemsApiExposures(): readonly SystemsApiExposureRecord[] {
  return listExposures();
}

export function getSystemsApiExposure(toolId: string): SystemsApiExposureRecord | null {
  return getExposure(toolId);
}

export function requestSystemsApiExposure(input: SystemsApiExposureRequest): SystemsApiExposureRecord | null {
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

export function requestSystemsApiDomainBinding(input: SystemsApiDomainBindingRequest): SystemsApiDomainBinding | null {
  return requestDomainBinding(input);
}

export function getSystemsApiDomainVerification(domain: string): SystemsApiDomainVerificationChallenge | null {
  return getDomainVerificationChallenge(domain);
}

export function verifySystemsApiDomain(domain: string, token: string): SystemsApiDomainBinding | null {
  return verifyDomainBinding(domain, token);
}

export function revokeSystemsApiDomain(domain: string): SystemsApiDomainBinding | null {
  return revokeDomainBinding(domain);
}

export function registerSystemsApiTool(input: SystemsApiToolRegistrationInput): SystemsApiTool {
  return registerTool(input);
}

export function updateSystemsApiTool(toolId: string, patch: SystemsApiToolPatchInput): SystemsApiTool | null {
  return patchTool(toolId, patch);
}

export function exposeSystemsApiTool(toolId: string, exposed: boolean): SystemsApiTool | null {
  return exposed ? enableTool(toolId) : disableTool(toolId);
}

export function issueSystemsApiPublicUrl(input: SystemsApiPublicUrlRequest): SystemsApiPublicUrl | null {
  const tool = getSystemsApiTool(input.toolId);
  if (!tool) return null;
  const subject = input.desiredHost?.replace(/^https?:\/\//, "") || input.toolId;
  const address = requestAddressRecord({
    toolId: input.toolId,
    kind: "website",
    subject,
    desiredHost: input.desiredHost,
  });
  if (!address) return null;
  return getPublicUrl(input.toolId);
}

export function describeSystemsApiStatus(): SystemsApiStatus {
  return describeStatus();
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
  };
}

export const systemsApiService = {
  describeSystemsApi,
  describeSystemsApiStatus,
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
  listSystemsApiCapabilities,
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
};

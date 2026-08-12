import { guardianService } from "../guardian";
import { recordEvent } from "../observability";
import { state } from "../state";
import { buildPublicAddress, createAddressRecord, revokeAddressRecord } from "./address";
import {
  issueDomainVerificationChallenge as buildDomainVerificationChallenge,
  createDomainBinding,
  revokeDomainBinding as revokeDomainRecord,
  verifyDomainBinding as verifyDomainRecord,
} from "./domains";
import {
  buildPublicUrl,
  createExposureRecord,
  revokeExposureRecord,
  transitionExposureRecord,
} from "./exposure";
import {
  type SystemsApiRegistryData,
  getSystemsApiRegistryMetadata,
  loadSystemsApiRegistry,
  saveSystemsApiRegistry,
} from "./store";
import type {
  SystemsApiAddress,
  SystemsApiAddressKind,
  SystemsApiDomainBinding,
  SystemsApiDomainVerificationChallenge,
  SystemsApiExposureRecord,
  SystemsApiMode,
  SystemsApiPhantomProtectionLevel,
  SystemsApiPhantomSecurityProfile,
  SystemsApiPublicUrl,
  SystemsApiRoute,
  SystemsApiStatus,
  SystemsApiTool,
  SystemsApiToolExposure,
  SystemsApiToolHealth,
  SystemsApiToolHistoryAction,
  SystemsApiToolHistoryEntry,
  SystemsApiTrustStateSummary,
} from "./types";

export type SystemsApiToolRegistrationInput = {
  id: string;
  name: string;
  description: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: SystemsApiToolHealth;
  capabilities?: readonly string[];
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  publicUrl?: string;
  /** Actual backend URL so the proxy routing table can forward traffic */
  upstreamUrl?: string;
};

export type SystemsApiToolPatchInput = {
  name?: string;
  description?: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: SystemsApiToolHealth;
  capabilities?: readonly string[];
  upstreamUrl?: string;
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  /** Operator-only gate switch; see SystemsApiTool.requiresAuth. */
  requiresAuth?: boolean;
};

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

const registry: SystemsApiRegistryData = loadSystemsApiRegistry();

function persist(): void {
  saveSystemsApiRegistry(registry);
}

function cloneRegistryData(data: SystemsApiRegistryData): SystemsApiRegistryData {
  return {
    tools: data.tools.map((item) => ({ ...item })),
    publicUrls: data.publicUrls.map((item) => ({ ...item })),
    addresses: data.addresses.map((item) => ({ ...item })),
    history: data.history.map((item) => ({ ...item })),
    exposures: data.exposures.map((item) => ({ ...item })),
    domains: data.domains.map((item) => ({ ...item })),
  };
}

export function resetSystemsApiRegistryForTests(
  next: SystemsApiRegistryData = {
    tools: [],
    publicUrls: [],
    addresses: [],
    history: [],
    exposures: [],
    domains: [],
  },
): void {
  const snapshot = cloneRegistryData(next);
  registry.tools = snapshot.tools;
  registry.publicUrls = snapshot.publicUrls;
  registry.addresses = snapshot.addresses;
  registry.history = snapshot.history;
  registry.exposures = snapshot.exposures;
  registry.domains = snapshot.domains;
  persist();
}

function now(): string {
  return new Date().toISOString();
}

function currentMode(): SystemsApiMode {
  return process.env.SYSTEMS_API_MODE === "orchestrated" ? "orchestrated" : "standalone";
}

function exposureFromFlag(exposed: boolean): SystemsApiToolExposure {
  return exposed ? "public" : "private";
}

function findToolIndex(toolId: string): number {
  return registry.tools.findIndex((tool) => tool.id === toolId);
}

function phantomProtectionLevel(
  profile?: SystemsApiPhantomSecurityProfile,
): SystemsApiPhantomProtectionLevel {
  return profile?.protectionLevel ?? "transitional";
}

function phantomSecurityTag(
  profile?: SystemsApiPhantomSecurityProfile,
): "phantom-hardened" | "transitional" {
  if (!profile) return "transitional";
  if (!profile.claimedSecured) return "transitional";
  return evaluatePhantomCompliance(profile).length === 0 ? "phantom-hardened" : "transitional";
}

function evaluatePhantomCompliance(profile: SystemsApiPhantomSecurityProfile): string[] {
  const failures: string[] = [];
  if (!profile.claimedSecured) return failures;

  if (!profile.guarantees.postQuantum) failures.push("missing post-quantum guarantee");
  if (!profile.guarantees.fheTransport) failures.push("missing FHE transport guarantee");
  if (!profile.guarantees.zkProofs) failures.push("missing zk proof guarantee");

  const metadata = profile.metadata;
  if (!metadata || !Array.isArray(metadata.pqAlgorithms) || metadata.pqAlgorithms.length === 0) {
    failures.push("missing pqAlgorithms metadata");
  }
  if (!metadata?.fheScheme) failures.push("missing fheScheme metadata");
  if (!metadata?.zkProofSystem) failures.push("missing zkProofSystem metadata");
  if (!metadata?.proofAttestation) failures.push("missing proofAttestation metadata");
  if (!metadata?.proofEndpoint) failures.push("missing proofEndpoint metadata");

  return failures;
}

/**
 * Cap on `registry.history`, which is rewritten to disk on every mutation and
 * re-read on every start. It had grown to 4466 entries behind 84 tools — an
 * 814 KB file — because nothing ever removed one; heartbeats alone append
 * forever. Oldest entries are dropped first.
 *
 * Safe to bound because this is not the audit system of record: durable audit
 * lives behind /api/v1/audit and is unaffected. This array only backs
 * /api/v1/tools/:toolId/history, which is a recent-activity view.
 */
const HISTORY_LIMIT = Math.max(1, Number(process.env.NEXUS_CLOUD_TOOL_HISTORY_LIMIT || "1000"));

function trimHistory(): boolean {
  const excess = registry.history.length - HISTORY_LIMIT;
  if (excess <= 0) return false;
  registry.history.splice(0, excess);
  return true;
}

function pushHistory(
  toolId: string,
  action: SystemsApiToolHistoryAction,
  summary: string,
  at = now(),
): void {
  registry.history.push({ toolId, action, summary, at });
  trimHistory();
}

// Shrink a store that is already over the cap, rather than leaving it oversized
// until something happens to mutate it. Only writes when it actually trimmed.
if (trimHistory()) persist();

function updateToolRecord(
  toolId: string,
  updater: (tool: SystemsApiTool) => SystemsApiTool,
): SystemsApiTool | null {
  const existingIndex = findToolIndex(toolId);
  if (existingIndex < 0) return null;
  const current = registry.tools[existingIndex];
  if (!current) return null;
  const next = updater(current);
  registry.tools[existingIndex] = next;
  return next;
}

function buildTool(
  input: SystemsApiToolRegistrationInput,
  previous: SystemsApiTool | null = null,
): SystemsApiTool {
  const phantomSecurityProfile = input.phantomSecurityProfile ?? previous?.phantomSecurityProfile;
  const publicUrl = input.publicUrl ?? previous?.publicUrl;
  const upstreamUrl = input.upstreamUrl ?? previous?.upstreamUrl;
  const lastHeartbeatAt = previous?.lastHeartbeatAt;
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    mode: input.mode ?? previous?.mode ?? currentMode(),
    exposed: input.exposed ?? previous?.exposed ?? false,
    exposure: exposureFromFlag(input.exposed ?? previous?.exposed ?? false),
    health: input.health ?? previous?.health ?? "healthy",
    registrationStatus: previous?.registrationStatus ?? "registered",
    capabilities: input.capabilities ?? previous?.capabilities ?? [],
    ...(phantomSecurityProfile !== undefined ? { phantomSecurityProfile } : {}),
    ...(publicUrl !== undefined ? { publicUrl } : {}),
    ...(upstreamUrl !== undefined ? { upstreamUrl } : {}),
    // Carried from the previous record and never read from `input`. A tool
    // re-registers on every restart and heartbeat; if its payload could set
    // this, an app that simply omitted the field would silently un-gate itself
    // — the same way an omitted publicUrl once clobbered a live route. Only
    // setToolRequiresAuth changes it.
    ...(previous?.requiresAuth !== undefined ? { requiresAuth: previous.requiresAuth } : {}),
    ...(lastHeartbeatAt !== undefined ? { lastHeartbeatAt } : {}),
    heartbeatCount: previous?.heartbeatCount ?? 0,
    registeredAt: previous?.registeredAt ?? now(),
    updatedAt: now(),
  };
}

function upsertToolRecord(tool: SystemsApiTool): SystemsApiTool {
  const existingIndex = findToolIndex(tool.id);
  if (existingIndex >= 0) registry.tools[existingIndex] = tool;
  else registry.tools.push(tool);
  return tool;
}

function upsertExposureRecord(record: SystemsApiExposureRecord): SystemsApiExposureRecord {
  const existingIndex = registry.exposures.findIndex((item) => item.toolId === record.toolId);
  if (existingIndex >= 0) registry.exposures[existingIndex] = record;
  else registry.exposures.push(record);
  return record;
}

function upsertPublicUrlRecord(record: SystemsApiPublicUrl): SystemsApiPublicUrl {
  const existingIndex = registry.publicUrls.findIndex((item) => item.toolId === record.toolId);
  if (existingIndex >= 0) registry.publicUrls[existingIndex] = record;
  else registry.publicUrls.push(record);
  return record;
}

function upsertAddressRecord(record: SystemsApiAddress): SystemsApiAddress {
  const existingIndex = registry.addresses.findIndex(
    (item) =>
      item.toolId === record.toolId && item.kind === record.kind && item.subject === record.subject,
  );
  if (existingIndex >= 0) registry.addresses[existingIndex] = record;
  else registry.addresses.push(record);
  return record;
}

function upsertDomainRecord(record: SystemsApiDomainBinding): SystemsApiDomainBinding {
  const existingIndex = registry.domains.findIndex((item) => item.domain === record.domain);
  if (existingIndex >= 0) registry.domains[existingIndex] = record;
  else registry.domains.push(record);
  return record;
}

function _hasActiveWebsiteAddress(toolId: string): boolean {
  return registry.addresses.some(
    (item) => item.toolId === toolId && item.kind === "website" && item.status === "active",
  );
}

function hasActiveAddress(toolId: string): boolean {
  return registry.addresses.some((item) => item.toolId === toolId && item.status === "active");
}

function summarizeTrustStates(states: readonly string[]): SystemsApiTrustStateSummary {
  return {
    total: states.length,
    pending: states.filter((state) => state === "pending").length,
    verified: states.filter((state) => state === "verified").length,
    trusted: states.filter((state) => state === "trusted").length,
    quarantined: states.filter((state) => state === "quarantined").length,
    revoked: states.filter((state) => state === "revoked").length,
    expired: states.filter((state) => state === "expired").length,
  };
}

function revokePublicUrlRecord(toolId: string): SystemsApiPublicUrl | null {
  const publicUrl = getPublicUrl(toolId);
  if (!publicUrl) return null;
  const revoked: SystemsApiPublicUrl = {
    ...publicUrl,
    status: "revoked",
  };
  upsertPublicUrlRecord(revoked);
  pushHistory(toolId, "public-url-revoked", `Revoked public URL for ${toolId}`, now());
  return revoked;
}

export function listTools(): readonly SystemsApiTool[] {
  return registry.tools;
}

export function getTool(toolId: string): SystemsApiTool | null {
  return registry.tools.find((tool) => tool.id === toolId) ?? null;
}

export function listToolHistory(toolId: string): readonly SystemsApiToolHistoryEntry[] {
  return registry.history.filter((entry) => entry.toolId === toolId);
}

export function registerSystemsApiTool(input: SystemsApiToolRegistrationInput): SystemsApiTool {
  const existingIndex = findToolIndex(input.id);
  const previous = existingIndex >= 0 ? registry.tools[existingIndex] : null;
  const tool = buildTool(input, previous);
  const action: SystemsApiToolHistoryAction = previous ? "updated" : "registered";

  upsertToolRecord(tool);
  pushHistory(
    tool.id,
    action,
    action === "registered" ? `Registered ${tool.name}` : `Updated ${tool.name}`,
    tool.updatedAt,
  );
  persist();
  return tool;
}

export function recordToolHeartbeat(
  toolId: string,
  patch: {
    upstreamUrl?: string;
    health?: SystemsApiToolHealth;
    phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  },
): SystemsApiTool | null {
  const heartbeatAt = now();
  const tool = updateToolRecord(toolId, (current) => ({
    ...current,
    ...(patch.upstreamUrl !== undefined
      ? { upstreamUrl: patch.upstreamUrl }
      : current.upstreamUrl !== undefined
        ? { upstreamUrl: current.upstreamUrl }
        : {}),
    health: patch.health ?? (current.health === "offline" ? "healthy" : current.health),
    registrationStatus: "active",
    ...(patch.phantomSecurityProfile !== undefined
      ? { phantomSecurityProfile: patch.phantomSecurityProfile }
      : current.phantomSecurityProfile !== undefined
        ? { phantomSecurityProfile: current.phantomSecurityProfile }
        : {}),
    lastHeartbeatAt: heartbeatAt,
    heartbeatCount: current.heartbeatCount + 1,
    updatedAt: heartbeatAt,
  }));

  if (!tool) return null;

  pushHistory(toolId, "heartbeat-received", `Recorded heartbeat for ${tool.name}`, heartbeatAt);
  persist();
  return tool;
}

export function expireToolHeartbeat(toolId: string, expiredAt = now()): SystemsApiTool | null {
  const tool = updateToolRecord(toolId, (current) => ({
    ...current,
    health: "offline",
    registrationStatus: "offline",
    updatedAt: expiredAt,
  }));

  if (!tool) return null;

  pushHistory(toolId, "updated", `Marked ${tool.name} offline after missed heartbeat`, expiredAt);
  persist();
  return tool;
}

export function updateTool(toolId: string, patch: SystemsApiToolPatchInput): SystemsApiTool | null {
  const existingIndex = findToolIndex(toolId);
  if (existingIndex < 0) return null;

  const previous = registry.tools[existingIndex];
  if (!previous) return null;
  const tool: SystemsApiTool = {
    ...previous,
    name: patch.name ?? previous.name,
    description: patch.description ?? previous.description,
    mode: patch.mode ?? previous.mode,
    exposed: patch.exposed ?? previous.exposed,
    exposure: exposureFromFlag(patch.exposed ?? previous.exposed),
    health: patch.health ?? previous.health,
    capabilities: patch.capabilities ?? previous.capabilities,
    ...(patch.upstreamUrl !== undefined
      ? { upstreamUrl: patch.upstreamUrl }
      : previous.upstreamUrl !== undefined
        ? { upstreamUrl: previous.upstreamUrl }
        : {}),
    ...(patch.phantomSecurityProfile !== undefined
      ? { phantomSecurityProfile: patch.phantomSecurityProfile }
      : previous.phantomSecurityProfile !== undefined
        ? { phantomSecurityProfile: previous.phantomSecurityProfile }
        : {}),
    // The only place this flag can change. Absent in the patch means "leave
    // the gate as it is", not "open it".
    ...(patch.requiresAuth !== undefined
      ? { requiresAuth: patch.requiresAuth }
      : previous.requiresAuth !== undefined
        ? { requiresAuth: previous.requiresAuth }
        : {}),
    updatedAt: now(),
  };

  upsertToolRecord(tool);
  pushHistory(toolId, "updated", `Edited metadata for ${tool.name}`, tool.updatedAt);
  persist();
  return tool;
}

export function deregisterTool(toolId: string): SystemsApiTool | null {
  const existingIndex = findToolIndex(toolId);
  if (existingIndex < 0) return null;
  const [removed] = registry.tools.splice(existingIndex, 1);
  registry.history = registry.history.filter((entry) => entry.toolId !== toolId);
  persist();
  return removed ?? null;
}

export function enableSystemsApiTool(toolId: string): SystemsApiTool | null {
  const tool = updateToolRecord(toolId, (current) => ({
    ...current,
    exposed: true,
    exposure: "public",
    updatedAt: now(),
  }));

  if (!tool) return null;

  pushHistory(toolId, "enabled", `Enabled ${tool.name}`, tool.updatedAt);
  persist();
  return tool;
}

export function disableSystemsApiTool(toolId: string): SystemsApiTool | null {
  const tool = updateToolRecord(toolId, (current) => ({
    ...current,
    exposed: false,
    exposure: "private",
    updatedAt: now(),
  }));

  if (!tool) return null;

  pushHistory(toolId, "disabled", `Disabled ${tool.name}`, tool.updatedAt);
  persist();
  return tool;
}

export function requestSystemsApiAddress(
  input: SystemsApiAddressRequest,
): SystemsApiAddress | null {
  const tool = getTool(input.toolId);
  if (!tool) return null;

  const decision = guardianService.evaluateGuardianRequest({
    scope: "exposure",
    tool,
    subjectId: `${tool.id}:address:${input.kind}`,
    ...(input.desiredHost !== undefined ? { desiredHost: input.desiredHost } : {}),
  });
  guardianService.recordGuardianDecision({
    toolId: tool.id,
    scope: "exposure",
    subjectId: `${tool.id}:address:${input.kind}`,
    status: decision.status,
    reason: decision.reason,
    ...(decision.metadata !== undefined ? { metadata: decision.metadata } : {}),
  });

  const publicAddress = buildPublicAddress(input);
  const record = createAddressRecord(
    input,
    publicAddress,
    decision.status === "approved" ? "active" : "requested",
  );
  upsertAddressRecord(record);

  if (decision.status === "approved") {
    updateToolRecord(tool.id, (current) => ({
      ...current,
      exposed: true,
      exposure: "public",
      ...(input.kind === "website"
        ? { publicUrl: publicAddress }
        : current.publicUrl !== undefined
          ? { publicUrl: current.publicUrl }
          : {}),
      updatedAt: now(),
    }));
  }

  if (input.kind === "website") {
    const publicUrl: SystemsApiPublicUrl = {
      toolId: tool.id,
      url: publicAddress,
      status: decision.status === "approved" ? "active" : "pending",
      issuedAt: record.requestedAt,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    };
    upsertPublicUrlRecord(publicUrl);

    const existingExposure = getExposure(tool.id);
    const exposure = existingExposure
      ? transitionExposureRecord(
          existingExposure,
          decision.status === "approved"
            ? "active"
            : decision.status === "quarantined"
              ? "quarantined"
              : "denied",
          publicAddress,
          record.requestedAt,
        )
      : createExposureRecord(
          {
            toolId: tool.id,
            ...(input.desiredHost !== undefined ? { desiredHost: input.desiredHost } : {}),
          },
          publicAddress,
          decision.status === "approved"
            ? "active"
            : decision.status === "quarantined"
              ? "quarantined"
              : "denied",
          record.requestedAt,
        );
    upsertExposureRecord(exposure);

    if (decision.status === "approved")
      pushHistory(
        tool.id,
        "public-url-issued",
        `Issued public URL for ${tool.name}`,
        record.requestedAt,
      );
    pushHistory(
      tool.id,
      "exposure-requested",
      `Requested exposure for ${tool.name}`,
      exposure.requestedAt,
    );
    if (decision.status === "approved")
      pushHistory(
        tool.id,
        "exposure-activated",
        `Activated exposure for ${tool.name}`,
        exposure.activatedAt ?? exposure.updatedAt,
      );
  }

  recordEvent({
    kind: "audit",
    level:
      decision.status === "approved" ? "info" : decision.status === "denied" ? "error" : "warn",
    source: "systems-api",
    subjectId: tool.id,
    message: `Address request ${decision.status} for ${tool.name}`,
    timestamp: record.requestedAt,
  });
  pushHistory(
    tool.id,
    "address-issued",
    `Issued ${input.kind} address ${publicAddress}`,
    record.requestedAt,
  );
  persist();
  return record;
}

export function revokeSystemsApiAddress(input: {
  toolId: string;
  kind?: SystemsApiAddressKind;
}): readonly SystemsApiAddress[] {
  const matches = registry.addresses.filter(
    (item) =>
      item.toolId === input.toolId && (input.kind === undefined || item.kind === input.kind),
  );
  if (!matches.length) return [];

  const revoked = matches.map((address) => {
    const next = revokeAddressRecord(address);
    upsertAddressRecord(next);
    pushHistory(
      input.toolId,
      "address-revoked",
      `Revoked ${next.kind} address ${next.publicAddress}`,
      next.revokedAt ?? next.updatedAt,
    );
    return next;
  });

  const needsPublicUrlRevoke = revoked.some((item) => item.kind === "website");
  if (needsPublicUrlRevoke) {
    revokePublicUrlRecord(input.toolId);
  }

  if (!hasActiveAddress(input.toolId)) {
    updateToolRecord(input.toolId, (current) => {
      // Drop the tool's own publicUrl too. It is a copy of the address, and
      // leaving it behind meant a revoked tool kept advertising a URL it no
      // longer owns: the address, exposure and public-url records all read
      // "revoked" while /api/v1/tools still returned https://<tool>.localhost,
      // and the dashboard offered an Open button for it.
      const { publicUrl: _revoked, ...rest } = current;
      return {
        ...rest,
        exposed: false,
        exposure: "private",
        updatedAt: now(),
      };
    });
  }

  persist();
  return revoked;
}

export function requestExposure(input: SystemsApiExposureRequest): SystemsApiExposureRecord | null {
  const tool = getTool(input.toolId);
  if (!tool) return null;

  const decision = guardianService.evaluateGuardianRequest({
    scope: "exposure",
    tool,
    subjectId: `${tool.id}:exposure`,
    ...(input.desiredHost !== undefined ? { desiredHost: input.desiredHost } : {}),
  });
  guardianService.recordGuardianDecision({
    toolId: tool.id,
    scope: "exposure",
    subjectId: `${tool.id}:exposure`,
    status: decision.status,
    reason: decision.reason,
    ...(decision.metadata !== undefined ? { metadata: decision.metadata } : {}),
  });

  const publicUrl = buildPublicUrl(tool.id, input.desiredHost);
  const requested = createExposureRecord(
    {
      toolId: tool.id,
      ...(input.desiredHost !== undefined ? { desiredHost: input.desiredHost } : {}),
    },
    publicUrl,
    "requested",
  );
  const record = transitionExposureRecord(
    requested,
    decision.status === "approved"
      ? "active"
      : decision.status === "quarantined"
        ? "quarantined"
        : "denied",
    publicUrl,
  );
  upsertExposureRecord(record);

  if (decision.status === "approved") {
    updateToolRecord(tool.id, (current) => ({
      ...current,
      exposed: true,
      exposure: "public",
      publicUrl,
      updatedAt: now(),
    }));
  }

  pushHistory(
    tool.id,
    "exposure-requested",
    `Requested exposure for ${tool.name}`,
    record.requestedAt,
  );
  if (decision.status === "approved") {
    pushHistory(
      tool.id,
      "exposure-activated",
      `Activated exposure for ${tool.name}`,
      record.activatedAt ?? record.updatedAt,
    );
  }
  recordEvent({
    kind: "audit",
    level:
      decision.status === "approved" ? "info" : decision.status === "denied" ? "error" : "warn",
    source: "systems-api",
    subjectId: tool.id,
    message: `Exposure ${decision.status} for ${tool.name}`,
    timestamp: record.updatedAt,
  });
  persist();
  return record;
}

export function requestPublicUrl(input: SystemsApiPublicUrlRequest): SystemsApiPublicUrl | null {
  const tool = getTool(input.toolId);
  if (!tool) return null;

  const requestedAddress = requestSystemsApiAddress({
    toolId: tool.id,
    kind: "website",
    subject: input.desiredHost?.replace(/^https?:\/\//, "") || tool.id,
    ...(input.desiredHost !== undefined ? { desiredHost: input.desiredHost } : {}),
  });
  if (!requestedAddress) return null;

  return getPublicUrl(tool.id);
}

export function listPublicUrls(): readonly SystemsApiPublicUrl[] {
  return registry.publicUrls;
}

export function getPublicUrl(toolId: string): SystemsApiPublicUrl | null {
  return registry.publicUrls.find((item) => item.toolId === toolId) ?? null;
}

export function listAddresses(): readonly SystemsApiAddress[] {
  return registry.addresses;
}

export function getAddress(toolId: string, kind?: SystemsApiAddressKind): SystemsApiAddress | null {
  return (
    registry.addresses.find(
      (item) => item.toolId === toolId && (kind === undefined || item.kind === kind),
    ) ?? null
  );
}

export function listExposures(): readonly SystemsApiExposureRecord[] {
  return registry.exposures;
}

export function getExposure(toolId: string): SystemsApiExposureRecord | null {
  return registry.exposures.find((item) => item.toolId === toolId) ?? null;
}

export function revokeSystemsApiExposure(toolId: string): SystemsApiExposureRecord | null {
  const exposure = getExposure(toolId);
  const tool = getTool(toolId);
  if (!exposure) return null;

  const revoked = revokeExposureRecord(exposure);
  upsertExposureRecord(revoked);

  const publicUrlIndex = registry.publicUrls.findIndex((item) => item.toolId === toolId);
  if (publicUrlIndex >= 0) {
    const existingPublicUrl = registry.publicUrls[publicUrlIndex];
    if (existingPublicUrl) {
      registry.publicUrls[publicUrlIndex] = {
        ...existingPublicUrl,
        status: "revoked",
      };
    }
  }

  for (const address of registry.addresses.filter((item) => item.toolId === toolId)) {
    const revokedAddress = revokeAddressRecord(address);
    upsertAddressRecord(revokedAddress);
    pushHistory(
      toolId,
      "address-revoked",
      `Revoked ${revokedAddress.kind} address ${revokedAddress.publicAddress}`,
      revokedAddress.revokedAt ?? revokedAddress.updatedAt,
    );
  }

  for (const domain of registry.domains.filter((item) => item.toolId === toolId)) {
    const revokedDomain = revokeDomainRecord(domain);
    upsertDomainRecord(revokedDomain);
    pushHistory(
      toolId,
      "domain-revoked",
      `Revoked ${revokedDomain.domain}`,
      revokedDomain.revokedAt ?? revokedDomain.updatedAt,
    );
  }

  updateToolRecord(toolId, (current) => ({
    ...current,
    exposed: false,
    exposure: "private",
    updatedAt: now(),
  }));

  pushHistory(
    toolId,
    "exposure-revoked",
    `Revoked exposure for ${tool?.name ?? toolId}`,
    revoked.revokedAt ?? revoked.updatedAt,
  );
  persist();
  return revoked;
}

export function listDomainBindings(): readonly SystemsApiDomainBinding[] {
  return registry.domains;
}

export function getDomainBinding(domain: string): SystemsApiDomainBinding | null {
  return registry.domains.find((item) => item.domain === domain) ?? null;
}

export function requestDomainBinding(
  input: SystemsApiDomainBindingRequest,
): SystemsApiDomainBinding | null {
  const publicUrl = getPublicUrl(input.toolId);
  if (!publicUrl || publicUrl.status !== "active") return null;
  const tool = getTool(input.toolId);
  const decision = guardianService.evaluateGuardianRequest({
    scope: "domain",
    tool,
    subjectId: `${input.toolId}:domain:${input.domain}`,
    desiredHost: input.domain,
  });
  guardianService.recordGuardianDecision({
    toolId: input.toolId,
    scope: "domain",
    subjectId: `${input.toolId}:domain:${input.domain}`,
    status: decision.status,
    reason: decision.reason,
    ...(decision.metadata !== undefined ? { metadata: decision.metadata } : {}),
  });

  const existing = getDomainBinding(input.domain);
  const binding = createDomainBinding(
    {
      toolId: input.toolId,
      domain: input.domain,
      ...(input.desiredHost !== undefined ? { desiredHost: input.desiredHost } : {}),
    },
    publicUrl.url,
    decision.status === "approved"
      ? (existing?.status ?? "pending")
      : decision.status === "quarantined"
        ? "quarantined"
        : "denied",
  );
  upsertDomainRecord(binding);
  pushHistory(
    input.toolId,
    "domain-bound",
    `Bound ${input.domain} to ${input.toolId}`,
    binding.requestedAt,
  );
  recordEvent({
    kind: "audit",
    level:
      decision.status === "approved" ? "info" : decision.status === "denied" ? "error" : "warn",
    source: "systems-api",
    subjectId: input.toolId,
    message: `Domain ${decision.status} for ${input.domain}`,
    timestamp: binding.updatedAt,
  });
  persist();
  return binding;
}

export function getDomainVerificationChallenge(
  domain: string,
): SystemsApiDomainVerificationChallenge | null {
  const binding = getDomainBinding(domain);
  if (!binding) return null;
  return buildDomainVerificationChallenge(binding);
}

export function verifyDomainBinding(domain: string, token: string): SystemsApiDomainBinding | null {
  const existing = getDomainBinding(domain);
  if (!existing) return null;
  const verified = verifyDomainRecord(existing, token);
  if (!verified) return null;
  upsertDomainRecord(verified);
  pushHistory(
    verified.toolId,
    "domain-verified",
    `Verified ${domain}`,
    verified.verifiedAt ?? verified.updatedAt,
  );
  persist();
  return verified;
}

export function revokeDomainBinding(domain: string): SystemsApiDomainBinding | null {
  const existing = getDomainBinding(domain);
  if (!existing) return null;
  const revoked = revokeDomainRecord(existing);
  upsertDomainRecord(revoked);
  pushHistory(
    revoked.toolId,
    "domain-revoked",
    `Revoked ${domain}`,
    revoked.revokedAt ?? revoked.updatedAt,
  );
  persist();
  return revoked;
}

export function describeStatus(): SystemsApiStatus {
  const mode = currentMode();
  const toolCount = registry.tools.length;
  const exposedToolCount = registry.tools.filter((tool) => tool.exposed).length;
  const healthyToolCount = registry.tools.filter((tool) => tool.health === "healthy").length;
  const activeExposureCount = registry.exposures.filter((item) => item.status === "active").length;
  const verifiedDomainCount = registry.domains.filter((item) => item.status === "verified").length;
  const claimedSecuredTools = registry.tools.filter(
    (tool) => tool.phantomSecurityProfile?.claimedSecured,
  );
  const integrationFailures = claimedSecuredTools.flatMap((tool) => {
    const profile = tool.phantomSecurityProfile;
    if (!profile) return [];
    const failures = evaluatePhantomCompliance(profile);
    if (!failures.length) return [];
    return [{ toolId: tool.id, reason: failures.join("; ") }];
  });
  const phantomSecuredCompliantCount = claimedSecuredTools.length - integrationFailures.length;
  const nodeTrust = summarizeTrustStates(state.nodes.map((node) => node.trustState));
  const peerTrust = summarizeTrustStates(state.peers.map((peer) => peer.trustState));

  return {
    version: "v1",
    mode,
    toolCount,
    exposedToolCount,
    healthyToolCount,
    publicUrlCount: registry.publicUrls.length,
    addressCount: registry.addresses.length,
    addressKinds: ["website", "email", "server", "custom"],
    activeExposureCount,
    domainCount: registry.domains.length,
    verifiedDomainCount,
    phantomSecuredClaimedCount: claimedSecuredTools.length,
    phantomSecuredCompliantCount,
    failedIntegrationCount: integrationFailures.length,
    integrationStatus: integrationFailures.length > 0 ? "failing" : "healthy",
    integrationFailures,
    trust: {
      nodes: nodeTrust,
      peers: peerTrust,
      updatedAt: now(),
    },
    registry: getSystemsApiRegistryMetadata(),
    updatedAt: now(),
  };
}

/**
 * Build the live proxy routing table: maps public-facing domains to backend upstreams.
 * Only includes tools that have registered an upstreamUrl.
 * Used by reverse proxies (Caddy / Nginx / Traefik) to route external traffic.
 *
 * Guardian enforcement: any route whose tool has a guardian decision of
 * "denied", "suspended", or "quarantined" is excluded, even if the underlying
 * resource record still shows status "active" / "verified". This ensures that
 * post-hoc guardian actions are immediately reflected in the routing table and
 * in TLS-ask responses without requiring a separate revocation call.
 */
export function listActiveRoutes(): readonly SystemsApiRoute[] {
  const BLOCKED: readonly string[] = ["denied", "suspended", "quarantined"];
  const routes: SystemsApiRoute[] = [];
  const seen = new Set<string>();

  for (const address of registry.addresses.filter((a) => a.status === "active")) {
    const guardianDecision = guardianService.getGuardianDecision(
      "exposure",
      `${address.toolId}:address:${address.kind}`,
    );
    if (guardianDecision && BLOCKED.includes(guardianDecision.status)) continue;
    const tool = registry.tools.find((t) => t.id === address.toolId);
    if (!tool?.upstreamUrl) continue;
    const domain = address.publicAddress.replace(/^https?:\/\//, "");
    const key = `${domain}:${address.toolId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({
      domain,
      upstream: tool.upstreamUrl,
      toolId: address.toolId,
      kind: "website",
      securityTag: phantomSecurityTag(tool.phantomSecurityProfile),
      phantomProtectionLevel: phantomProtectionLevel(tool.phantomSecurityProfile),
      requiresAuth: tool.requiresAuth === true,
      status: "active",
    });
  }

  for (const exposure of registry.exposures.filter((e) => e.status === "active")) {
    const guardianDecision = guardianService.getGuardianDecision(
      "exposure",
      `${exposure.toolId}:exposure`,
    );
    if (guardianDecision && BLOCKED.includes(guardianDecision.status)) continue;
    const tool = registry.tools.find((t) => t.id === exposure.toolId);
    if (!tool?.upstreamUrl) continue;
    const domain = exposure.publicUrl.replace(/^https?:\/\//, "");
    const key = `${domain}:${exposure.toolId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({
      domain,
      upstream: tool.upstreamUrl,
      toolId: exposure.toolId,
      kind: "exposure",
      securityTag: phantomSecurityTag(tool.phantomSecurityProfile),
      phantomProtectionLevel: phantomProtectionLevel(tool.phantomSecurityProfile),
      requiresAuth: tool.requiresAuth === true,
      status: "active",
    });
  }

  for (const binding of registry.domains.filter((d) => d.status === "verified")) {
    const guardianDecision = guardianService.getGuardianDecision(
      "domain",
      `${binding.toolId}:domain:${binding.domain}`,
    );
    if (guardianDecision && BLOCKED.includes(guardianDecision.status)) continue;
    const tool = registry.tools.find((t) => t.id === binding.toolId);
    if (!tool?.upstreamUrl) continue;
    const key = `${binding.domain}:${binding.toolId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({
      domain: binding.domain,
      upstream: tool.upstreamUrl,
      toolId: binding.toolId,
      kind: "custom-domain",
      securityTag: phantomSecurityTag(tool.phantomSecurityProfile),
      phantomProtectionLevel: phantomProtectionLevel(tool.phantomSecurityProfile),
      requiresAuth: tool.requiresAuth === true,
      status: "active",
    });
  }

  return routes;
}

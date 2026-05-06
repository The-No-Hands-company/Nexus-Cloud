import { mutateState, state, type GuardianDecision, type GuardianStatus } from "../state";
import { recordEvent, upsertHealthCheck } from "../observability";
import type { SystemsApiTool } from "../systems-api";

export type GuardianScope = "exposure" | "domain" | "runtime";

export type GuardianEvaluationInput = {
  scope: GuardianScope;
  tool: SystemsApiTool | null;
  subjectId: string;
  desiredHost?: string;
};

export type GuardianEvaluation = {
  status: Exclude<GuardianStatus, "revoked">;
  reason: string;
  metadata?: Record<string, string>;
};

function extractHostname(value: string): string | null {
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalOrPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.endsWith(".local")) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true;
  return false;
}

function hasTrustedPeerForHost(hostname: string): boolean {
  return state.peers.some((peer) => {
    if (peer.trustState !== "trusted") return false;
    const peerDomain = peer.domain.toLowerCase();
    if (peerDomain === hostname) return true;
    const trustHost = extractHostname(peer.trust.identity);
    return trustHost === hostname;
  });
}

function now(): string {
  return new Date().toISOString();
}

function createDecisionRecord(input: {
  toolId: string;
  scope: GuardianScope;
  subjectId: string;
  status: GuardianStatus;
  reason: string;
  actor?: "system" | "operator";
  metadata?: Record<string, string>;
}): GuardianDecision {
  const timestamp = now();
  return {
    id: `guardian_${crypto.randomUUID()}`,
    toolId: input.toolId,
    scope: input.scope,
    subjectId: input.subjectId,
    status: input.status,
    reason: input.reason,
    actor: input.actor ?? "system",
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: input.metadata,
  };
}

function upsertDecision(decision: GuardianDecision): GuardianDecision {
  mutateState((draft) => {
    const existingIndex = draft.guardianDecisions.findIndex((item) => item.scope === decision.scope && item.subjectId === decision.subjectId);
    if (existingIndex >= 0) {
      draft.guardianDecisions[existingIndex] = decision;
    } else {
      draft.guardianDecisions.push(decision);
    }
  });
  recordEvent({
    kind: "audit",
    level: decision.status === "approved" ? "info" : decision.status === "denied" ? "error" : "warn",
    source: "guardian",
    subjectId: decision.subjectId,
    message: `Guardian ${decision.status} ${decision.scope} for ${decision.toolId}: ${decision.reason}`,
    timestamp: decision.updatedAt,
    metadata: decision.metadata,
  });
  upsertHealthCheck({
    id: `guardian:${decision.subjectId}`,
    component: "guardian",
    subject: decision.subjectId,
    status: decision.status === "approved" ? "healthy" : decision.status === "denied" ? "offline" : "degraded",
    summary: `${decision.scope} ${decision.status}`,
    checkedAt: decision.updatedAt,
    details: { toolId: decision.toolId, reason: decision.reason },
  });
  return decision;
}

export function listGuardianDecisions(): readonly GuardianDecision[] {
  return state.guardianDecisions;
}

export function getGuardianDecision(scope: GuardianScope, subjectId: string): GuardianDecision | null {
  return state.guardianDecisions.find((item) => item.scope === scope && item.subjectId === subjectId) ?? null;
}

export function evaluateGuardianRequest(input: GuardianEvaluationInput): GuardianEvaluation {
  if (!input.tool) {
    return { status: "denied", reason: "Tool not found" };
  }
  if ((input.scope === "exposure" || input.scope === "domain") && input.tool.registrationStatus === "offline") {
    return {
      status: "denied",
      reason: "Tool registration is offline",
      metadata: { registrationStatus: input.tool.registrationStatus },
    };
  }
  if (!input.tool.upstreamUrl?.trim()) {
    return { status: "quarantined", reason: "Tool has no upstream URL", metadata: { upstream: "missing" } };
  }

  const upstreamHost = extractHostname(input.tool.upstreamUrl);
  if (!upstreamHost) {
    return { status: "quarantined", reason: "Tool upstream URL hostname is invalid", metadata: { upstreamUrl: input.tool.upstreamUrl } };
  }
  if (!isLocalOrPrivateHost(upstreamHost) && !hasTrustedPeerForHost(upstreamHost)) {
    return {
      status: "quarantined",
      reason: "No trusted federation peer matches tool upstream host",
      metadata: { upstreamHost, trust: "missing" },
    };
  }

  if (input.tool.health === "offline") {
    return { status: "denied", reason: "Tool is offline", metadata: { health: input.tool.health } };
  }
  if (input.tool.health === "degraded") {
    return { status: "quarantined", reason: "Tool is degraded and requires review", metadata: { health: input.tool.health } };
  }
  if (input.desiredHost && /(^localhost$|\.localhost$|\s)/i.test(input.desiredHost)) {
    return { status: "quarantined", reason: "Desired host is not valid for public admission", metadata: { desiredHost: input.desiredHost } };
  }
  return { status: "approved", reason: "Policy checks passed" };
}

export function recordGuardianDecision(input: {
  toolId: string;
  scope: GuardianScope;
  subjectId: string;
  status: GuardianStatus;
  reason: string;
  actor?: "system" | "operator";
  metadata?: Record<string, string>;
}): GuardianDecision {
  return upsertDecision(createDecisionRecord(input));
}

export function approveGuardianDecision(scope: GuardianScope, subjectId: string, reason = "Approved by operator"): GuardianDecision | null {
  const existing = getGuardianDecision(scope, subjectId);
  if (!existing) return null;
  return upsertDecision({ ...existing, status: "approved", reason, actor: "operator", updatedAt: now() });
}

export function denyGuardianDecision(scope: GuardianScope, subjectId: string, reason = "Denied by operator"): GuardianDecision | null {
  const existing = getGuardianDecision(scope, subjectId);
  if (!existing) return null;
  return upsertDecision({ ...existing, status: "denied", reason, actor: "operator", updatedAt: now() });
}

export function suspendGuardianDecision(scope: GuardianScope, subjectId: string, reason = "Suspended by operator"): GuardianDecision | null {
  const existing = getGuardianDecision(scope, subjectId);
  if (!existing) return null;
  return upsertDecision({ ...existing, status: "suspended", reason, actor: "operator", updatedAt: now() });
}

export function quarantineGuardianDecision(scope: GuardianScope, subjectId: string, reason = "Quarantined by operator"): GuardianDecision | null {
  const existing = getGuardianDecision(scope, subjectId);
  if (!existing) return null;
  return upsertDecision({ ...existing, status: "quarantined", reason, actor: "operator", updatedAt: now() });
}

export const guardianService = {
  approveGuardianDecision,
  denyGuardianDecision,
  evaluateGuardianRequest,
  getGuardianDecision,
  listGuardianDecisions,
  quarantineGuardianDecision,
  recordGuardianDecision,
  suspendGuardianDecision,
};
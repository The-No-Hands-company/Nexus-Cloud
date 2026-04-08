import type { SystemsApiExposureRecord, SystemsApiExposureStatus } from "./types";

export type SystemsApiExposureRequestInput = {
  toolId: string;
  desiredHost?: string;
};

export function buildPublicUrl(toolId: string, desiredHost?: string): string {
  const host = desiredHost?.trim() || `${toolId}.nexus.local`;
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}

export function buildCanonicalUrl(toolId: string): string {
  return `https://${toolId}.nexus.local`;
}

export function createExposureRecord(input: SystemsApiExposureRequestInput, publicUrl: string, status: SystemsApiExposureStatus = "requested", at = new Date().toISOString()): SystemsApiExposureRecord {
  return {
    id: `exp_${crypto.randomUUID()}`,
    toolId: input.toolId,
    canonicalUrl: buildCanonicalUrl(input.toolId),
    publicUrl,
    desiredHost: input.desiredHost,
    status,
    requestedAt: at,
    activatedAt: status === "active" ? at : undefined,
    revokedAt: status === "revoked" ? at : undefined,
    updatedAt: at,
  };
}

export function transitionExposureRecord(record: SystemsApiExposureRecord, status: SystemsApiExposureStatus, publicUrl = record.publicUrl, at = new Date().toISOString()): SystemsApiExposureRecord {
  return {
    ...record,
    publicUrl,
    status,
    activatedAt: status === "active" ? record.activatedAt ?? at : record.activatedAt,
    revokedAt: status === "revoked" ? at : record.revokedAt,
    updatedAt: at,
  };
}

export function revokeExposureRecord(record: SystemsApiExposureRecord, at = new Date().toISOString()): SystemsApiExposureRecord {
  return transitionExposureRecord(record, "revoked", record.publicUrl, at);
}

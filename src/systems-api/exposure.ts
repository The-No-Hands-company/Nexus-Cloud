import { cloudConfig } from "../config";
import type { SystemsApiExposureRecord, SystemsApiExposureStatus } from "./types";

export type SystemsApiExposureRequestInput = {
  toolId: string;
  desiredHost?: string;
};

export function buildPublicUrl(toolId: string, desiredHost?: string): string {
  const host = desiredHost?.trim() || `${toolId}.${cloudConfig.cloudDomain}`;
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}

export function buildCanonicalUrl(toolId: string): string {
  return `https://${toolId}.${cloudConfig.cloudDomain}`;
}

export function createExposureRecord(
  input: SystemsApiExposureRequestInput,
  publicUrl: string,
  status: SystemsApiExposureStatus = "requested",
  at = new Date().toISOString(),
): SystemsApiExposureRecord {
  return {
    id: `exp_${crypto.randomUUID()}`,
    toolId: input.toolId,
    canonicalUrl: buildCanonicalUrl(input.toolId),
    publicUrl,
    ...(input.desiredHost !== undefined ? { desiredHost: input.desiredHost } : {}),
    status,
    requestedAt: at,
    ...(status === "active" ? { activatedAt: at } : {}),
    ...(status === "revoked" ? { revokedAt: at } : {}),
    updatedAt: at,
  };
}

export function transitionExposureRecord(
  record: SystemsApiExposureRecord,
  status: SystemsApiExposureStatus,
  publicUrl = record.publicUrl,
  at = new Date().toISOString(),
): SystemsApiExposureRecord {
  const activatedAt = status === "active" ? (record.activatedAt ?? at) : record.activatedAt;
  const revokedAt = status === "revoked" ? at : record.revokedAt;
  return {
    ...record,
    publicUrl,
    status,
    ...(activatedAt !== undefined ? { activatedAt } : {}),
    ...(revokedAt !== undefined ? { revokedAt } : {}),
    updatedAt: at,
  };
}

export function revokeExposureRecord(
  record: SystemsApiExposureRecord,
  at = new Date().toISOString(),
): SystemsApiExposureRecord {
  return transitionExposureRecord(record, "revoked", record.publicUrl, at);
}

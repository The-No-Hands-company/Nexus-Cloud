import { cloudConfig } from "../config";
import type { SystemsApiAddress, SystemsApiAddressKind, SystemsApiAddressStatus } from "./types";

export type SystemsApiAddressRequest = {
  toolId: string;
  kind: SystemsApiAddressKind;
  subject?: string;
  desiredHost?: string;
};

function normalizeSubject(subject: string | undefined, fallback: string): string {
  const value = subject?.trim() || fallback;
  return value.toLowerCase();
}

export function buildCanonicalTarget(toolId: string): string {
  return `https://${toolId}.${cloudConfig.cloudDomain}`;
}

export function buildPublicAddress(input: SystemsApiAddressRequest): string {
  const subject = normalizeSubject(input.subject, input.toolId);
  const domain = cloudConfig.cloudDomain;
  if (input.kind === "website") {
    const host = input.desiredHost?.trim() || `${subject}.${domain}`;
    return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
  }
  if (input.kind === "email") {
    return `${subject}@${domain}`;
  }
  if (input.kind === "server") {
    const host = input.desiredHost?.trim() || `${subject}.${domain}`;
    return host.startsWith("http://") || host.startsWith("https://") ? host : host;
  }
  const host = input.desiredHost?.trim() || `${subject}.${domain}`;
  return `nexus://${host.replace(/^https?:\/\//, "")}`;
}

export function createAddressRecord(input: SystemsApiAddressRequest, publicAddress: string, status: SystemsApiAddressStatus = "requested", at = new Date().toISOString()): SystemsApiAddress {
  return {
    id: `addr_${crypto.randomUUID()}`,
    toolId: input.toolId,
    kind: input.kind,
    subject: normalizeSubject(input.subject, input.toolId),
    canonicalTarget: buildCanonicalTarget(input.toolId),
    publicAddress,
    desiredHost: input.desiredHost,
    status,
    requestedAt: at,
    activatedAt: status === "active" ? at : undefined,
    revokedAt: status === "revoked" ? at : undefined,
    updatedAt: at,
  };
}

export function transitionAddressRecord(record: SystemsApiAddress, status: SystemsApiAddressStatus, publicAddress = record.publicAddress, at = new Date().toISOString()): SystemsApiAddress {
  return {
    ...record,
    publicAddress,
    status,
    activatedAt: status === "active" ? record.activatedAt ?? at : record.activatedAt,
    revokedAt: status === "revoked" ? at : record.revokedAt,
    updatedAt: at,
  };
}

export function revokeAddressRecord(record: SystemsApiAddress, at = new Date().toISOString()): SystemsApiAddress {
  return transitionAddressRecord(record, "revoked", record.publicAddress, at);
}

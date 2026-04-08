import type { SystemsApiDomainBinding, SystemsApiDomainBindingStatus, SystemsApiDomainVerificationChallenge } from "./types";
import { buildCanonicalUrl } from "./exposure";

export type SystemsApiDomainBindingInput = {
  toolId: string;
  domain: string;
  desiredHost?: string;
};

export type SystemsApiDomainVerificationInput = {
  domain: string;
  token: string;
};

export function buildVerificationToken(domain: string, toolId: string): string {
  const normalizedDomain = domain.replace(/[^a-zA-Z0-9]/g, "_");
  return `verify_${toolId}_${normalizedDomain}_${crypto.randomUUID().slice(0, 8)}`;
}

export function createDomainBinding(input: SystemsApiDomainBindingInput, publicUrl: string, status: SystemsApiDomainBindingStatus = "pending", at = new Date().toISOString()): SystemsApiDomainBinding {
  const token = buildVerificationToken(input.domain, input.toolId);
  return {
    domain: input.domain,
    toolId: input.toolId,
    canonicalUrl: buildCanonicalUrl(input.toolId),
    publicUrl,
    verificationToken: token,
    verificationIssuedAt: at,
    verificationExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    status,
    requestedAt: at,
    verifiedAt: status === "verified" ? at : undefined,
    revokedAt: status === "revoked" ? at : undefined,
    updatedAt: at,
  };
}

export function issueDomainVerificationChallenge(binding: SystemsApiDomainBinding): SystemsApiDomainVerificationChallenge {
  return {
    domain: binding.domain,
    token: binding.verificationToken,
    issuedAt: binding.verificationIssuedAt,
    expiresAt: binding.verificationExpiresAt,
    status: binding.status === "verified" ? "verified" : binding.status === "revoked" ? "revoked" : new Date(binding.verificationExpiresAt).getTime() < Date.now() ? "expired" : "pending",
  };
}

export function verifyDomainBinding(binding: SystemsApiDomainBinding, token: string, at = new Date().toISOString()): SystemsApiDomainBinding | null {
  if (binding.verificationToken !== token) {
    return null;
  }

  return {
    ...binding,
    status: "verified",
    verifiedAt: at,
    updatedAt: at,
  };
}

export function revokeDomainBinding(binding: SystemsApiDomainBinding, at = new Date().toISOString()): SystemsApiDomainBinding {
  return {
    ...binding,
    status: "revoked",
    revokedAt: at,
    updatedAt: at,
  };
}

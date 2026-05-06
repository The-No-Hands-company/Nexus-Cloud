import type { FederationTrust } from "../architecture";
import { mutateState } from "../state";
import type { FederationPeer, FederationSignedRequest } from "./index";

function peerTrustTtlHours(): number {
  const raw = Number(process.env.NEXUS_CLOUD_PEER_TRUST_TTL_HOURS ?? "168");
  return Number.isFinite(raw) ? Math.max(1, raw) : 168;
}

function trustExpiryDate(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function createPeerTrust(domain: string, trust?: FederationSignedRequest | Record<string, unknown>): FederationTrust {
  return {
    identity: domain,
    issuer: readString(trust && "keyId" in trust ? trust.keyId : undefined, domain),
    audience: "nexus-cloud",
    publicKeyHint: readString(trust && "signature" in trust ? trust.signature : undefined, "manual").slice(0, 16),
    signatureScheme: "ed25519",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
}

export function upsertPeer(
  peers: FederationPeer[],
  domain: string,
  trust?: FederationSignedRequest | Record<string, unknown>,
  did?: string,
): FederationPeer {
  const now = new Date().toISOString();
  const hasSignedTrust = Boolean(trust && typeof trust === "object" && "signature" in trust && "keyId" in trust);
  const trustState = hasSignedTrust ? "trusted" : "pending";
  const peer: FederationPeer = {
    domain,
    did,
    trust: createPeerTrust(domain, trust),
    trustState,
    trustUpdatedAt: now,
    trustExpiresAt: trustExpiryDate(peerTrustTtlHours()),
    status: hasSignedTrust ? "healthy" : "unknown",
    lastSeenAt: now,
    version: "0.1.0",
  };

  mutateState(() => {
    const existingIndex = peers.findIndex((item) => item.domain === domain);
    if (existingIndex >= 0) {
      peers[existingIndex] = peer;
    } else {
      peers.push(peer);
    }
  });

  return peer;
}

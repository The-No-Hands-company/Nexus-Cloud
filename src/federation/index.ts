import type { FederationTrust } from "../architecture";

export type FederationPeerStatus = "unknown" | "healthy" | "degraded" | "blocked";

export type FederationPeerTrustState = "pending" | "verified" | "trusted" | "quarantined" | "revoked" | "expired";

export type FederationPeer = {
  domain: string;
  trust: FederationTrust;
  trustState: FederationPeerTrustState;
  trustUpdatedAt?: string;
  trustExpiresAt?: string;
  status: FederationPeerStatus;
  lastSeenAt?: string;
  version?: string;
};

export type FederationSignedRequest = {
  method: string;
  path: string;
  host: string;
  timestamp: string;
  nonce: string;
  keyId: string;
  signature: string;
};

export const federation = {
  protocol: "nexus-federation-v1",
  signedRequests: true,
  identityFormat: "node@cluster",
};

export * from "./peers";
export * from "./service";

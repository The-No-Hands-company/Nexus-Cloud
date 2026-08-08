import type { FederationTrust } from "../architecture";

export type FederationPeerStatus = "unknown" | "healthy" | "degraded" | "blocked";

export type FederationPeerTrustState =
  | "pending"
  | "verified"
  | "trusted"
  | "quarantined"
  | "revoked"
  | "expired";

export type FederationPeer = {
  domain: string;
  /** Node's permanent DID (`did:nexus:...`), used for federation addressing and identity trust. */
  did?: string;
  trust: FederationTrust;
  trustState: FederationPeerTrustState;
  trustUpdatedAt?: string;
  trustExpiresAt?: string;
  status: FederationPeerStatus;
  lastSeenAt?: string;
  version?: string;
  /** Storage pools this peer is sharing */
  storagePools?: SharedStoragePoolSummary[];
};

export type SharedStoragePoolSummary = {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  totalCapacityGb: number;
  availableCapacityGb: number;
  status: "active" | "draining" | "offline";
  replicationFactor: number;
  tags: string[];
  ownerNodeId: string;
  ownerNodeDid: string;
  lastHeartbeatAt?: string;
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

export * from "./gossip";
export * from "./peers";
export * from "./service";

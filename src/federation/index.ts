import type { FederationTrust } from "../architecture";

export type FederationPeerStatus = "unknown" | "healthy" | "degraded" | "blocked";

export type FederationPeer = {
  domain: string;
  /**
   * Permanent cryptographic identity of this peer.
   * Format: did:nexus:z<base58btc-ed25519-pubkey>
   * Stable across IP changes, domain renames, or network migrations.
   */
  did?: string;
  trust: FederationTrust;
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
  /**
   * NS address format: @user:shortId
   * shortId is the first 8 chars of the base58btc-encoded Ed25519 pubkey.
   * No domain required. No registrar. No cost.
   */
  identityFormat: "@user:shortId",
};

export * from "./peers";
export * from "./service";
export * from "./naming";

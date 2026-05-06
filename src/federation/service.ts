import type { FederationTrust } from "../architecture";
import { getNodeIdentity } from "../identity";
import { mutateState, state } from "../state";
import type { FederationPeer, FederationSignedRequest } from "./index";
import { upsertPeer as persistPeer } from "./peers";

export type FederationSummary = {
  protocol: string;
  signedRequests: boolean;
  identityFormat: string;
  peerCount: number;
  /** This node's permanent DID — set after initNodeIdentity() resolves on startup. */
  nodeId?: string;
  /** Human-compact 8-char short ID derived from the DID — used in @user:shortId addresses. */
  shortId?: string;
};

export type PeerTrustSummary = {
  total: number;
  pending: number;
  verified: number;
  trusted: number;
  quarantined: number;
  revoked: number;
  expired: number;
};

export type FederatedActionDecision = {
  allowed: boolean;
  reasonCode: "FEDERATION_PEER_UNREGISTERED" | "FEDERATION_PEER_TRUST_INSUFFICIENT" | "FEDERATION_OK";
  reason: string;
  requiredTrust: "verified" | "trusted";
  peerTrustState?: FederationPeer["trustState"];
};

function requiredFederationTrustLevel(): "verified" | "trusted" {
  const value = (process.env.NEXUS_CLOUD_FEDERATION_MIN_TRUST ?? "trusted").trim().toLowerCase();
  return value === "verified" ? "verified" : "trusted";
}

function normalizePeerIdentityHost(identity: string): string {
  const trimmed = identity.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].toLowerCase();
  }
}

export function describeFederation(): FederationSummary {
  let nodeId: string | undefined;
  let shortId: string | undefined;
  try {
    const id = getNodeIdentity();
    nodeId = id.did;
    shortId = id.shortId;
  } catch {
    // identity not yet initialized — safe to ignore, returns undefined fields
  }
  return {
    protocol: "nexus-federation-v1",
    signedRequests: true,
    identityFormat: "@user:shortId",
    peerCount: state.peers.length,
    nodeId,
    shortId,
  };
}

export function listPeers(): FederationPeer[] {
  return state.peers;
}

export function trustPeer(domain: string, trust?: FederationSignedRequest | Record<string, unknown>): FederationPeer {
  return persistPeer(state.peers, domain, trust);
}

export function listTrustedPeers(): FederationPeer[] {
  return state.peers.filter((peer) => peer.trustState === "trusted");
}

export function authorizeFederatedPeerAction(upstreamUrl: string): FederatedActionDecision {
  const requiredTrust = requiredFederationTrustLevel();
  const incomingHost = normalizePeerIdentityHost(upstreamUrl);
  const peer = state.peers.find((item) => normalizePeerIdentityHost(item.trust.identity) === incomingHost || item.domain.toLowerCase() === incomingHost);
  if (!peer) {
    return {
      allowed: false,
      reasonCode: "FEDERATION_PEER_UNREGISTERED",
      reason: "Federated action denied: peer is not registered",
      requiredTrust,
    };
  }

  const allowed = requiredTrust === "verified"
    ? peer.trustState === "verified" || peer.trustState === "trusted"
    : peer.trustState === "trusted";
  if (!allowed) {
    return {
      allowed: false,
      reasonCode: "FEDERATION_PEER_TRUST_INSUFFICIENT",
      reason: `Federated action denied: peer trust state is ${peer.trustState}, requires at least ${requiredTrust}`,
      requiredTrust,
      peerTrustState: peer.trustState,
    };
  }

  return {
    allowed: true,
    reasonCode: "FEDERATION_OK",
    reason: "Peer trust requirement satisfied",
    requiredTrust,
    peerTrustState: peer.trustState,
  };
}

export function describePeerTrustSummary(): PeerTrustSummary {
  const trustStates = state.peers.map((peer) => peer.trustState);
  return {
    total: trustStates.length,
    pending: trustStates.filter((trustState) => trustState === "pending").length,
    verified: trustStates.filter((trustState) => trustState === "verified").length,
    trusted: trustStates.filter((trustState) => trustState === "trusted").length,
    quarantined: trustStates.filter((trustState) => trustState === "quarantined").length,
    revoked: trustStates.filter((trustState) => trustState === "revoked").length,
    expired: trustStates.filter((trustState) => trustState === "expired").length,
  };
}

export function applyPeerTrustExpiry(nowAt = new Date()): number {
  const nowIso = nowAt.toISOString();
  let expired = 0;

  mutateState((draft) => {
    for (const peer of draft.peers) {
      const expiresAt = peer.trustExpiresAt ?? peer.trust.expiresAt;
      if (!expiresAt) continue;
      if (peer.trustState === "revoked" || peer.trustState === "expired") continue;
      const expiresMs = Date.parse(expiresAt);
      if (Number.isNaN(expiresMs)) continue;
      if (expiresMs > nowAt.getTime()) continue;

      peer.trustState = "expired";
      peer.trustUpdatedAt = nowIso;
      peer.status = peer.status === "blocked" ? "blocked" : "degraded";
      expired += 1;
    }
  });

  return expired;
}

export const federationService = {
  applyPeerTrustExpiry,
  authorizeFederatedPeerAction,
  describePeerTrustSummary,
  describeFederation,
  listPeers,
  listTrustedPeers,
  trustPeer,
};

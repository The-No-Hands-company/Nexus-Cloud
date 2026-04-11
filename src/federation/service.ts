import type { FederationTrust } from "../architecture";
import { getNodeIdentity } from "../identity";
import { state } from "../state";
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

export const federationService = {
  describeFederation,
  listPeers,
  trustPeer,
};

/**
 * HTTP Gossip Peer Discovery
 * ===========================
 *
 * libp2p is the gold standard for P2P peer discovery, but it is a large dependency
 * tree (50+ packages). Nexus Cloud has zero runtime dependencies by design.
 *
 * This module implements the same CORE mechanism libp2p bootstrap nodes use:
 *
 *   1. Read a list of known "bootstrap peers" from BOOTSTRAP_PEERS env var.
 *   2. Contact each one: announce ourselves + collect their known peers.
 *   3. Re-announce to each newly discovered peer (one hop only — prevents loops).
 *   4. Persist the peer list to data/federation-peers.json so restarts are fast.
 *
 * Announcement exchange (POST /v1/federation/peers/announce):
 *   Request:  { did, shortId, upstreamUrl }
 *   Response: { peers: [{ did, shortId, upstreamUrl }, ...] }
 *
 * This is deliberately simple — no DHT, no NAT traversal, no cryptographic routing.
 * When the NS federation matures, libp2p can be layered on top of this scaffolding
 * without breaking existing nodes.
 *
 * To plug in libp2p later:
 *   - Replace bootstrapPeers() with a libp2p node that seeds the kademlia DHT.
 *   - Keep handleInboundAnnouncement() as a compatibility shim for HTTP-only nodes.
 */

import { cloudConfig } from "../config";
import { getNodeIdentity } from "../identity";
import { mutateState, state } from "../state";
import { listPools } from "../storage";
import type { SharedStoragePoolSummary } from "./index";
import { upsertPeer } from "./peers";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GossipAnnouncement = {
  /** Full did:nexus: DID of the announcing node */
  did: string;
  /** 8-char short form — first chars of the base58 pubkey */
  shortId: string;
  /** Publicly reachable URL of the announcing node */
  upstreamUrl: string;
  /** Optional: semver of the Nexus Cloud instance */
  version?: string;
  /** Optional: storage pools this node is sharing */
  storagePools?: SharedStoragePoolSummary[];
};

export type GossipPeerList = {
  peers: GossipAnnouncement[];
};

function loadPersistedPeers(): void {
  for (const p of state.peers) {
    if (p.did && p.trust.identity) {
      upsertPeer(state.peers, p.trust.identity, undefined, p.did);
    }
  }
}

function persistPeers(): void {
  // Durable platform state persistence is handled centrally by state.ts.
}

// ─── Self announcement ────────────────────────────────────────────────────────

export function selfAnnouncement(): GossipAnnouncement {
  const id = getNodeIdentity();
  const upstreamUrl = cloudConfig.cloudUrl || `http://localhost:${process.env["PORT"] ?? "8787"}`;
  const pools = listPools();
  const poolSummaries: SharedStoragePoolSummary[] = pools
    .filter((p) => p.status === "active")
    .map(
      (p): SharedStoragePoolSummary => ({
        id: p.id,
        name: p.name,
        endpoint: p.endpoint,
        region: p.region,
        totalCapacityGb: p.totalCapacityGb,
        availableCapacityGb: p.availableCapacityGb,
        status: p.status,
        replicationFactor: p.replicationFactor,
        tags: p.tags,
        ownerNodeId: p.ownerNodeId,
        ownerNodeDid: p.ownerNodeDid,
        ...(p.lastHeartbeatAt ? { lastHeartbeatAt: p.lastHeartbeatAt } : {}),
      }),
    );
  return { did: id.did, shortId: id.shortId, upstreamUrl, storagePools: poolSummaries };
}

// ─── Inbound handling ─────────────────────────────────────────────────────────

/**
 * Accept an announcement from another node and return our own known peers.
 * This is the handler for POST /v1/federation/peers/announce.
 */
export function handleInboundAnnouncement(ann: GossipAnnouncement): GossipPeerList {
  const selfDid = getNodeIdentity().did;
  // Don't add ourselves as a peer
  if (ann.did && ann.upstreamUrl && ann.did !== selfDid) {
    upsertPeer(state.peers, ann.upstreamUrl, undefined, ann.did);
    // Store storage pools on the peer
    if (ann.storagePools && ann.storagePools.length > 0) {
      const pools = ann.storagePools;
      mutateState((draft) => {
        const peer = draft.peers.find((p) => p.did === ann.did);
        if (peer) {
          peer.storagePools = pools;
        }
      });
    }
    persistPeers();
  }

  return {
    peers: state.peers
      .filter((p) => p.did && p.trust.identity && p.did !== selfDid)
      .map((p) => {
        const did = p.did as string;
        return {
          did,
          shortId: did.split(":")[2]?.slice(1, 9) ?? "",
          upstreamUrl: p.trust.identity,
          ...(p.storagePools ? { storagePools: p.storagePools } : {}),
        };
      }),
  };
}

// ─── Bootstrap peer auto-trust ──────────────────────────────────────────────────

/**
 * Register a bootstrap peer announcement with "verified" trust immediately,
 * skipping the normal trust check. Bootstrap peers are explicitly listed by
 * the operator in BOOTSTRAP_PEERS, so they are pre-trusted.
 */
export function handleInboundBootstrapAnnouncement(ann: GossipAnnouncement): GossipPeerList {
  const selfDid = getNodeIdentity().did;
  if (ann.did && ann.upstreamUrl && ann.did !== selfDid) {
    upsertPeer(state.peers, ann.upstreamUrl, undefined, ann.did);
    mutateState((draft) => {
      const peer = draft.peers.find((p) => p.trust.identity === ann.upstreamUrl);
      if (peer && peer.trustState === "pending") {
        peer.trustState = "verified";
        peer.status = "healthy";
        peer.trustUpdatedAt = new Date().toISOString();
      }
    });
    persistPeers();
  }

  return {
    peers: state.peers
      .filter((p) => p.did && p.trust.identity && p.did !== selfDid)
      .map((p) => {
        const did = p.did as string;
        return {
          did,
          shortId: did.split(":")[2]?.slice(1, 9) ?? "",
          upstreamUrl: p.trust.identity,
        };
      }),
  };
}

// ─── Outbound / bootstrap ─────────────────────────────────────────────────────

async function contactPeer(peerUrl: string): Promise<void> {
  const base = peerUrl.replace(/\/$/, "");
  const ann = selfAnnouncement();

  try {
    const res = await fetch(`${base}/v1/federation/peers/announce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ann),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return;

    const data = (await res.json()) as GossipPeerList;
    const selfDid = getNodeIdentity().did;

    for (const p of data.peers ?? []) {
      if (p.did && p.upstreamUrl && p.did !== selfDid) {
        upsertPeer(state.peers, p.upstreamUrl, undefined, p.did);
      }
    }

    persistPeers();
  } catch {
    // peer unreachable — non-fatal, try again next cycle
  }
}

/**
 * Called once on startup.
 * Loads persisted peers from disk, then contacts bootstrap peers from
 * BOOTSTRAP_PEERS env var (comma-separated URLs) to exchange peer lists.
 */
export async function bootstrapPeers(): Promise<void> {
  loadPersistedPeers();

  const raw = process.env["BOOTSTRAP_PEERS"] ?? "";
  const urls = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (urls.length === 0) return;

  await Promise.allSettled(urls.map(contactPeer));
}

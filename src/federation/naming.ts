/**
 * NS Address Format — the "human-readable names" layer
 * =====================================================
 *
 * The internet name problem: any globally unique, human-readable name system
 * eventually centralises around a trusted party that can prevent squatting.
 * ICANN uses money. ENS uses blockchain fees. Handshake uses coin auctions.
 * Even "free" PoW systems (Namecoin model) charge CPU time and create a mining race.
 *
 * NS sidesteps the problem entirely using the Matrix / ActivityPub "server-scoped" model:
 *
 *   KEY INSIGHT: every NS node is its own registrar.
 *
 *   @alice:z6Mkf5rG means "the user 'alice' on the node with short ID z6Mkf5rG."
 *   Only the holder of the Ed25519 private key that produced z6Mkf5rG can issue
 *   credentials in that namespace — cryptographic ownership, not DNS ownership.
 *   Two "alice"s on two different nodes are two different identities. By design.
 *   Great — just like real life. Alice Smith and Alice Jones both exist.
 *
 * Address formats
 * ───────────────
 *   Full DID:        did:nexus:z6Mkf5rGMoatrSj1f9DuUe6BCbrn9sg8YSxDqCHHxJvEynEt
 *   Short node ID:   z6Mkf5rG  (first 8 chars of base58 portion, ~47 bits entropy)
 *   User address:    @alice:z6Mkf5rG
 *   Resource path:   @alice:z6Mkf5rG/chat
 *   Legacy bridge:   alice@nexus.cloud  →  @alice:z6Mkf5rG  (routing table maps both)
 *
 * Petnames (local only)
 * ─────────────────────
 *   Users can save a "contact" in their Nexus dashboard:
 *     "My Home Server" → did:nexus:z6Mkf5rGMoatrSj1f9DuUe6BCbrn9sg8YSxDqCHHxJvEynEt
 *   Petnames are private, per-device, never need consensus, never broadcast.
 *   This is how humans already handle contacts: your phone says "Mum", not "+44..."
 *
 * No squatting is possible because:
 *   - The node namepsace IS the cryptographic key fingerprint.
 *   - Claiming @alice:z6Mkf5rG requires controlling the z6Mkf5rG node's private key.
 *   - Generating a billion key pairs is "free" but gives you a billion different
 *     server IDs, none of which is the one you wanted to squart.
 *
 * Global consensus names (if ever needed)
 * ────────────────────────────────────────
 *   If a future NS product requires a globally unique, human-readable, collision-
 *   resistant name without monetary cost, the options in ascending complexity are:
 *     A. Local petnames only  — each user labels contacts locally (current NS approach)
 *     B. Federated vouching   — a name is valid if N trusted peers co-sign the claim
 *     C. PoW name claim       — CPU cost instead of money (Namecoin model, 10 min solve)
 *   NS currently uses (A). (B) can be layered on when federation matures.
 */

export type NsAddress = {
  /** Local username within the server — e.g. "alice" */
  user: string;
  /** Node short ID — first 8 chars of the base58 portion of the DID — e.g. "z6Mkf5rG" */
  serverId: string;
  /** Canonical string form: "@alice:z6Mkf5rG" */
  canonical: string;
};

/**
 * Build a canonical NS address.
 * @example buildNsAddress("alice", "z6Mkf5rG") → { canonical: "@alice:z6Mkf5rG", ... }
 */
export function buildNsAddress(user: string, serverId: string): NsAddress {
  return { user, serverId, canonical: `@${user}:${serverId}` };
}

/**
 * Parse a canonical NS address into its parts.
 * Accepts both "@alice:z6Mkf5rG" (primary) and "alice@z6Mkf5rG" (ActivityPub-style).
 * Returns null if the string is not a valid NS address.
 */
export function parseNsAddress(raw: string): NsAddress | null {
  const trimmed = raw.trim();

  // Primary form: "@alice:z6Mkf5rG"
  const atColon = /^@([^:@\s]+):([A-Za-z0-9]+)$/.exec(trimmed);
  if (atColon) return buildNsAddress(atColon[1]!, atColon[2]!);

  // ActivityPub-compatible fallback: "alice@z6Mkf5rG"
  const atAt = /^([^@:\s]+)@([A-Za-z0-9]+)$/.exec(trimmed);
  if (atAt) return buildNsAddress(atAt[1]!, atAt[2]!);

  return null;
}

/**
 * Build the canonical NS address for a user on this node.
 * @param user — local username, e.g. "alice"
 * @param shortId — this node's short ID, from getNodeIdentity().shortId
 */
export function ownAddress(user: string, shortId: string): string {
  return buildNsAddress(user, shortId).canonical;
}

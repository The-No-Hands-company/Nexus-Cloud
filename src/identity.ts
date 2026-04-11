import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";

// ─── Base58BTC ───────────────────────────────────────────────────────────────
// Bitcoin's Base58 alphabet — no 0, O, I, l to avoid visual confusion.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);

  let result = "";
  while (n > 0n) {
    result = B58[Number(n % 58n)] + result;
    n /= 58n;
  }

  // Leading zero bytes → leading "1"s (Base58 convention)
  for (const b of bytes) {
    if (b !== 0) break;
    result = "1" + result;
  }

  return result;
}

// ─── DID derivation ──────────────────────────────────────────────────────────
// did:nexus uses the same encoding as did:key (W3C spec):
//   multicodec prefix [0xed, 0x01] (Ed25519 pub key type) + raw 32-byte pubkey
//   encoded as multibase base58btc with a leading "z" character.
//
// This means a did:nexus identifier is self-describing and verifiable by any
// implementation that understands the did:key encoding — no registrar needed.

const MULTICODEC_ED25519_PUB = new Uint8Array([0xed, 0x01]);

function rawPubkeyToDid(pubkeyBytes: Uint8Array): string {
  const prefixed = new Uint8Array(MULTICODEC_ED25519_PUB.length + pubkeyBytes.length);
  prefixed.set(MULTICODEC_ED25519_PUB);
  prefixed.set(pubkeyBytes, MULTICODEC_ED25519_PUB.length);
  return "did:nexus:z" + base58Encode(prefixed);
}

function rawPubkeyToShortId(pubkeyBytes: Uint8Array): string {
  // 8-char window into the base58 string — ~47 bits of entropy.
  // Enough to be unique across any realistic NS federation network.
  // Not a security boundary; use the full DID for cryptographic operations.
  const prefixed = new Uint8Array(MULTICODEC_ED25519_PUB.length + pubkeyBytes.length);
  prefixed.set(MULTICODEC_ED25519_PUB);
  prefixed.set(pubkeyBytes, MULTICODEC_ED25519_PUB.length);
  return "z" + base58Encode(prefixed).slice(0, 8);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type NodeIdentity = {
  /**
   * Permanent cryptographic identity for this NS node.
   * Format: did:nexus:z<base58btc(multicodec-prefix + ed25519-pubkey)>
   * Example: did:nexus:z6Mkf5rGMoatrSj1f9DuUe6BCbrn9sg8YSxDqCHHxJvEynEt
   *
   * Free, uncensorable, globally unique — requires no registrar.
   * Derived deterministically from the Ed25519 public key.
   */
  did: string;

  /**
   * Human-compact short form — first 8 chars of the base58 portion.
   * Example: z6Mkf5rG
   *
   * Used as the server namespace in NS addresses: @alice:z6Mkf5rG
   * Think of it as the "server ID" in the Matrix/@user:server.tld model,
   * except there is no domain — just the node's cryptographic fingerprint.
   */
  shortId: string;

  /** Base64url-encoded raw 32-byte Ed25519 public key. */
  publicKey: string;
};

type PersistedIdentity = NodeIdentity & {
  /**
   * Base64url-encoded Ed25519 private key seed.
   * SECURITY: This file must never be committed to git, shared, or exposed via the API.
   * It lives in data/node-identity.json which is excluded from version control.
   */
  privateKey: string;
  createdAt: string;
};

const IDENTITY_FILE = "data/node-identity.json";

// Module-level singleton — set once on startup, read-only for the rest of the process.
let _identity: NodeIdentity | null = null;

// ─── Init (called once on startup) ───────────────────────────────────────────

/**
 * Load or generate the node's persistent Ed25519 identity.
 *
 * On first run: generates a keypair, persists it to data/node-identity.json,
 * and returns the public identity (DID + shortId + publicKey).
 *
 * On subsequent runs: loads the existing keypair from disk.
 * The private key seed is stored only on disk and never returned from this function.
 *
 * Call this once during startup before any API handlers run.
 */
export async function initNodeIdentity(): Promise<NodeIdentity> {
  if (_identity) return _identity;

  mkdirSync("data", { recursive: true });

  if (existsSync(IDENTITY_FILE)) {
    const saved = JSON.parse(readFileSync(IDENTITY_FILE, "utf-8")) as PersistedIdentity;
    _identity = { did: saved.did, shortId: saved.shortId, publicKey: saved.publicKey };
    return _identity;
  }

  // Generate a new Ed25519 keypair via Web Crypto API (built into Bun, no deps needed).
  const keypair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keypair.publicKey));

  // JWK "d" field is the base64url-encoded private key seed (32 bytes for Ed25519).
  const privJwk = (await crypto.subtle.exportKey("jwk", keypair.privateKey)) as Record<
    string,
    unknown
  >;
  const privateKey = privJwk["d"] as string;

  const did = rawPubkeyToDid(pubRaw);
  const shortId = rawPubkeyToShortId(pubRaw);
  const publicKey = Buffer.from(pubRaw).toString("base64url");

  const persisted: PersistedIdentity = {
    did,
    shortId,
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(IDENTITY_FILE, JSON.stringify(persisted, null, 2), "utf-8");

  _identity = { did, shortId, publicKey };
  return _identity;
}

/**
 * Synchronous accessor — valid only after initNodeIdentity() has resolved.
 * Safe to call from any handler since initNodeIdentity() is awaited during startup.
 */
export function getNodeIdentity(): NodeIdentity {
  if (!_identity) {
    throw new Error("Node identity not initialized. Call initNodeIdentity() before serving requests.");
  }
  return _identity;
}

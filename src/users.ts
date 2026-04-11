import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { getNodeIdentity } from "./identity";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NodeUser = {
  username: string;
  /**
   * Canonical NS address: @<username>:<shortId>
   * Example: @alice:z6Mkf5rG
   *
   * This address is:
   *   - Free — derived from the node's Ed25519 keypair, no registrar
   *   - Uncensorable — belongs to whoever controls the node's private key
   *   - Globally unique — because the shortId IS the node fingerprint
   *   - Federation-compatible — any federated node can resolve it by
   *     connecting to the node whose shortId matches
   */
  address: string;
  /** Full DID of the node this user was registered on */
  nodeId: string;
  registeredAt: string;
};

// ─── Persistence ─────────────────────────────────────────────────────────────

const USERS_FILE = "data/users.json";
let _users: NodeUser[] | null = null;

function loadUsers(): NodeUser[] {
  if (_users) return _users;
  mkdirSync("data", { recursive: true });
  if (!existsSync(USERS_FILE)) {
    _users = [];
    return _users;
  }
  try {
    _users = JSON.parse(readFileSync(USERS_FILE, "utf-8")) as NodeUser[];
  } catch {
    _users = [];
  }
  return _users;
}

function saveUsers(): void {
  writeFileSync(USERS_FILE, JSON.stringify(_users, null, 2), "utf-8");
}

// ─── Validation ──────────────────────────────────────────────────────────────

// Lowercase letters, digits, hyphens, underscores. Must start with letter or digit.
// 1–32 characters. Same rules as most federated chat systems (Matrix, XMPP).
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type RegisterUserResult =
  | { ok: true; user: NodeUser }
  | { ok: false; error: string };

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Register a new username on this node.
 * Returns the canonical @user:shortId address on success.
 * Idempotent — re-registering the same username returns the existing record.
 */
export function registerUser(username: string): RegisterUserResult {
  const lower = username.toLowerCase().trim();

  if (!USERNAME_RE.test(lower)) {
    return {
      ok: false,
      error:
        "Username must be 1–32 characters, start with a letter or digit, and contain only lowercase letters, numbers, hyphens and underscores.",
    };
  }

  const users = loadUsers();
  const existing = users.find(u => u.username === lower);
  if (existing) {
    // Idempotent: return existing user rather than failing
    return { ok: true, user: existing };
  }

  const id = getNodeIdentity();
  const user: NodeUser = {
    username: lower,
    address: `@${lower}:${id.shortId}`,
    nodeId: id.did,
    registeredAt: new Date().toISOString(),
  };

  users.push(user);
  _users = users;
  saveUsers();

  return { ok: true, user };
}

export function listUsers(): NodeUser[] {
  return loadUsers();
}

export function getUser(username: string): NodeUser | null {
  return loadUsers().find(u => u.username === username.toLowerCase().trim()) ?? null;
}

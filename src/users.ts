import { pool } from "./db";
import { getNodeIdentity } from "./identity";

export type NexusCloudUser = {
  id: string;
  email: string;
  username: string;
  address: string;
  nodeId: string;
  isAdmin: boolean;
  emailVerified: boolean;
  createdAt: string;
};

function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 4, timeCost: 3 });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export async function registerUser(
  email: string,
  username: string,
  password: string,
  firstName?: string,
  lastName?: string,
): Promise<{ ok: true; user: NexusCloudUser } | { ok: false; error: string }> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { ok: false, error: "Valid email is required" };
  }

  if (!normalizedUsername) {
    return { ok: false, error: "Username cannot be empty" };
  }

  if (!/^[a-z0-9._-]{2,32}$/.test(normalizedUsername)) {
    return { ok: false, error: "Username must be 2-32 chars: a-z, 0-9, dot, underscore, hyphen" };
  }

  if (!password || password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }

  const existingEmail = await pool.query("SELECT id FROM cloud_users WHERE email = $1", [
    normalizedEmail,
  ]);
  if (existingEmail.rows.length > 0) {
    return { ok: false, error: "Email already registered" };
  }

  const existingUsername = await pool.query("SELECT id FROM cloud_users WHERE username = $1", [
    normalizedUsername,
  ]);
  if (existingUsername.rows.length > 0) {
    return { ok: false, error: "Username already exists" };
  }

  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    `INSERT INTO cloud_users (email, username, password_hash, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, username, first_name, last_name, is_admin, email_verified, created_at`,
    [normalizedEmail, normalizedUsername, passwordHash, firstName || null, lastName || null],
  );

  const row = result.rows[0];
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      address: `@${row.username}:${getNodeIdentity().shortId}`,
      nodeId: getNodeIdentity().did,
      isAdmin: Boolean(row.is_admin),
      emailVerified: Boolean(row.email_verified),
      createdAt: row.created_at,
    },
  };
}

export async function authenticateUser(
  emailOrUsername: string,
  password: string,
): Promise<{ ok: true; user: NexusCloudUser } | { ok: false; error: string }> {
  const normalized = normalizeEmail(emailOrUsername).includes("@")
    ? normalizeEmail(emailOrUsername)
    : normalizeUsername(emailOrUsername);

  const query = normalized.includes("@")
    ? "SELECT * FROM cloud_users WHERE email = $1"
    : "SELECT * FROM cloud_users WHERE username = $1";

  const result = await pool.query(query, [normalized]);
  if (result.rows.length === 0) {
    return { ok: false, error: "Invalid credentials" };
  }

  const row = result.rows[0];
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    return { ok: false, error: "Invalid credentials" };
  }

  if (row.suspended_at) {
    return { ok: false, error: "Account suspended" };
  }

  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      address: `@${row.username}:${getNodeIdentity().shortId}`,
      nodeId: getNodeIdentity().did,
      isAdmin: Boolean(row.is_admin),
      emailVerified: Boolean(row.email_verified),
      createdAt: row.created_at,
    },
  };
}

export async function createSession(
  userId: string,
  expiresInMs = 30 * 24 * 60 * 60 * 1000,
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + expiresInMs);

  await pool.query("INSERT INTO cloud_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)", [
    userId,
    token,
    expiresAt,
  ]);

  return token;
}

export async function validateSession(
  token: string,
): Promise<{ ok: true; user: NexusCloudUser } | { ok: false; error: string }> {
  const result = await pool.query(
    `SELECT u.* FROM cloud_users u
     JOIN cloud_sessions s ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.suspended_at IS NULL`,
    [token],
  );

  if (result.rows.length === 0) {
    return { ok: false, error: "Invalid or expired session" };
  }

  const row = result.rows[0];
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      address: `@${row.username}:${getNodeIdentity().shortId}`,
      nodeId: getNodeIdentity().did,
      isAdmin: Boolean(row.is_admin),
      emailVerified: Boolean(row.email_verified),
      createdAt: row.created_at,
    },
  };
}

export async function deleteSession(token: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM cloud_sessions WHERE token = $1", [token]);
  return (result.rowCount ?? 0) > 0;
}

export async function getUserById(userId: string): Promise<NexusCloudUser | null> {
  const result = await pool.query(
    "SELECT id, email, username, is_admin, email_verified, created_at FROM cloud_users WHERE id = $1",
    [userId],
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    address: `@${row.username}:${getNodeIdentity().shortId}`,
    nodeId: getNodeIdentity().did,
    isAdmin: Boolean(row.is_admin),
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
  };
}

export async function listUsers(): Promise<NexusCloudUser[]> {
  const result = await pool.query(
    `SELECT id, email, username, is_admin, email_verified, created_at
     FROM cloud_users
     ORDER BY created_at DESC`,
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    email: row.email,
    username: row.username,
    address: `@${row.username}:${getNodeIdentity().shortId}`,
    nodeId: getNodeIdentity().did,
    isAdmin: Boolean(row.is_admin),
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
  }));
}

export async function getUserByEmail(email: string): Promise<NexusCloudUser | null> {
  const result = await pool.query(
    "SELECT id, email, username, is_admin, email_verified, created_at FROM cloud_users WHERE email = $1",
    [email.toLowerCase()],
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    address: `@${row.username}:${getNodeIdentity().shortId}`,
    nodeId: getNodeIdentity().did,
    isAdmin: Boolean(row.is_admin),
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
  };
}

export async function getUserByUsername(username: string): Promise<NexusCloudUser | null> {
  const result = await pool.query(
    "SELECT id, email, username, is_admin, email_verified, created_at FROM cloud_users WHERE username = $1",
    [username.toLowerCase()],
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    address: `@${row.username}:${getNodeIdentity().shortId}`,
    nodeId: getNodeIdentity().did,
    isAdmin: Boolean(row.is_admin),
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
  };
}

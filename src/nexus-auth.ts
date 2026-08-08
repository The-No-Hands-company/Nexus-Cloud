/**
 * Identity delegation to Nexus-Auth.
 *
 * Cloud used to own accounts: a cloud_users table, password hashing, its own
 * sessions. That is why signing up here did not sign you in to Nexus-Deploy —
 * four apps, four identity systems, while Nexus-Auth sat unused. Cloud now holds
 * no user data at all; it asks the ecosystem's identity service.
 *
 * Login is proxied rather than redirected. The dashboard is served from this
 * origin, so a same-origin POST keeps it working without CORS or credentialed
 * cross-origin requests, and the Set-Cookie relayed back carries Nexus-Auth's
 * own Domain attribute — so the session it establishes is the ecosystem session,
 * valid at Deploy and Vault too, not a Cloud-local one.
 */

const BASE = (process.env.NEXUS_AUTH_URL ?? "http://localhost:4310").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.NEXUS_AUTH_TIMEOUT_MS ?? 5000);

export const nexusAuthUrl = BASE;

export type NexusAuthUser = {
  id: string;
  username?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
};

export class NexusAuthUnavailable extends Error {}

async function call(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new NexusAuthUnavailable(
      `Could not reach Nexus-Auth at ${BASE}: ${(err as Error).message}`,
    );
  }
}

/** Resolve a session token or API key to its owner, or null if not valid. */
export async function checkSession(credential: string): Promise<NexusAuthUser | null> {
  const response = await call("/api/v1/auth/check", {
    headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as
    | { authorized?: boolean; userId?: string; user?: NexusAuthUser }
    | null;
  if (!body?.authorized || !body.userId) return null;
  return body.user ?? { id: body.userId };
}

/**
 * Forward a login to Nexus-Auth. Returns the upstream status, body and
 * Set-Cookie so the caller can relay all three verbatim — the cookie in
 * particular, since dropping it would leave the browser with a session it
 * cannot present to any other app.
 */
export async function login(
  username: string,
  password: string,
): Promise<{ status: number; body: unknown; setCookie: string | null }> {
  const response = await call("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({ error: "Malformed response from Nexus-Auth" })),
    setCookie: response.headers.get("set-cookie"),
  };
}

/** End the session upstream so it dies everywhere, not just for Cloud. */
export async function logout(credential: string): Promise<{ status: number; setCookie: string | null }> {
  const response = await call("/api/v1/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" },
  });
  return { status: response.status, setCookie: response.headers.get("set-cookie") };
}

/** The ecosystem's user list, read with the caller's own credential. */
export async function listUsers(credential: string): Promise<{ status: number; body: unknown }> {
  const response = await call("/api/v1/auth/users", {
    headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" },
  });
  return { status: response.status, body: await response.json().catch(() => ({ users: [] })) };
}

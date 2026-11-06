import { timingSafeEqual } from "node:crypto";
import { cloudConfig } from "../config";
import { systemsApiService } from "../systems-api";

/**
 * Publishing and removing the apps members deploy through Nexus Deploy.
 *
 * These routes are guarded by their own credential, not the node API key. The
 * route a publish creates carries the proxy's user-site isolation, and only the
 * holder of this credential may create one, move one, or remove one.
 */

/** Same shape Deploy enforces; checked again here because this is the trust boundary. */
const SLUG_RE = /^(?!.*--)[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function portRange(): { min: number; max: number } {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(cloudConfig.userAppsPortRange);
  if (!match) return { min: 20000, max: 29999 };
  return { min: Number(match[1]), max: Number(match[2]) };
}

/** Loopback only, plain http, inside the configured port range. */
export function isAllowedUserAppUpstream(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(value);
  if (!match) return false;
  const port = Number(match[1]);
  const { min, max } = portRange();
  return port >= min && port <= max;
}

function authorize(request: Request): Response | null {
  const expected = cloudConfig.userAppsKey;
  // Not configured means the feature is off, never open.
  if (!expected) return json({ error: "User apps are not configured" }, 503);
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !sameSecret(token, expected)) return json({ error: "Unauthorized" }, 401);
  return null;
}

/** Returns a Response for /api/v1/user-apps/*, or null for any other path. */
export async function handleUserAppsRequest(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  const match = /^\/api\/v1\/user-apps\/([^/]+?)(\/availability)?$/.exec(pathname);
  if (!match) return null;

  const denied = authorize(request);
  if (denied) return denied;

  const slug = decodeURIComponent(match[1] ?? "");
  if (!SLUG_RE.test(slug)) return json({ error: "Invalid app name" }, 400);
  const host = `${slug}.${cloudConfig.cloudDomain}`;

  if (match[2]) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const taken = systemsApiService.isHostInUse(host, `deploy-${slug}`);
    return json({ slug, host, taken });
  }

  if (request.method === "PUT") {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const upstreamUrl = (body as { upstreamUrl?: unknown } | null)?.upstreamUrl;
    if (!isAllowedUserAppUpstream(upstreamUrl)) {
      return json({ error: "upstreamUrl must be http://127.0.0.1:<port> inside the allowed range" }, 400);
    }
    const result = systemsApiService.publishUserApp({ slug, upstreamUrl, host });
    if (!result.ok) {
      return result.reason === "conflict"
        ? json({ error: "That name is already in use" }, 409)
        : json({ error: "That name was refused" }, 403);
    }
    return json({ slug, host, upstreamUrl, health: result.tool.health });
  }

  if (request.method === "DELETE") {
    return systemsApiService.unpublishUserApp(slug)
      ? new Response(null, { status: 204 })
      : json({ error: "Not found" }, 404);
  }

  return json({ error: "Method not allowed" }, 405);
}

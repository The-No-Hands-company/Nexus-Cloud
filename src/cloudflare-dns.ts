// Cloudflare DNS integration.
//
// This node sits behind a Cloudflare Tunnel and has no routable public IP, so
// every hostname it serves is published as a **proxied CNAME to the tunnel**
// (`<tunnel-id>.cfargotunnel.com`) — not an A record to a machine IP. The tunnel
// then carries the request to the local ecosystem proxy.
//
// The token is scoped to specific zones, so the target zone is discovered at
// call time by listing the zones the token can see and picking the one whose
// name is the longest suffix of the hostname. A hostname whose zone the token
// cannot see is reported as out-of-scope rather than silently failing — that is
// the expected result for a customer domain the operator has not delegated.

type DnsRecordResult = {
  ok: boolean;
  name: string;
  recordId?: string;
  status?: number;
  message?: string;
  /** true when the token simply has no access to the hostname's zone. */
  outOfScope?: boolean;
};

export type DnsBootstrapResult = {
  root: DnsRecordResult;
  wildcard: DnsRecordResult;
};

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

type Zone = { id: string; name: string };

function getConfig() {
  const token = process.env.CF_API_TOKEN?.trim() || "";
  const zoneId = process.env.CF_ZONE_ID?.trim() || "";
  const cloudDomain = process.env.NEXUS_CLOUD_DOMAIN?.trim() || process.env.CLOUD_DOMAIN?.trim() || "nexus.local";
  const serverIp = process.env.SERVER_PUBLIC_IP?.trim() || "";
  return { token, zoneId, cloudDomain, serverIp, tunnelTarget: tunnelTarget() };
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────────

/**
 * The CNAME target every hostname on this node points at. Prefer an explicit
 * full target; otherwise build it from the tunnel id. Empty when neither is set,
 * which callers treat as "tunnel DNS not configured".
 */
export function tunnelTarget(): string {
  const explicit = process.env.NEXUS_TUNNEL_CNAME_TARGET?.trim();
  if (explicit) return explicit.replace(/\.$/, "");
  const id = process.env.NEXUS_TUNNEL_ID?.trim();
  return id ? `${id}.cfargotunnel.com` : "";
}

/**
 * Pick the zone that owns `host`: the zone whose name equals the host or is a
 * dot-suffix of it, preferring the longest (most specific) match. Returns null
 * when the token can see no zone for this host — i.e. it is out of scope.
 */
export function selectZone(host: string, zones: Zone[]): Zone | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  let best: Zone | null = null;
  for (const z of zones) {
    const name = z.name.toLowerCase();
    if (h === name || h.endsWith(`.${name}`)) {
      if (!best || name.length > best.name.length) best = z;
    }
  }
  return best;
}

/** The Cloudflare record payload for a proxied CNAME → tunnel. */
export function cnameRecordBody(name: string, target: string, proxied: boolean) {
  return { type: "CNAME" as const, name, content: target, ttl: 1, proxied };
}

// ── Cloudflare I/O ─────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function err(name: string, message: string, status = 500, outOfScope = false): DnsRecordResult {
  return { ok: false, name, message, status, ...(outOfScope ? { outOfScope } : {}) };
}

async function listZones(token: string): Promise<Zone[] | null> {
  const res = await fetch(`${CLOUDFLARE_API_BASE}/zones?per_page=50`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const j = (await res.json()) as { success?: boolean; result?: Zone[] };
  return j.success ? (j.result ?? []) : null;
}

/**
 * Create or update a proxied CNAME record `name` → `target` in `zoneId`.
 * Idempotent: an existing record of the same name is updated in place.
 */
async function upsertCnameRecord(
  token: string,
  zoneId: string,
  name: string,
  target: string,
  proxied: boolean,
): Promise<DnsRecordResult> {
  const headers = authHeaders(token);

  const listUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`;
  const listResponse = await fetch(listUrl, { headers });
  if (!listResponse.ok) return err(name, "cloudflare list failed", listResponse.status);

  const listJson = (await listResponse.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: Array<{ id: string }>;
  };
  if (!listJson.success) {
    return err(name, listJson.errors?.[0]?.message || "cloudflare list failed", listResponse.status);
  }

  const existingId = listJson.result?.[0]?.id;
  const body = JSON.stringify(cnameRecordBody(name, target, proxied));

  const targetUrl = existingId
    ? `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${existingId}`
    : `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`;
  const method = existingId ? "PUT" : "POST";

  const writeResponse = await fetch(targetUrl, { method, headers, body });
  const writeJson = (await writeResponse.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { id?: string };
  };
  if (!writeJson.success) {
    return err(name, writeJson.errors?.[0]?.message || "cloudflare write failed", writeResponse.status);
  }

  const recordId = writeJson.result?.id || existingId;
  return {
    ok: true,
    name,
    status: writeResponse.status,
    ...(recordId !== undefined ? { recordId } : {}),
    message: existingId ? "updated" : "created",
  };
}

export function hasCloudflareDns(): boolean {
  const { token } = getConfig();
  return token.length > 0 && tunnelTarget().length > 0;
}

/**
 * Publish `host` as a proxied CNAME to the tunnel, discovering the owning zone
 * from the token's visible zones. Used for custom domains (e.g. a customer's
 * apex) that fall outside the `*.<cloudDomain>` wildcard. Idempotent.
 *
 * A host whose zone the token cannot see returns `{ ok:false, outOfScope:true }`
 * — the operator must add that zone to the token's scope (or the domain owner
 * must point their own DNS at the tunnel).
 */
export async function ensureCustomDomainDns(host: string): Promise<DnsRecordResult> {
  const { token, tunnelTarget: target } = getConfig();
  if (!token) return err(host, "CF_API_TOKEN is required", 501);
  if (!target) return err(host, "NEXUS_TUNNEL_ID or NEXUS_TUNNEL_CNAME_TARGET is required", 501);

  const zones = await listZones(token);
  if (zones === null) return err(host, "cloudflare zone list failed", 502);

  const zone = selectZone(host, zones);
  if (!zone) {
    return err(
      host,
      `no zone in the token's scope owns ${host} — add that zone to the API token, or have the domain owner point its DNS at the tunnel`,
      403,
      true,
    );
  }

  return upsertCnameRecord(token, zone.id, host, target, true);
}

/**
 * Publish the node's own root and wildcard as proxied CNAMEs to the tunnel.
 * Idempotent. Largely redundant once a `*.<cloudDomain>` wildcard exists at the
 * edge, but kept for a fresh node that has neither record yet.
 */
export async function bootstrapDns(): Promise<DnsBootstrapResult> {
  const { token, zoneId, cloudDomain, tunnelTarget: target } = getConfig();
  const rootName = cloudDomain;
  const wildcardName = `*.${cloudDomain}`;

  if (!token || !zoneId) {
    const message = "CF_API_TOKEN and CF_ZONE_ID are required";
    return { root: err(rootName, message, 501), wildcard: err(wildcardName, message, 501) };
  }
  if (!target) {
    const message = "NEXUS_TUNNEL_ID or NEXUS_TUNNEL_CNAME_TARGET is required";
    return { root: err(rootName, message, 501), wildcard: err(wildcardName, message, 501) };
  }

  const [root, wildcard] = await Promise.all([
    upsertCnameRecord(token, zoneId, rootName, target, true),
    upsertCnameRecord(token, zoneId, wildcardName, target, true),
  ]);
  return { root, wildcard };
}

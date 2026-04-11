/**
 * Cloudflare DNS automation for Nexus Cloud.
 *
 * Handles the one-time bootstrap of the two A records required to make
 * the cloud domain publicly reachable:
 *   nexus.cloud        → <SERVER_PUBLIC_IP>    (API plane)
 *   *.nexus.cloud      → <SERVER_PUBLIC_IP>    (subdomain plane, wildcard)
 *
 * Also manages per-node DDNS updates when a node's public IP changes.
 *
 * Required Cloudflare API token permissions (narrow scope):
 *   Zone: DNS: Edit — for the specific zone only.
 * Find your Zone ID in the Cloudflare dashboard under the domain's Overview tab.
 */

import { cloudConfig } from "./config";

const CF_API = "https://api.cloudflare.com/client/v4";

export type CfDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
};

export type CfDnsResult =
  | { ok: true; record: CfDnsRecord; action: "created" | "updated" | "unchanged" }
  | { ok: false; error: string };

export type DnsBootstrapResult = {
  root: CfDnsResult;
  wildcard: CfDnsResult;
};

function cfHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cloudConfig.cfApiToken}`,
  };
}

async function cfRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ success: boolean; result: T; errors?: { message: string }[] }> {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: cfHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<{ success: boolean; result: T; errors?: { message: string }[] }>;
}

async function findRecord(
  zoneId: string,
  type: string,
  name: string,
): Promise<CfDnsRecord | null> {
  const data = await cfRequest<CfDnsRecord[]>(
    "GET",
    `/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(name)}`,
  );
  return data.result?.[0] ?? null;
}

async function upsertARecord(
  zoneId: string,
  name: string,
  ip: string,
  proxied = true,
): Promise<CfDnsResult> {
  const existing = await findRecord(zoneId, "A", name);

  if (existing) {
    if (existing.content === ip && existing.proxied === proxied) {
      return { ok: true, record: existing, action: "unchanged" };
    }
    const data = await cfRequest<CfDnsRecord>("PATCH", `/zones/${zoneId}/dns_records/${existing.id}`, {
      content: ip,
      proxied,
      ttl: 1, // auto TTL when proxied
    });
    if (!data.success) {
      return { ok: false, error: data.errors?.[0]?.message ?? "PATCH failed" };
    }
    return { ok: true, record: data.result, action: "updated" };
  }

  const data = await cfRequest<CfDnsRecord>("POST", `/zones/${zoneId}/dns_records`, {
    type: "A",
    name,
    content: ip,
    proxied,
    ttl: 1,
  });
  if (!data.success) {
    return { ok: false, error: data.errors?.[0]?.message ?? "POST failed" };
  }
  return { ok: true, record: data.result, action: "created" };
}

/**
 * Bootstrap (or re-sync) the two mandatory A records for the cloud domain.
 * Safe to call repeatedly — idempotent, only updates if the IP has changed.
 *
 * - nexus.cloud     → SERVER_PUBLIC_IP  (proxied=true — goes through Cloudflare CDN/DDoS)
 * - *.nexus.cloud   → SERVER_PUBLIC_IP  (proxied=false — Caddy handles TLS, can't proxy wildcard)
 *
 * Why wildcard is not proxied:
 * Cloudflare cannot proxy wildcard records on free/pro plans, and even on enterprise
 * plans the TCP proxy would break Caddy's On-Demand TLS ACME challenges.
 */
export async function bootstrapDns(ip?: string): Promise<DnsBootstrapResult> {
  const { cfApiToken, cfZoneId, cloudDomain, serverIp } = cloudConfig;
  if (!cfApiToken || !cfZoneId) {
    const err = "CF_API_TOKEN and CF_ZONE_ID must be set";
    return { root: { ok: false, error: err }, wildcard: { ok: false, error: err } };
  }
  const targetIp = ip?.trim() || serverIp;
  if (!targetIp) {
    const err = "SERVER_PUBLIC_IP must be set (or pass ip argument)";
    return { root: { ok: false, error: err }, wildcard: { ok: false, error: err } };
  }

  const [root, wildcard] = await Promise.all([
    upsertARecord(cfZoneId, cloudDomain, targetIp, true),
    upsertARecord(cfZoneId, `*.${cloudDomain}`, targetIp, false),
  ]);

  return { root, wildcard };
}

/**
 * Update (or create) a CNAME record pointing a custom domain at the cloud domain.
 * Called when an NS tool binds a custom domain and it passes verification.
 *
 * e.g.  mybusiness.com CNAME nexus.cloud
 */
export async function upsertCnameRecord(customDomain: string): Promise<CfDnsResult> {
  const { cfApiToken, cfZoneId, cloudDomain } = cloudConfig;
  if (!cfApiToken || !cfZoneId) {
    return { ok: false, error: "CF_API_TOKEN and CF_ZONE_ID must be set" };
  }
  const existing = await findRecord(cfZoneId, "CNAME", customDomain);
  if (existing) {
    if (existing.content === cloudDomain) return { ok: true, record: existing, action: "unchanged" };
    const data = await cfRequest<CfDnsRecord>("PATCH", `/zones/${cfZoneId}/dns_records/${existing.id}`, {
      content: cloudDomain,
      proxied: false,
      ttl: 300,
    });
    if (!data.success) return { ok: false, error: data.errors?.[0]?.message ?? "PATCH failed" };
    return { ok: true, record: data.result, action: "updated" };
  }
  const data = await cfRequest<CfDnsRecord>("POST", `/zones/${cfZoneId}/dns_records`, {
    type: "CNAME",
    name: customDomain,
    content: cloudDomain,
    proxied: false,
    ttl: 300,
  });
  if (!data.success) return { ok: false, error: data.errors?.[0]?.message ?? "POST failed" };
  return { ok: true, record: data.result, action: "created" };
}

export function hasCloudflareDns(): boolean {
  return Boolean(cloudConfig.cfApiToken.trim() && cloudConfig.cfZoneId.trim());
}

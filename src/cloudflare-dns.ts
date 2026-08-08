type DnsRecordResult = {
  ok: boolean;
  name: string;
  recordId?: string;
  status?: number;
  message?: string;
};

export type DnsBootstrapResult = {
  root: DnsRecordResult;
  wildcard: DnsRecordResult;
};

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function getConfig() {
  const token = process.env.CF_API_TOKEN?.trim() || "";
  const zoneId = process.env.CF_ZONE_ID?.trim() || "";
  const cloudDomain = process.env.CLOUD_DOMAIN?.trim() || "nexus.cloud";
  const serverIp = process.env.SERVER_PUBLIC_IP?.trim() || "";
  return { token, zoneId, cloudDomain, serverIp };
}

export function hasCloudflareDns(): boolean {
  const { token, zoneId } = getConfig();
  return token.length > 0 && zoneId.length > 0;
}

function err(name: string, message: string, status = 500): DnsRecordResult {
  return { ok: false, name, message, status };
}

async function upsertARecord(
  token: string,
  zoneId: string,
  name: string,
  ip: string,
  proxied: boolean,
): Promise<DnsRecordResult> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const listUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`;
  const listResponse = await fetch(listUrl, { headers });
  if (!listResponse.ok) {
    return err(name, "cloudflare list failed", listResponse.status);
  }

  const listJson = (await listResponse.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: Array<{ id: string }>;
  };

  if (!listJson.success) {
    const message = listJson.errors?.[0]?.message || "cloudflare list failed";
    return err(name, message, listResponse.status);
  }

  const existingId = listJson.result?.[0]?.id;
  const body = JSON.stringify({ type: "A", name, content: ip, ttl: 1, proxied });

  const targetUrl = existingId
    ? `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${existingId}`
    : `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`;
  const method = existingId ? "PUT" : "POST";

  const writeResponse = await fetch(targetUrl, { method, headers, body });
  if (!writeResponse.ok) {
    return err(name, "cloudflare write failed", writeResponse.status);
  }

  const writeJson = (await writeResponse.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { id?: string };
  };

  if (!writeJson.success) {
    const message = writeJson.errors?.[0]?.message || "cloudflare write failed";
    return err(name, message, writeResponse.status);
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

export async function bootstrapDns(ipOverride?: string): Promise<DnsBootstrapResult> {
  const { token, zoneId, cloudDomain, serverIp } = getConfig();
  const ip = (ipOverride || serverIp || "").trim();

  if (!token || !zoneId) {
    const rootName = cloudDomain;
    const wildcardName = `*.${cloudDomain}`;
    return {
      root: err(rootName, "CF_API_TOKEN and CF_ZONE_ID are required", 501),
      wildcard: err(wildcardName, "CF_API_TOKEN and CF_ZONE_ID are required", 501),
    };
  }

  if (!ip) {
    const rootName = cloudDomain;
    const wildcardName = `*.${cloudDomain}`;
    return {
      root: err(rootName, "Missing server IP: provide request ip or SERVER_PUBLIC_IP", 400),
      wildcard: err(wildcardName, "Missing server IP: provide request ip or SERVER_PUBLIC_IP", 400),
    };
  }

  const rootName = cloudDomain;
  const wildcardName = `*.${cloudDomain}`;

  const [root, wildcard] = await Promise.all([
    upsertARecord(token, zoneId, rootName, ip, true),
    upsertARecord(token, zoneId, wildcardName, ip, false),
  ]);

  return { root, wildcard };
}

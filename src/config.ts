export const cloudConfig = {
  get deployUrl(): string {
    return process.env.NEXUS_DEPLOY_URL ?? "";
  },
  get deployToken(): string {
    return process.env.NEXUS_DEPLOY_TOKEN ?? "";
  },
  get apiKey(): string {
    return process.env.NEXUS_CLOUD_API_KEY ?? "";
  },
  get corsOrigin(): string {
    return process.env.CORS_ORIGIN ?? "*";
  },
  // Base domain used when generating public subdomains, e.g. nexus.cloud
  get cloudDomain(): string {
    return process.env.NEXUS_CLOUD_DOMAIN?.trim() || "nexus.local";
  },
  // Publicly reachable URL of this Nexus Cloud instance (for discovery)
  get cloudUrl(): string {
    return process.env.NEXUS_CLOUD_URL?.trim() || "";
  },
  // Public IPv4 of this server — used when generating DNS records
  get serverIp(): string {
    return process.env.SERVER_PUBLIC_IP?.trim() || "";
  },
  // Cloudflare API token with Zone:DNS:Edit permission for the cloud domain zone
  get cfApiToken(): string {
    return process.env.CF_API_TOKEN?.trim() || "";
  },
  // Cloudflare Zone ID for the cloud domain (find in Cloudflare dashboard)
  get cfZoneId(): string {
    return process.env.CF_ZONE_ID?.trim() || "";
  },
};

export function hasDeployIntegration(): boolean {
  return Boolean(cloudConfig.deployUrl.trim() && cloudConfig.deployToken.trim());
}

export function requiresApiKey(): boolean {
  return Boolean(cloudConfig.apiKey.trim());
}

/**
 * Accepts the current key OR the previous key during a rotation window.
 *
 * Zero-downtime rotation procedure:
 *   1. Set NEXUS_CLOUD_API_KEY_PREVIOUS=<old>, NEXUS_CLOUD_API_KEY=<new>,
 *      restart Cloud.
 *   2. Update each service's key to <new>. They keep working because Cloud
 *      still accepts old via PREVIOUS.
 *   3. Once every service has the new key, clear PREVIOUS and restart Cloud.
 *
 * Same model as AWS access key rotation. Without this, rotating meant a
 * coordinated restart of Cloud + proxy + dashboard + auth + terminal + draw
 * simultaneously — which is why the key had never been rotated.
 */
export function isValidApiKey(key: string): boolean {
  const current = cloudConfig.apiKey.trim();
  if (!current) return false;
  const trimmed = key.trim();
  if (trimmed === current) return true;
  const previous = (process.env.NEXUS_CLOUD_API_KEY_PREVIOUS ?? "").trim();
  return previous.length > 0 && trimmed === previous;
}

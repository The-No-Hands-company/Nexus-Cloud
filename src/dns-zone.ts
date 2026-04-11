/**
 * DNS zone file generator for Nexus Cloud.
 *
 * Produces a RFC 1035 / BIND-format zone file from the live routing table.
 * This is consumed by CoreDNS (or any BIND-compatible nameserver) when
 * running in "sovereign" mode — i.e. Nexus Cloud is its own authoritative DNS.
 *
 * The zone file is rebuilt on every call; CoreDNS is configured with
 * `reload 30s` so it picks up changes automatically from the shared volume.
 *
 * Zone structure:
 *   $ORIGIN nexus.cloud.
 *   @ SOA ns1.nexus.cloud. admin.nexus.cloud. (serial ...)
 *   @ NS ns1.nexus.cloud.
 *   @ A <SERVER_PUBLIC_IP>
 *   ns1 A <SERVER_PUBLIC_IP>
 *   * A <SERVER_PUBLIC_IP>      — wildcard for Caddy On-Demand TLS
 *   <subdomain> A <SERVER_IP>   — one per active route (same IP, Nexus Cloud proxies)
 */

import { cloudConfig } from "./config";
import { listActiveRoutes } from "./systems-api/registry";

/** Generate a monotonically increasing serial from the current timestamp (YYYYMMDDhh). */
function zoneSerial(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
}

export function generateZoneFile(): string {
  const { cloudDomain, serverIp } = cloudConfig;
  const ip = serverIp || "127.0.0.1";
  const origin = cloudDomain.endsWith(".") ? cloudDomain : `${cloudDomain}.`;
  const serial = zoneSerial();

  const routes = listActiveRoutes();
  // Extract bare subdomain labels from route domains like alice.nexus.cloud
  const subdomains = new Set<string>();
  for (const route of routes) {
    const label = route.domain.toLowerCase().replace(new RegExp(`\\.${cloudDomain.toLowerCase().replace(/\./g, "\\.")}$`), "");
    if (label && label !== cloudDomain && !label.includes(".")) {
      subdomains.add(label);
    }
  }

  const dynamicRecords = subdomains.size > 0
    ? "\n; Dynamic records — managed by Nexus Cloud (rebuilt on route changes)\n" +
      [...subdomains].sort().map((sub) => `${sub.padEnd(32)} IN A   ${ip}`).join("\n")
    : "";

  return `; Nexus Cloud authoritative zone — auto-generated, do not hand-edit
; Managed by Nexus Cloud. Reload happens every 30 s via CoreDNS reload directive.
$ORIGIN ${origin}
$TTL 300

@  IN SOA  ns1.${origin} admin.${origin} (
           ${serial} ; serial (YYYYMMDDhh)
           3600       ; refresh
           900        ; retry
           604800     ; expire
           300 )      ; minimum TTL

; Nameservers
@            IN NS    ns1.${origin}

; Root and nameserver A records
@            IN A     ${ip}
ns1          IN A     ${ip}

; Wildcard — routes all *.${cloudDomain} to this server.
; Caddy's On-Demand TLS issues individual certs per subdomain on first access.
*            IN A     ${ip}
${dynamicRecords}
`;
}

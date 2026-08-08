import { cloudConfig } from "./config";

function zoneSerial(now = new Date()): string {
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  return `${y}${m}${d}${hh}`;
}

export function generateZoneFile(): string {
  const domain = cloudConfig.cloudDomain.toLowerCase();
  const ip = cloudConfig.serverIp || "127.0.0.1";
  const serial = zoneSerial();

  return [
    `$ORIGIN ${domain}.`,
    "$TTL 300",
    `@ IN SOA ns1.${domain}. admin.${domain}. (`,
    `  ${serial} ; serial`,
    "  3600 ; refresh",
    "  900 ; retry",
    "  1209600 ; expire",
    "  300 ) ; minimum",
    `@ IN NS ns1.${domain}.`,
    `ns1 IN A ${ip}`,
    `@ IN A ${ip}`,
    `* IN A ${ip}`,
    "",
  ].join("\n");
}

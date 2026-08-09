import { describe, expect, test } from "bun:test";
import type { ApiRoute } from "./dto";
import { apiRouteManifest } from "./routes";

describe("API route manifest", () => {
  test("matches the documented router surface exactly", () => {
    const expected: ApiRoute[] = [
      { method: "GET", path: "/health", description: "Basic service health" },
      { method: "GET", path: "/api/status", description: "Legacy node status summary" },
      { method: "GET", path: "/v1/architecture", description: "Project architecture summary" },
      { method: "GET", path: "/v1/state", description: "Read current scaffold state" },
      {
        method: "POST",
        path: "/v1/nodes/register",
        description: "Register a node with the control plane",
      },
      {
        method: "POST",
        path: "/v1/nodes/trust/bulk",
        description: "Apply trust actions across multiple nodes",
      },
      {
        method: "POST",
        path: "/v1/nodes/:nodeId/trust/promote",
        description: "Promote a node trust state to trusted",
      },
      {
        method: "POST",
        path: "/v1/nodes/:nodeId/trust/quarantine",
        description: "Quarantine a node trust state",
      },
      {
        method: "POST",
        path: "/v1/nodes/:nodeId/trust/revoke",
        description: "Revoke a node trust state",
      },
      {
        method: "POST",
        path: "/v1/workloads/plan",
        description: "Produce a placement plan for a workload",
      },
      {
        method: "POST",
        path: "/v1/workloads/:workloadId/run",
        description: "Start a workload through the data plane runtime adapter",
      },
      {
        method: "POST",
        path: "/v1/workloads/:workloadId/stop",
        description: "Stop active runtime units for a workload",
      },
      { method: "GET", path: "/v1/federation/peers", description: "List known federation peers" },
      {
        method: "POST",
        path: "/v1/federation/peers/:domain/trust",
        description: "Upsert a trust record for a peer",
      },
      {
        method: "GET",
        path: "/v1/federation/identity",
        description: "This node's permanent DID, short ID, and NS address format",
      },
      {
        method: "GET",
        path: "/v1/federation/announcement",
        description: "This node's gossip announcement payload (for other nodes to consume)",
      },
      {
        method: "POST",
        path: "/v1/federation/peers/announce",
        description: "Accept a gossip announcement from another NS node and return known peers",
      },
      { method: "GET", path: "/api/v1/users", description: "List users registered on this node" },
      {
        method: "POST",
        path: "/api/v1/users",
        description: "Register a username on this node — issues a free @user:shortId address",
      },
      { method: "GET", path: "/api/v1/tools", description: "List registered tools" },
      { method: "GET", path: "/api/v1/endpoints", description: "List Systems API endpoints" },
      { method: "GET", path: "/api/v1/capabilities", description: "List Systems API capabilities" },
      { method: "GET", path: "/api/v1/summary", description: "Describe the Systems API contract" },
      {
        method: "GET",
        path: "/api/v1/compliance/phantom",
        description: "List PHANTOM security compliance entries (?status=failing|all)",
      },
      {
        method: "GET",
        path: "/api/v1/compliance/phantom/summary",
        description: "Counts-only PHANTOM compliance summary for lightweight polling",
      },
      {
        method: "GET",
        path: "/api/v1/trust/summary",
        description: "Counts-only trust lifecycle summary for lightweight polling",
      },
      { method: "GET", path: "/api/v1/apps", description: "List the canonical Nexus app catalog" },
      {
        method: "GET",
        path: "/api/v1/connections",
        description: "List canonical Nexus app connections",
      },
      {
        method: "GET",
        path: "/api/v1/topology",
        description: "Describe the full Nexus app topology",
      },
      {
        method: "POST",
        path: "/api/v1/tools",
        description: "Register or upsert a tool with Nexus Cloud",
      },
      { method: "GET", path: "/api/v1/tools/:toolId", description: "Inspect a registered tool" },
      {
        method: "GET",
        path: "/api/v1/tools/:toolId/history",
        description: "Inspect a tool lifecycle history",
      },
      {
        method: "PATCH",
        path: "/api/v1/tools/:toolId",
        description: "Update registered tool metadata",
      },
      {
        method: "POST",
        path: "/api/v1/tools/:toolId/enable",
        description: "Enable a registered tool",
      },
      {
        method: "POST",
        path: "/api/v1/tools/:toolId/disable",
        description: "Disable a registered tool",
      },
      {
        method: "POST",
        path: "/api/v1/tools/:toolId/heartbeat",
        description: "Update tool liveness and upstream URL",
      },
      { method: "DELETE", path: "/api/v1/tools/:toolId", description: "Deregister a tool" },
      { method: "GET", path: "/api/v1/status", description: "Return normalized platform status" },
      {
        method: "POST",
        path: "/api/v1/public-url",
        description: "Compatibility alias for website address issuance",
      },
      {
        method: "GET",
        path: "/api/v1/addresses",
        description: "List general public address records",
      },
      {
        method: "GET",
        path: "/api/v1/addresses/:toolId",
        description: "Inspect general public address records for a tool",
      },
      {
        method: "POST",
        path: "/api/v1/addresses",
        description: "Request a general public address",
      },
      {
        method: "POST",
        path: "/api/v1/addresses/:toolId/revoke",
        description: "Revoke general public address records for a tool",
      },
      { method: "GET", path: "/api/v1/exposures", description: "List exposure records" },
      {
        method: "GET",
        path: "/api/v1/exposures/:toolId",
        description: "Inspect an exposure record",
      },
      { method: "POST", path: "/api/v1/exposures", description: "Request a new exposure" },
      {
        method: "POST",
        path: "/api/v1/exposures/:toolId/revoke",
        description: "Revoke an exposure record",
      },
      { method: "GET", path: "/api/v1/domains", description: "List domain bindings" },
      { method: "POST", path: "/api/v1/domains", description: "Bind a custom domain" },
      { method: "GET", path: "/api/v1/domains/:domain", description: "Inspect a domain binding" },
      {
        method: "POST",
        path: "/api/v1/domains/:domain/verify",
        description: "Verify a domain binding",
      },
      { method: "DELETE", path: "/api/v1/domains/:domain", description: "Revoke a domain binding" },
      {
        method: "GET",
        path: "/api/v1/routes",
        description: "Live proxy routing table (domain → upstream)",
      },
      {
        method: "GET",
        path: "/api/v1/routes/caddy",
        description: "Caddy admin API format routing config",
      },
      { method: "GET", path: "/api/v1/guardian/decisions", description: "List Guardian decisions" },
      {
        method: "POST",
        path: "/api/v1/guardian/:scope/:subjectId/approve",
        description: "Approve a Guardian-controlled subject",
      },
      {
        method: "POST",
        path: "/api/v1/guardian/:scope/:subjectId/deny",
        description: "Deny a Guardian-controlled subject",
      },
      {
        method: "POST",
        path: "/api/v1/guardian/:scope/:subjectId/suspend",
        description: "Suspend a Guardian-controlled subject",
      },
      {
        method: "POST",
        path: "/api/v1/guardian/:scope/:subjectId/quarantine",
        description: "Quarantine a Guardian-controlled subject",
      },
      {
        method: "GET",
        path: "/api/v1/audit",
        description: "Query durable audit log (?subjectId=&source=&level=&kind=&from=&to=&limit=)",
      },
      { method: "GET", path: "/api/v1/audit/:subjectId", description: "Per-subject audit trail" },
      {
        method: "GET",
        path: "/api/v1/storage",
        description: "Object-storage backend status and registered volumes",
      },
      { method: "GET", path: "/api/v1/volumes", description: "List storage volumes" },
      { method: "POST", path: "/api/v1/volumes", description: "Provision a storage volume" },
      { method: "GET", path: "/api/v1/volumes/:volumeId", description: "Inspect a storage volume" },
      {
        method: "DELETE",
        path: "/api/v1/volumes/:volumeId",
        description: "Delete a storage volume",
      },
      {
        method: "GET",
        path: "/api/v1/storage/pools",
        description: "List local and federated shared storage pools",
      },
      {
        method: "POST",
        path: "/api/v1/storage/pools",
        description: "Register a shared storage pool (opt-in)",
      },
      {
        method: "GET",
        path: "/api/v1/storage/pools/:poolId",
        description: "Inspect a shared storage pool",
      },
      {
        method: "DELETE",
        path: "/api/v1/storage/pools/:poolId",
        description: "Remove a shared storage pool",
      },
      {
        method: "POST",
        path: "/api/v1/storage/pools/:poolId/heartbeat",
        description: "Update pool heartbeat",
      },
      {
        method: "POST",
        path: "/api/v1/storage/pools/:poolId/drain",
        description: "Drain a shared storage pool",
      },
      {
        method: "GET",
        path: "/api/v1/routes/tls-ask",
        description: "Caddy On-Demand TLS authorisation endpoint (?domain=)",
      },
      {
        method: "GET",
        path: "/api/v1/routes/zone",
        description: "BIND zone file for sovereign CoreDNS (RFC 1035)",
      },
      {
        method: "GET",
        path: "/.well-known/nexus-cloud",
        description: "Nexus Cloud discovery document",
      },
      {
        method: "GET",
        path: "/api/v1/dns/status",
        description: "Report DNS integration config (Cloudflare, server IP)",
      },
      {
        method: "POST",
        path: "/api/v1/dns/bootstrap",
        description: "Bootstrap Cloudflare CNAME records (root + wildcard) to the tunnel",
      },
      {
        method: "POST",
        path: "/api/v1/dns/custom-domain",
        description: "Publish a custom domain as a proxied CNAME to the tunnel",
      },
      {
        method: "POST",
        path: "/api/v1/deployments",
        description: "Request a managed Deploy deployment",
      },
      {
        method: "GET",
        path: "/api/v1/deployments/integration",
        description: "Inspect the Deploy backend integration",
      },
      {
        method: "POST",
        path: "/api/v1/auth/login",
        description: "Authenticate with Cloud-level credentials and receive a portal session token",
      },
      {
        method: "GET",
        path: "/api/v1/auth/me",
        description: "Validate a portal session token and return the authenticated user",
      },
    ];
    const actual = apiRouteManifest.map((route) => ({ ...route })) as any[];
    expect(actual).toEqual(expected as any[]);
  });
});

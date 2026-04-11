import { cloudConfig, isValidApiKey, requiresApiKey } from "../config";
import { architecture } from "../architecture";
import { controlPlane, controlPlaneService } from "../control-plane";
import { dataPlane } from "../data-plane";
import { federationService } from "../federation";
import { observabilityService } from "../observability";
import { storage } from "../storage";
import { systemsApiService, heartbeatSystemsApiTool, listSystemsApiRoutes, getCloudDomain } from "../systems-api";
import { describeSystemsApiDeployIntegration, systemsApiDeployIntegration } from "../systems-api/deploy";
import { bootstrapDns, hasCloudflareDns } from "../cloudflare-dns";
import { generateZoneFile } from "../dns-zone";
import { getNodeIdentity } from "../identity";
import { registerUser, listUsers } from "../users";
import { selfAnnouncement, handleInboundAnnouncement, type GossipAnnouncement } from "../federation";
import { apiRoutes } from "./index";
import {
  type ArchitectureResponse,
  type HealthResponse,
  type LegacyStatusResponse,
  type NodeListResponse,
  type PeerListResponse,
  type PlanWorkloadErrorResponse,
  type PlanWorkloadSuccessResponse,
  type RegisterNodeResponse,
  type StateResponse,
  type SystemsApiAddressesResponseDTO,
  type SystemsApiAddressRequestDTO,
  type SystemsApiAddressRevokeRequestDTO,
  type SystemsApiAddressResponseDTO,
  type SystemsApiAppsResponseDTO,
  type SystemsApiCapabilitiesResponseDTO,
  type SystemsApiConnectionsResponseDTO,
  type SystemsApiDeployRequestDTO,
  type SystemsApiDeployResponseDTO,
  type SystemsApiDomainBindingRequestDTO,
  type SystemsApiDomainResponseDTO,
  type SystemsApiDomainVerificationRequestDTO,
  type SystemsApiDomainVerificationResponseDTO,
  type SystemsApiEndpointsResponseDTO,
  type SystemsApiExposureRequestDTO,
  type SystemsApiExposureResponseDTO,
  type SystemsApiExposuresResponseDTO,
  type SystemsApiPublicUrlRequestDTO,
  type SystemsApiPublicUrlResponseDTO,
  type SystemsApiStatusResponseDTO,
  type SystemsApiSummaryResponseDTO,
  type SystemsApiTopologyResponseDTO,
  type SystemsApiToolHistoryResponseDTO,
  type SystemsApiToolPatchRequestDTO,
  type SystemsApiToolResponseDTO,
  type SystemsApiToolsResponseDTO,
  type TrustPeerResponse,
  type WorkloadListResponse,
  type SystemsApiRoutesResponseDTO,
  type SystemsApiToolRegistrationRequestDTO,
  isRegisterNodeRequest,
  isSystemsApiAddressRequest,
  isSystemsApiAddressRevokeRequest,
  isSystemsApiDeployRequest,
  isSystemsApiDomainBindingRequest,
  isSystemsApiDomainVerificationRequest,
  isSystemsApiExposureRequest,
  isSystemsApiNodeHeartbeatRequest,
  isSystemsApiPublicUrlRequest,
  isSystemsApiToolPatchRequest,
  isSystemsApiToolRegistrationRequest,
  isTrustPeerRequest,
  isWorkloadPlanRequest,
} from "./dto";
import {
  toSystemsApiDomainResourceDTO,
  toSystemsApiDomainResourcesResponseDTO,
  toSystemsApiExposureResourceDTO,
  toSystemsApiExposureResourcesResponseDTO,
  toSystemsApiExposureStatusResponseDTO,
  type SystemsApiExposureStatusResponseDTO,
} from "./exposure-dto";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": cloudConfig.corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders() });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}

function checkApiKey(request: Request): Response | null {
  if (!requiresApiKey()) return null;
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token || !isValidApiKey(token)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function handleHealth(): Response {
  const body: HealthResponse = {
    ok: true,
    project: architecture.project,
    services: {
      controlPlane: controlPlane.services,
      dataPlane: dataPlane.runtimes,
      federation: federationService.describeFederation(),
      observability: observabilityService.describeObservability(),
      storage: storage.classes.map((item) => item.name),
    },
  };
  return json(body);
}

function handleLegacyStatus(): Response {
  const snapshot = controlPlaneService.snapshot();
  const body: LegacyStatusResponse = {
    status: "online",
    project: architecture.project,
    storage_used_gb: snapshot.volumes.reduce((total, volume) => total + volume.sizeGb, 0),
    files_count: snapshot.volumes.length,
    federation_peers: snapshot.peers.length,
    nodes: snapshot.nodes.length,
    workloads: snapshot.workloads.length,
    tools: systemsApiService.listSystemsApiTools().length,
    public_urls: systemsApiService.listSystemsApiPublicUrls().length,
    updated_at: new Date().toISOString(),
  };
  return json(body);
}

function handleArchitecture(): Response {
  return json({ ...architecture, routes: apiRoutes });
}

function handleState(): Response {
  return json(controlPlaneService.snapshot());
}

function handleNodesList(): Response {
  const body: NodeListResponse = { nodes: controlPlaneService.listNodes() };
  return json(body);
}

async function handleNodeRegister(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isRegisterNodeRequest(body)) return badRequest("Missing node registration fields");
  const response: RegisterNodeResponse = { node: controlPlaneService.registerNode(body) };
  return json(response, 201);
}

function handleWorkloadsList(): Response {
  const body: WorkloadListResponse = { workloads: controlPlaneService.listWorkloads() };
  return json(body);
}

async function handleWorkloadPlan(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isWorkloadPlanRequest(body)) return badRequest("Missing workload fields");
  const result = controlPlaneService.planWorkload(body);
  if (!result.ok) {
    const response: PlanWorkloadErrorResponse = { error: result.error, policy: result.policy, quota: result.quota ?? null };
    return json(response, result.status);
  }
  const response: PlanWorkloadSuccessResponse = {
    workload: result.workload,
    plan: result.plan,
    policy: result.policy,
    quota: result.quota,
    ...(result.warning ? { warning: result.warning } : {}),
  };
  return json(response, result.status);
}

function handlePeersList(): Response {
  return json({ peers: federationService.listPeers() } satisfies PeerListResponse);
}

async function handlePeerTrust(request: Request, pathname: string): Promise<Response> {
  const domain = decodeURIComponent(pathname.slice("/v1/federation/peers/".length, -"/trust".length));
  if (!domain) return badRequest("Missing peer domain");
  const trust = await readJson(request);
  if (!isTrustPeerRequest(trust)) return badRequest("Missing trust fields");
  const response: TrustPeerResponse = { peer: federationService.trustPeer(domain, trust) };
  return json(response, 201);
}

function handleSystemsTools(): Response {
  return json({ tools: systemsApiService.listSystemsApiTools() } satisfies SystemsApiToolsResponseDTO);
}

function handleSystemsEndpoints(): Response {
  return json({ endpoints: systemsApiService.listSystemsApiEndpoints() } satisfies SystemsApiEndpointsResponseDTO);
}

function handleSystemsCapabilities(): Response {
  return json({ capabilities: systemsApiService.listSystemsApiCapabilities() } satisfies SystemsApiCapabilitiesResponseDTO);
}

function handleSystemsSummary(): Response {
  return json({ summary: systemsApiService.describeSystemsApi() } satisfies SystemsApiSummaryResponseDTO);
}

function handleSystemsDeployIntegration(): Response {
  return json({ integration: describeSystemsApiDeployIntegration() });
}

async function handleSystemsDeploy(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiDeployRequest(body)) return badRequest("Missing deploy fields");
  const authToken = request.headers.get("authorization")?.slice(7);
  if (!authToken) return json({ error: "Unauthorized" }, 401);
  const endpoint = systemsApiDeployIntegration.endpoint;
  const deployUrl = process.env.NEXUS_DEPLOY_URL?.replace(/\/$/, "") ?? "";
  if (!deployUrl) return json({ error: "Deploy backend not configured" }, 503);
  const response = await fetch(`${deployUrl}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as SystemsApiDeployResponseDTO | null;
  return json(data ?? { error: "Deploy backend returned an invalid response" }, response.status);
}

function handleSystemsTool(toolId: string): Response {
  const tool = systemsApiService.getSystemsApiTool(toolId);
  if (!tool) return notFound();
  return json({ tool } satisfies SystemsApiToolResponseDTO);
}

function handleSystemsToolHistory(toolId: string): Response {
  const tool = systemsApiService.getSystemsApiTool(toolId);
  if (!tool) return notFound();
  return json({ history: systemsApiService.listSystemsApiToolHistory(toolId) } satisfies SystemsApiToolHistoryResponseDTO);
}

async function handleSystemsToolPatch(request: Request, toolId: string): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiToolPatchRequest(body)) return badRequest("Missing tool metadata fields");
  if (body.name === undefined && body.description === undefined && body.mode === undefined && body.exposed === undefined && body.health === undefined && body.capabilities === undefined) {
    return badRequest("Empty tool metadata patch");
  }
  const tool = systemsApiService.updateSystemsApiTool(toolId, body as SystemsApiToolPatchRequestDTO);
  if (!tool) return notFound();
  return json({ tool } satisfies SystemsApiToolResponseDTO);
}

function handleSystemsToolEnable(toolId: string): Response {
  const tool = systemsApiService.enableSystemsApiTool(toolId);
  if (!tool) return notFound();
  return json({ tool } satisfies SystemsApiToolResponseDTO);
}

function handleSystemsToolDisable(toolId: string): Response {
  const tool = systemsApiService.disableSystemsApiTool(toolId);
  if (!tool) return notFound();
  return json({ tool } satisfies SystemsApiToolResponseDTO);
}

function handleSystemsStatus(): Response {
  const body: SystemsApiExposureStatusResponseDTO = toSystemsApiExposureStatusResponseDTO(
    systemsApiService.describeSystemsApiStatus(),
    systemsApiService.listSystemsApiTools(),
    systemsApiService.listSystemsApiPublicUrls(),
    systemsApiService.listSystemsApiExposures(),
    systemsApiService.listSystemsApiDomainBindings(),
  );
  return json(body);
}

async function handleSystemsPublicUrl(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiPublicUrlRequest(body)) return badRequest("Missing public URL fields");
  const publicUrl = systemsApiService.issueSystemsApiPublicUrl(body);
  if (!publicUrl) return json({ error: "Tool not found" }, 404);
  const tool = systemsApiService.getSystemsApiTool(body.toolId);
  if (!tool) return json({ error: "Tool not found" }, 404);
  const response: SystemsApiPublicUrlResponseDTO = { publicUrl, tool };
  return json(response, 201);
}

function handleSystemsAddresses(): Response {
  return json({ addresses: systemsApiService.listSystemsApiAddresses() } satisfies SystemsApiAddressesResponseDTO);
}

function handleSystemsAddressGet(toolId: string): Response {
  const addresses = systemsApiService.listSystemsApiAddressesForTool(toolId);
  if (!addresses.length) return notFound();
  const response: SystemsApiAddressesResponseDTO = { addresses };
  return json(response);
}

async function handleSystemsAddressPost(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiAddressRequest(body)) return badRequest("Missing address fields");
  const address = systemsApiService.requestSystemsApiAddress(body);
  if (!address) return notFound();
  const response: SystemsApiAddressResponseDTO = { address };
  return json(response, 201);
}

async function handleSystemsAddressRevoke(request: Request, toolId: string): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiAddressRevokeRequest(body)) return badRequest("Missing address revoke fields");
  const revoked = systemsApiService.revokeSystemsApiAddress({ toolId, kind: body.kind });
  return json({ addresses: revoked } satisfies SystemsApiAddressesResponseDTO);
}

function handleSystemsExposures(): Response {
  return json(toSystemsApiExposureResourcesResponseDTO(systemsApiService.listSystemsApiExposures()));
}

function handleSystemsExposureGet(toolId: string): Response {
  const exposure = systemsApiService.getSystemsApiExposure(toolId);
  if (!exposure) return notFound();
  return json({ exposure: toSystemsApiExposureResourceDTO(exposure) } satisfies SystemsApiExposureResponseDTO);
}

async function handleSystemsExposurePost(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiExposureRequest(body)) return badRequest("Missing exposure fields");
  const exposure = systemsApiService.requestSystemsApiExposure(body);
  if (!exposure) return notFound();
  return json({ exposure: toSystemsApiExposureResourceDTO(exposure) } satisfies SystemsApiExposureResponseDTO, 201);
}

function handleSystemsExposureRevoke(toolId: string): Response {
  const exposure = systemsApiService.revokeSystemsApiExposure(toolId);
  if (!exposure) return notFound();
  return json({ exposure: toSystemsApiExposureResourceDTO(exposure) } satisfies SystemsApiExposureResponseDTO);
}

function handleSystemsDomains(): Response {
  return json(toSystemsApiDomainResourcesResponseDTO(systemsApiService.listSystemsApiDomainBindings()));
}

async function handleSystemsDomainPost(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiDomainBindingRequest(body)) return badRequest("Missing domain binding fields");
  const domain = systemsApiService.requestSystemsApiDomainBinding(body);
  if (!domain) return notFound();
  return json({ domain: toSystemsApiDomainResourceDTO(domain) } satisfies SystemsApiDomainResponseDTO, 201);
}

function handleSystemsDomainGet(domain: string): Response {
  const binding = systemsApiService.getSystemsApiDomainBinding(domain);
  if (!binding) return notFound();
  return json({ domain: toSystemsApiDomainResourceDTO(binding) } satisfies SystemsApiDomainResponseDTO);
}

async function handleSystemsDomainVerify(request: Request, domain: string): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiDomainVerificationRequest(body)) return badRequest("Missing verification token");
  const verified = systemsApiService.verifySystemsApiDomain(domain, body.token);
  if (!verified) return notFound();
  const challenge = systemsApiService.getSystemsApiDomainVerification(domain);
  if (!challenge) return notFound();
  return json({ challenge } satisfies SystemsApiDomainVerificationResponseDTO);
}

function handleSystemsDomainDelete(domain: string): Response {
  const revoked = systemsApiService.revokeSystemsApiDomain(domain);
  if (!revoked) return notFound();
  return json({ domain: toSystemsApiDomainResourceDTO(revoked) } satisfies SystemsApiDomainResponseDTO);
}

async function handleSystemsToolRoute(request: Request, pathname: string): Promise<Response> {
  const prefix = "/api/v1/tools/";
  const suffix = pathname.slice(prefix.length);
  if (!suffix) return notFound();
  if (request.method === "GET" && suffix.endsWith("/history")) {
    const toolId = decodeURIComponent(suffix.slice(0, -"/history".length));
    return toolId ? handleSystemsToolHistory(toolId) : badRequest("Missing tool id");
  }
  if (request.method === "GET" && !suffix.includes("/")) return handleSystemsTool(decodeURIComponent(suffix));
  if (request.method === "PATCH" && !suffix.includes("/")) return handleSystemsToolPatch(request, decodeURIComponent(suffix));
  if (request.method === "POST" && suffix.endsWith("/enable")) {
    const toolId = decodeURIComponent(suffix.slice(0, -"/enable".length));
    return toolId ? handleSystemsToolEnable(toolId) : badRequest("Missing tool id");
  }
  if (request.method === "POST" && suffix.endsWith("/disable")) {
    const toolId = decodeURIComponent(suffix.slice(0, -"/disable".length));
    return toolId ? handleSystemsToolDisable(toolId) : badRequest("Missing tool id");
  }
  if (request.method === "POST" && suffix.endsWith("/heartbeat")) {
    const toolId = decodeURIComponent(suffix.slice(0, -"/heartbeat".length));
    return toolId ? handleToolHeartbeat(request, toolId) : badRequest("Missing tool id");
  }
  return notFound();
}

function handleSystemsRoutes(): Response {
  const domain = getCloudDomain();
  const routes = listSystemsApiRoutes();
  const body: SystemsApiRoutesResponseDTO = {
    domain,
    routes,
    count: routes.length,
    updatedAt: new Date().toISOString(),
  };
  return json(body);
}

function handleSystemsRoutesCaddy(): Response {
  const routes = listSystemsApiRoutes();
  const caddyRoutes = routes.map((route) => ({
    match: [{ host: [route.domain] }],
    handle: [{
      handler: "reverse_proxy",
      upstreams: [{ dial: route.upstream.replace(/^https?:\/\//, "") }],
    }],
  }));
  return json({ routes: caddyRoutes });
}

function handleFederationIdentity(): Response {
  const id = getNodeIdentity();
  return json({
    did: id.did,
    shortId: id.shortId,
    publicKey: id.publicKey,
    namingScheme: "@user:shortId",
    exampleAddress: `@alice:${id.shortId}`,
    addressNote:
      "Addresses are scoped to this node. Only the holder of this node's private key can issue credentials in this namespace — no registrar, no cost, no squatting possible.",
  });
}

function handleNodeAnnouncement(): Response {
  return json(selfAnnouncement());
}

async function handleInboundPeerAnnounce(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (
    typeof body !== "object" || body === null ||
    typeof (body as Record<string, unknown>)["did"] !== "string" ||
    typeof (body as Record<string, unknown>)["upstreamUrl"] !== "string"
  ) {
    return badRequest("Missing required fields: did, upstreamUrl");
  }
  const result = handleInboundAnnouncement(body as GossipAnnouncement);
  return json(result);
}

async function handleUserRegister(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (typeof body !== "object" || body === null || typeof (body as Record<string, unknown>)["username"] !== "string") {
    return badRequest("Missing required field: username");
  }
  const result = registerUser((body as Record<string, unknown>)["username"] as string);
  if (!result.ok) return badRequest(result.error);
  return json({ user: result.user }, 201);
}

function handleUserList(): Response {
  return json({ users: listUsers() });
}

function handleWellKnown(): Response {
  const domain = getCloudDomain();
  const cloudUrl = cloudConfig.cloudUrl || `https://${domain}`;
  const id = getNodeIdentity();
  return json({
    version: "v1",
    nodeId: id.did,
    shortId: id.shortId,
    namingScheme: "@user:shortId",
    domain,
    apiBase: cloudUrl,
    capabilities: [
      "address-issuance",
      "domain-binding",
      "exposure-registry",
      "routing-manifest",
      "tool-registry",
      "node-identity",
    ],
    endpoints: {
      register: "/api/v1/tools",
      heartbeat: "/api/v1/tools/:toolId/heartbeat",
      addresses: "/api/v1/addresses",
      exposures: "/api/v1/exposures",
      domains: "/api/v1/domains",
      publicUrl: "/api/v1/public-url",
      routes: "/api/v1/routes",
      routesCaddy: "/api/v1/routes/caddy",
      status: "/api/v1/status",
      topology: "/api/v1/topology",
      identity: "/v1/federation/identity",
    },
  });
}

async function handleToolHeartbeat(request: Request, toolId: string): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiNodeHeartbeatRequest(body)) return badRequest("Missing heartbeat fields");
  const tool = heartbeatSystemsApiTool(toolId, body);
  if (!tool) return notFound();
  return json({ tool } satisfies SystemsApiToolResponseDTO);
}

async function handleToolRegister(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiToolRegistrationRequest(body)) return badRequest("Missing tool registration fields");
  const tool = systemsApiService.registerSystemsApiTool(body as SystemsApiToolRegistrationRequestDTO);
  return json({ tool } satisfies SystemsApiToolResponseDTO, 201);
}

async function handleSystemsAddressRoute(request: Request, pathname: string): Promise<Response> {
  const prefix = "/api/v1/addresses/";
  const suffix = pathname.slice(prefix.length);
  if (!suffix) return notFound();
  if (request.method === "GET" && !suffix.includes("/")) return handleSystemsAddressGet(decodeURIComponent(suffix));
  if (request.method === "POST" && suffix.endsWith("/revoke")) {
    const toolId = decodeURIComponent(suffix.slice(0, -"/revoke".length));
    return handleSystemsAddressRevoke(request, toolId);
  }
  return notFound();
}

async function handleSystemsExposureRoute(request: Request, pathname: string): Promise<Response> {
  const prefix = "/api/v1/exposures/";
  const suffix = pathname.slice(prefix.length);
  if (!suffix) return notFound();
  if (request.method === "GET" && !suffix.includes("/")) return handleSystemsExposureGet(decodeURIComponent(suffix));
  if (request.method === "POST" && suffix.endsWith("/revoke")) {
    const toolId = decodeURIComponent(suffix.slice(0, -"/revoke".length));
    return toolId ? handleSystemsExposureRevoke(toolId) : badRequest("Missing tool id");
  }
  return notFound();
}

function handleSystemsApps(): Response {
  return json({ apps: systemsApiService.listSystemsApiApps() } satisfies SystemsApiAppsResponseDTO);
}

function handleSystemsConnections(): Response {
  return json({ connections: systemsApiService.listSystemsApiConnections() } satisfies SystemsApiConnectionsResponseDTO);
}

function handleSystemsTopology(): Response {
  return json({ topology: systemsApiService.describeSystemsApiTopology() } satisfies SystemsApiTopologyResponseDTO);
}

async function handleSystemsRoute(request: Request, pathname: string): Promise<Response> {
  if (request.method === "GET" && pathname === "/api/v1/apps") return handleSystemsApps();
  if (request.method === "GET" && pathname === "/api/v1/connections") return handleSystemsConnections();
  if (request.method === "GET" && pathname === "/api/v1/topology") return handleSystemsTopology();
  if (request.method === "GET" && pathname === "/api/v1/addresses") return handleSystemsAddresses();
  if (request.method === "POST" && pathname === "/api/v1/addresses") return handleSystemsAddressPost(request);
  if (pathname.startsWith("/api/v1/addresses/")) return await handleSystemsAddressRoute(request, pathname);
  if (request.method === "GET" && pathname === "/api/v1/exposures") return handleSystemsExposures();
  if (request.method === "POST" && pathname === "/api/v1/exposures") return handleSystemsExposurePost(request);
  if (pathname.startsWith("/api/v1/exposures/")) return await handleSystemsExposureRoute(request, pathname);
  if (request.method === "GET" && pathname === "/api/v1/domains") return handleSystemsDomains();
  if (request.method === "POST" && pathname === "/api/v1/domains") return handleSystemsDomainPost(request);
  if (pathname.startsWith("/api/v1/domains/")) {
    const suffix = pathname.slice("/api/v1/domains/".length);
    if (request.method === "GET" && !suffix.includes("/")) return handleSystemsDomainGet(decodeURIComponent(suffix));
    if (request.method === "POST" && suffix.endsWith("/verify")) {
      const domain = decodeURIComponent(suffix.slice(0, -"/verify".length));
      return handleSystemsDomainVerify(request, domain);
    }
    if (request.method === "DELETE" && !suffix.includes("/")) return handleSystemsDomainDelete(decodeURIComponent(suffix));
  }
  return notFound();
}

// ── Subdomain reverse proxy ────────────────────────────────────────────────────

async function proxyToUpstream(request: Request, upstream: string): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = new URL(url.pathname + url.search, upstream);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", "https");
  try {
    const res = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
    });
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch {
    return json({ error: "upstream unreachable" }, 502);
  }
}

async function handleSubdomainProxy(request: Request, host: string): Promise<Response> {
  const routes = listSystemsApiRoutes();
  const route = routes.find((r) => r.domain.toLowerCase() === host);
  if (!route) return json({ error: "no route for this domain" }, 404);
  return proxyToUpstream(request, route.upstream);
}

// ── DNS bootstrap and sovereign zone ────────────────────────────────────────────────

/**
 * POST /api/v1/dns/bootstrap
 * Idempotent: creates or updates the two mandatory A records on Cloudflare:
 *   nexus.cloud        → ip   (proxied)
 *   *.nexus.cloud      → ip   (not proxied — Caddy handles TLS)
 * Body: { ip?: string }  — falls back to SERVER_PUBLIC_IP env var.
 * Requires CF_API_TOKEN and CF_ZONE_ID to be set.
 */
async function handleDnsBootstrap(request: Request): Promise<Response> {
  if (!hasCloudflareDns()) {
    return json({ error: "CF_API_TOKEN and CF_ZONE_ID are not configured" }, 501);
  }
  const body = (await readJson(request)) as { ip?: string } | null;
  const result = await bootstrapDns(body?.ip);
  const ok = result.root.ok && result.wildcard.ok;
  return json({ ok, root: result.root, wildcard: result.wildcard }, ok ? 200 : 502);
}

/**
 * GET /api/v1/dns/status
 * Reports whether Cloudflare DNS integration is configured and what SERVER_PUBLIC_IP is set to.
 */
function handleDnsStatus(): Response {
  return json({
    cloudflareConfigured: hasCloudflareDns(),
    serverIp: cloudConfig.serverIp || null,
    cloudDomain: cloudConfig.cloudDomain,
  });
}

/**
 * GET /api/v1/routes/zone
 * Returns a BIND/RFC 1035 zone file for the cloud domain, suitable for CoreDNS
 * (sovereign mode) or any other authoritative nameserver.
 * CoreDNS is configured to poll this—or mount the zone from a shared volume.
 */
function handleZoneFile(): Response {
  const zone = generateZoneFile();
  return new Response(zone, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Caddy On-Demand TLS authorisation endpoint.
 * Caddy calls GET /api/v1/routes/tls-ask?domain=alice.nexus.cloud before issuing
 * a Let's Encrypt certificate for a new subdomain. Return 2xx to allow, 4xx to deny.
 * This prevents cert-bomb attacks and avoids issuing certs for unknown domains.
 */
function handleTlsAsk(searchParams: URLSearchParams): Response {
  const domain = searchParams.get("domain")?.trim().toLowerCase();
  if (!domain) return badRequest("domain query parameter required");
  const cloudDomain = cloudConfig.cloudDomain.toLowerCase();
  if (!domain.endsWith(`.${cloudDomain}`)) return json({ allowed: false }, 403);
  const routes = listSystemsApiRoutes();
  const allowed = routes.some((r) => r.domain.toLowerCase() === domain);
  if (!allowed) return json({ allowed: false }, 403);
  return json({ allowed: true });
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // Subdomain proxy: *.cloudDomain requests are routed to the registered upstream.
  // This runs before CORS and auth so the upstream handles its own CORS/auth headers.
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const cloudDomain = cloudConfig.cloudDomain.toLowerCase();
  if (host !== cloudDomain && host.endsWith(`.${cloudDomain}`)) {
    return handleSubdomainProxy(request, host);
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(), "Access-Control-Max-Age": "86400" },
    });
  }

  // Authenticate all mutating requests. /api/v1/deployments handles its own auth token.
  if (["POST", "PATCH", "DELETE"].includes(request.method) && pathname !== "/api/v1/deployments") {
    const authErr = checkApiKey(request);
    if (authErr) return authErr;
  }

  if (request.method === "GET" && pathname === "/health") return handleHealth();
  if (request.method === "GET" && pathname === "/api/status") return handleLegacyStatus();
  if (request.method === "GET" && pathname === "/v1/architecture") return handleArchitecture();
  if (request.method === "GET" && pathname === "/v1/state") return handleState();
  if (request.method === "GET" && pathname === "/v1/nodes") return handleNodesList();
  if (request.method === "POST" && pathname === "/v1/nodes/register") return handleNodeRegister(request);
  if (request.method === "GET" && pathname === "/v1/workloads") return handleWorkloadsList();
  if (request.method === "POST" && pathname === "/v1/workloads/plan") return handleWorkloadPlan(request);
  if (request.method === "GET" && pathname === "/v1/federation/peers") return handlePeersList();
  if (request.method === "POST" && pathname.startsWith("/v1/federation/peers/") && pathname.endsWith("/trust")) return handlePeerTrust(request, pathname);
  if (request.method === "GET" && pathname === "/v1/federation/identity") return handleFederationIdentity();
  if (request.method === "GET" && pathname === "/v1/federation/announcement") return handleNodeAnnouncement();
  if (request.method === "POST" && pathname === "/v1/federation/peers/announce") return handleInboundPeerAnnounce(request);
  if (request.method === "GET" && pathname === "/api/v1/users") return handleUserList();
  if (request.method === "POST" && pathname === "/api/v1/users") return handleUserRegister(request);
  if (request.method === "GET" && pathname === "/api/v1/tools") return handleSystemsTools();
  if (request.method === "POST" && pathname === "/api/v1/tools") return handleToolRegister(request);
  if (request.method === "GET" && pathname === "/api/v1/endpoints") return handleSystemsEndpoints();
  if (request.method === "GET" && pathname === "/api/v1/capabilities") return handleSystemsCapabilities();
  if (request.method === "GET" && pathname === "/api/v1/summary") return handleSystemsSummary();
  if (request.method === "GET" && pathname === "/api/v1/status") return handleSystemsStatus();
  if (request.method === "GET" && pathname === "/api/v1/routes") return handleSystemsRoutes();
  if (request.method === "GET" && pathname === "/api/v1/routes/caddy") return handleSystemsRoutesCaddy();
  if (request.method === "GET" && pathname === "/api/v1/routes/tls-ask") return handleTlsAsk(url.searchParams);
  if (request.method === "GET" && pathname === "/api/v1/routes/zone") return handleZoneFile();
  if (request.method === "GET" && pathname === "/.well-known/nexus-cloud") return handleWellKnown();
  if (request.method === "GET" && pathname === "/api/v1/dns/status") return handleDnsStatus();
  if (request.method === "POST" && pathname === "/api/v1/dns/bootstrap") return await handleDnsBootstrap(request);
  if (request.method === "GET" && pathname === "/api/v1/deployments/integration") return handleSystemsDeployIntegration();
  if (request.method === "POST" && pathname === "/api/v1/deployments") return handleSystemsDeploy(request);
  if (request.method === "POST" && pathname === "/api/v1/public-url") return handleSystemsPublicUrl(request);
  if (pathname.startsWith("/api/v1/tools/")) return await handleSystemsToolRoute(request, pathname);
  if (pathname === "/api/v1/apps" || pathname === "/api/v1/connections" || pathname === "/api/v1/topology" || pathname === "/api/v1/addresses" || pathname.startsWith("/api/v1/addresses/") || pathname === "/api/v1/exposures" || pathname.startsWith("/api/v1/exposures/") || pathname === "/api/v1/domains" || pathname.startsWith("/api/v1/domains/")) {
    return await handleSystemsRoute(request, pathname);
  }
  return notFound();
}

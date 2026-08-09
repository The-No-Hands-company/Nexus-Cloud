import { createHash } from "node:crypto";
import { architecture } from "../architecture";
import { type AuditFilter, queryAuditLog } from "../audit";
import { bootstrapDns, hasCloudflareDns, ensureCustomDomainDns, tunnelTarget } from "../cloudflare-dns";
import { cloudConfig, isValidApiKey, requiresApiKey } from "../config";
import { controlPlane, controlPlaneService } from "../control-plane";
import { dataPlane, dataPlaneService } from "../data-plane";
import { generateZoneFile } from "../dns-zone";
import { federationService } from "../federation";
import {
  type GossipAnnouncement,
  handleInboundAnnouncement,
  handleInboundBootstrapAnnouncement,
  selfAnnouncement,
} from "../federation";
import { guardianService } from "../guardian";
import { getNodeIdentity } from "../identity";
import { observabilityService, recordEvent } from "../observability";
import {
  checkStorageBackend,
  createVolume,
  deleteVolume,
  drainPool,
  getPool,
  getVolume,
  listFederatedPools,
  listPools,
  listVolumes,
  registerPool,
  removePool,
  storage,
  updatePoolHeartbeat,
} from "../storage";
import {
  getCloudDomain,
  heartbeatSystemsApiTool,
  listSystemsApiRoutes,
  systemsApiService,
} from "../systems-api";
import {
  describeSystemsApiDeployIntegration,
  systemsApiDeployIntegration,
} from "../systems-api/deploy";
import {
  NexusAuthUnavailable,
  checkSession,
  listUsers as listNexusAuthUsers,
  login as nexusAuthLogin,
  logout as nexusAuthLogout,
  nexusAuthUrl,
} from "../nexus-auth";
import {
  type GuardianDecisionResponse,
  type GuardianDecisionsResponse,
  type HealthResponse,
  type LegacyStatusResponse,
  type NodeListResponse,
  type NodeTrustActionRequestDTO,
  type NodeTrustBulkAction,
  type NodeTrustBulkResponseDTO,
  type NodeTrustBulkResultDTO,
  type PeerListResponse,
  type PlanWorkloadErrorResponse,
  type PlanWorkloadSuccessResponse,
  type RegisterNodeResponse,
  type SystemsApiAddressResponseDTO,
  type SystemsApiAddressesResponseDTO,
  type SystemsApiAppsResponseDTO,
  type SystemsApiCapabilitiesResponseDTO,
  type SystemsApiConnectionsResponseDTO,
  type SystemsApiDeployResponseDTO,
  type SystemsApiDomainResponseDTO,
  type SystemsApiDomainVerificationResponseDTO,
  type SystemsApiEndpointsResponseDTO,
  type SystemsApiExposureResponseDTO,
  type SystemsApiPhantomComplianceResponseDTO,
  type SystemsApiPhantomComplianceSummaryResponseDTO,
  type SystemsApiPublicUrlResponseDTO,
  type SystemsApiRoutesResponseDTO,
  type SystemsApiSummaryResponseDTO,
  type SystemsApiToolHistoryResponseDTO,
  type SystemsApiToolPatchRequestDTO,
  type SystemsApiToolRegistrationRequestDTO,
  type SystemsApiToolResponseDTO,
  type SystemsApiToolsResponseDTO,
  type SystemsApiTopologyResponseDTO,
  type SystemsApiTrustSummaryResponseDTO,
  type TrustPeerResponse,
  type WorkloadListResponse,
  type WorkloadRunResponse,
  type WorkloadStopResponse,
  isNodeTrustActionRequest,
  isNodeTrustBulkRequest,
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
  type SystemsApiExposureStatusResponseDTO,
  toSystemsApiDomainResourceDTO,
  toSystemsApiDomainResourcesResponseDTO,
  toSystemsApiExposureResourceDTO,
  toSystemsApiExposureResourcesResponseDTO,
  toSystemsApiExposureStatusResponseDTO,
} from "./exposure-dto";
import { apiRoutes } from "./index";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": cloudConfig.corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return Response.json(data, { status, headers: { ...corsHeaders(), ...extraHeaders } });
}

const SESSION_COOKIE = "nexus_session";

/**
 * The caller's credential, however it arrived. Browsers cannot set an
 * Authorization header on a navigation, so the shared cookie is what actually
 * turns up from the dashboard and from other apps on the parent domain.
 */
function callerCredential(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === SESSION_COOKIE) {
        const value = decodeURIComponent(part.slice(eq + 1).trim());
        if (value) return value;
      }
    }
  }
  return null;
}

function jsonWithConditionalEtag(request: Request, data: unknown, status = 200): Response {
  const body = JSON.stringify(data);
  const etag = `W/\"${createHash("sha1").update(body).digest("hex")}\"`;
  const ifNoneMatch = request.headers.get("if-none-match")?.trim();
  if (ifNoneMatch === etag || ifNoneMatch === "*") {
    return new Response(null, {
      status: 304,
      headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "no-store" },
    });
  }

  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ETag: etag,
    },
  });
}

function resolveAuditActor(request: Request): string {
  const explicitActor =
    request.headers.get("x-nexus-actor")?.trim() || request.headers.get("x-actor")?.trim();
  if (explicitActor) return explicitActor;
  return "system:api-key";
}

function appendNodeTrustAuditEvent(params: {
  action: NodeTrustBulkAction;
  actor: string;
  nodeId: string;
  previousState: string;
  nextState: string;
  reason: string;
}): void {
  const timestamp = new Date().toISOString();
  recordEvent({
    kind: "audit",
    source: "control-plane",
    level: params.action === "promote" ? "info" : params.action === "quarantine" ? "warn" : "error",
    subjectId: params.nodeId,
    message: `Node trust ${params.action}: ${params.previousState} -> ${params.nextState}`,
    timestamp,
    metadata: {
      eventType: "node-trust-action",
      action: params.action,
      actor: params.actor,
      previousState: params.previousState,
      nextState: params.nextState,
      reason: params.reason,
    },
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}

/**
 * GET endpoints that disclose internal topology and therefore require the API
 * key, even though they only read. `tls-ask` is intentionally absent — Caddy
 * cannot authenticate during a handshake. See the gate in `handleApiRequest`.
 */
const TOPOLOGY_READ_PATHS: ReadonlySet<string> = new Set([
  "/api/v1/routes",
  "/api/v1/routes/caddy",
  "/api/v1/routes/zone",
]);

/**
 * True when the caller has proved identity — a valid API key, or a dashboard
 * session from /api/v1/auth/login. Used to decide whether a response may carry
 * internal topology.
 *
 * When no API key is configured `requiresApiKey()` is false and auth is disabled
 * instance-wide, so there is nothing to redact against; that is the local-dev
 * shape and the dashboard must keep working there.
 */
async function callerIsAuthenticated(request: Request): Promise<boolean> {
  if (!requiresApiKey()) return true;
  if (checkApiKey(request) === null) return true;
  const credential = callerCredential(request);
  if (!credential) return false;
  try {
    return (await checkSession(credential)) !== null;
  } catch {
    // Identity service down: treat as unauthenticated so topology stays
    // redacted. Failing open here would leak upstream addresses precisely when
    // the ecosystem is already degraded.
    return false;
  }
}

/**
 * Remove backend addresses from tools bound for an anonymous caller.
 *
 * `upstreamUrl` is the private host:port a tool actually runs on. Cloud answers
 * publicly on cloud.<cloudDomain> and status.html reads /api/v1/tools and
 * /api/v1/status without credentials, so returning the field unconditionally
 * published the internal address of every backend — the same disclosure the
 * /api/v1/routes gate closes, one endpoint away. The rest of each tool record is
 * what the public dashboard renders, so only this field is dropped.
 */
function redactUpstreams<T extends { upstreamUrl?: string }>(
  tools: readonly T[],
  authenticated: boolean,
): readonly T[] {
  if (authenticated) return tools;
  return tools.map(({ upstreamUrl: _dropped, ...rest }) => rest as T);
}

/**
 * Remove pool credentials and backend addresses from storage pools bound for an
 * anonymous caller.
 *
 * `GET /api/v1/storage/pools` answers on the public cloud subdomain and had no
 * auth check at all, so it published each pool's `accessKey` and `secretKey`
 * verbatim to anyone who asked — the whole point of a shared pool is that it
 * holds other people's data. It is contained today only because the one pool
 * points at 127.0.0.1 with the MinIO defaults, but federation exists precisely
 * to make pools reachable and their credentials real, at which point this
 * endpoint hands them out. `endpoint` goes too: it is a private address, the
 * same disclosure redactUpstreams closes for tools.
 *
 * Peers that need these fields authenticate; the public dashboard does not read
 * this endpoint at all.
 */
function redactPoolSecrets<T extends { accessKey?: string; secretKey?: string; endpoint?: string }>(
  pools: readonly T[],
  authenticated: boolean,
): readonly T[] {
  if (authenticated) return pools;
  return pools.map(
    ({ accessKey: _key, secretKey: _secret, endpoint: _endpoint, ...rest }) => rest as T,
  );
}

function checkApiKey(request: Request): Response | null {
  if (!requiresApiKey()) return null;
  const header = request.headers.get("authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const apiKeyHeader = request.headers.get("x-api-key")?.trim() || null;
  const token = bearerToken || apiKeyHeader;
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

// ── Portal auth helpers ───────────────────────────────────────────────────────

async function handleAuthLogin(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return badRequest("Missing credentials");
  const { username, password } = body as { username?: string; password?: string };

  if (!username || !password) {
    return json({ error: "Invalid credentials" }, 401);
  }

  // Proxied, not verified here: Cloud holds no accounts. Relaying Set-Cookie
  // verbatim is what makes this the ecosystem session rather than a Cloud-local
  // one — the cookie carries Nexus-Auth's own Domain, so Deploy and Vault
  // accept it too.
  try {
    const upstream = await nexusAuthLogin(username, password);
    const headers = upstream.setCookie ? { "set-cookie": upstream.setCookie } : undefined;
    return json(upstream.body, upstream.status, headers);
  } catch (err) {
    if (err instanceof NexusAuthUnavailable) {
      return json(
        { error: "Identity service unavailable", hint: err.message },
        503,
      );
    }
    throw err;
  }
}

async function handleAuthMe(request: Request): Promise<Response> {
  const credential = callerCredential(request);
  if (!credential) return json({ error: "Unauthorized" }, 401);
  try {
    const user = await checkSession(credential);
    if (!user) return json({ error: "Unauthorized" }, 401);
    return json({ user });
  } catch (err) {
    if (err instanceof NexusAuthUnavailable) {
      return json({ error: "Identity service unavailable", hint: err.message }, 503);
    }
    throw err;
  }
}

async function handleAuthLogout(request: Request): Promise<Response> {
  const credential = callerCredential(request);
  if (!credential) return json({ error: "Unauthorized" }, 401);
  try {
    const upstream = await nexusAuthLogout(credential);
    const headers = upstream.setCookie ? { "set-cookie": upstream.setCookie } : undefined;
    return json({ success: upstream.status === 200 }, upstream.status, headers);
  } catch (err) {
    if (err instanceof NexusAuthUnavailable) {
      return json({ error: "Identity service unavailable", hint: err.message }, 503);
    }
    throw err;
  }
}

function handleDashboard(): Response {
  const html = Bun.file(new URL("../../public/status.html", import.meta.url));
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() },
  });
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
  const status = systemsApiService.describeSystemsApiStatus();
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
    node_trust_summary: status.trust.nodes,
    peer_trust_summary: status.trust.peers,
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

async function handleNodeTrustAction(request: Request, pathname: string): Promise<Response> {
  const trustPrefix = "/v1/nodes/";
  if (!pathname.startsWith(trustPrefix) || !pathname.includes("/trust/")) return notFound();
  const nodeAndAction = pathname.slice(trustPrefix.length);
  const splitAt = nodeAndAction.indexOf("/trust/");
  if (splitAt <= 0) return badRequest("Missing node id");

  const nodeId = decodeURIComponent(nodeAndAction.slice(0, splitAt));
  const action = nodeAndAction.slice(splitAt + "/trust/".length);
  if (!nodeId) return badRequest("Missing node id");

  const body = await readJson(request);
  if (body !== null && !isNodeTrustActionRequest(body))
    return badRequest("Invalid trust action payload");
  const reason = (body as NodeTrustActionRequestDTO | null)?.reason?.trim() || "operator-action";
  const actor = resolveAuditActor(request);
  const before = controlPlaneService.getNode(nodeId);
  if (!before) return notFound();

  const node =
    action === "promote"
      ? controlPlaneService.promoteNodeTrust(nodeId)
      : action === "quarantine"
        ? controlPlaneService.quarantineNodeTrust(nodeId)
        : action === "revoke"
          ? controlPlaneService.revokeNodeTrust(nodeId)
          : null;

  if (action !== "promote" && action !== "quarantine" && action !== "revoke") {
    return badRequest("Unsupported trust action");
  }
  if (!node) return notFound();

  appendNodeTrustAuditEvent({
    action: action as NodeTrustBulkAction,
    actor,
    nodeId,
    previousState: before.trustState,
    nextState: node.trustState,
    reason,
  });

  return json({ node } satisfies RegisterNodeResponse);
}

async function handleNodeTrustBulk(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isNodeTrustBulkRequest(body)) return badRequest("Missing bulk trust operations");

  const actor = resolveAuditActor(request);
  const results: NodeTrustBulkResultDTO[] = body.operations.map((operation) => {
    const existing = controlPlaneService.getNode(operation.nodeId);
    if (!existing) {
      return {
        nodeId: operation.nodeId,
        action: operation.action,
        ok: false,
        error: "Node not found",
        reasonCode: "NODE_NOT_FOUND",
      };
    }

    const node =
      operation.action === "promote"
        ? controlPlaneService.promoteNodeTrust(operation.nodeId)
        : operation.action === "quarantine"
          ? controlPlaneService.quarantineNodeTrust(operation.nodeId)
          : controlPlaneService.revokeNodeTrust(operation.nodeId);

    if (!node) {
      return {
        nodeId: operation.nodeId,
        action: operation.action,
        ok: false,
        error: "Node not found",
        reasonCode: "NODE_NOT_FOUND",
      };
    }

    appendNodeTrustAuditEvent({
      action: operation.action,
      actor,
      nodeId: operation.nodeId,
      previousState: existing.trustState,
      nextState: node.trustState,
      reason: operation.reason?.trim() || "operator-action",
    });

    return {
      nodeId: operation.nodeId,
      action: operation.action,
      ok: true,
      node,
    };
  });

  const summary = {
    total: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  };

  return json({ results, summary } satisfies NodeTrustBulkResponseDTO);
}

function handleWorkloadsList(): Response {
  const body: WorkloadListResponse = { workloads: controlPlaneService.listWorkloads() };
  return json(body);
}

function handleWorkloadRun(workloadId: string): Response {
  const result = dataPlaneService.runWorkload(workloadId);
  if (!result) return notFound();
  return json(result satisfies WorkloadRunResponse, result.ok ? 201 : 503);
}

function handleWorkloadStop(workloadId: string): Response {
  const units = dataPlaneService.stopWorkload(workloadId);
  return json({ units } satisfies WorkloadStopResponse);
}

async function handleWorkloadPlan(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isWorkloadPlanRequest(body)) return badRequest("Missing workload fields");
  const result = controlPlaneService.planWorkload(body);
  if (!result.ok) {
    const response: PlanWorkloadErrorResponse = {
      error: result.error,
      policy: result.policy,
      quota: result.quota ?? null,
    };
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
  const domain = decodeURIComponent(
    pathname.slice("/v1/federation/peers/".length, -"/trust".length),
  );
  if (!domain) return badRequest("Missing peer domain");
  const trust = await readJson(request);
  if (!isTrustPeerRequest(trust)) return badRequest("Missing trust fields");
  const response: TrustPeerResponse = { peer: federationService.trustPeer(domain, trust) };
  return json(response, 201);
}

function parsePhantomComplianceFilter(url: URL): "all" | "failing" {
  return url.searchParams.get("phantomCompliance") === "failing" ||
    url.searchParams.get("status") === "failing"
    ? "failing"
    : "all";
}

function parseStatusCompactMode(url: URL): "none" | "trust" {
  return url.searchParams.get("compact") === "trust" ? "trust" : "none";
}

function collectPhantomComplianceEntries(filter: "all" | "failing") {
  const status = systemsApiService.describeSystemsApiStatus();
  const _toolsById = new Map(
    systemsApiService.listSystemsApiTools().map((tool) => [tool.id, tool] as const),
  );
  const failureByToolId = new Map(
    status.integrationFailures.map((failure) => [failure.toolId, failure] as const),
  );
  const claimedTools = systemsApiService
    .listSystemsApiTools()
    .filter((tool) => tool.phantomSecurityProfile?.claimedSecured);

  const entries = claimedTools
    .map((tool) => {
      const failure = failureByToolId.get(tool.id);
      return {
        tool,
        compliant: !failure,
        ...(failure ? { failure } : {}),
      };
    })
    .filter((entry) => filter === "all" || !entry.compliant);

  return { status, entries, failures: status.integrationFailures };
}

async function handleSystemsTools(request: Request, url: URL): Promise<Response> {
  const authenticated = await callerIsAuthenticated(request);
  const filter = parsePhantomComplianceFilter(url);
  if (filter === "all") {
    return json({
      tools: redactUpstreams(systemsApiService.listSystemsApiTools(), authenticated),
    } satisfies SystemsApiToolsResponseDTO);
  }

  const { entries } = collectPhantomComplianceEntries("failing");
  return json({
    tools: redactUpstreams(entries.map((entry) => entry.tool), authenticated),
  } satisfies SystemsApiToolsResponseDTO);
}

function handleSystemsEndpoints(): Response {
  return json({
    endpoints: systemsApiService.listSystemsApiEndpoints(),
  } satisfies SystemsApiEndpointsResponseDTO);
}

function handleSystemsCapabilities(): Response {
  return json({
    capabilities: systemsApiService.listSystemsApiCapabilities(),
  } satisfies SystemsApiCapabilitiesResponseDTO);
}

function handleSystemsSummary(): Response {
  return json({
    summary: systemsApiService.describeSystemsApi(),
  } satisfies SystemsApiSummaryResponseDTO);
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
  return json({
    history: systemsApiService.listSystemsApiToolHistory(toolId),
  } satisfies SystemsApiToolHistoryResponseDTO);
}

async function handleSystemsToolPatch(request: Request, toolId: string): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiToolPatchRequest(body)) return badRequest("Missing tool metadata fields");
  if (
    body.name === undefined &&
    body.description === undefined &&
    body.mode === undefined &&
    body.exposed === undefined &&
    body.health === undefined &&
    body.capabilities === undefined &&
    body.upstreamUrl === undefined &&
    body.phantomSecurityProfile === undefined
  ) {
    return badRequest("Empty tool metadata patch");
  }
  const tool = systemsApiService.updateSystemsApiTool(
    toolId,
    body as SystemsApiToolPatchRequestDTO,
  );
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

async function handleSystemsStatus(request: Request, url: URL): Promise<Response> {
  if (parseStatusCompactMode(url) === "trust") {
    const status = systemsApiService.describeSystemsApiStatus();
    const compactBody: SystemsApiTrustSummaryResponseDTO = {
      scope: "trust-lifecycle",
      trust: status.trust,
    };
    return jsonWithConditionalEtag(request, compactBody);
  }

  const filter = parsePhantomComplianceFilter(url);
  const tools = redactUpstreams(
    filter === "failing"
      ? collectPhantomComplianceEntries("failing").entries.map((entry) => entry.tool)
      : systemsApiService.listSystemsApiTools(),
    await callerIsAuthenticated(request),
  );
  const body: SystemsApiExposureStatusResponseDTO = toSystemsApiExposureStatusResponseDTO(
    systemsApiService.describeSystemsApiStatus(),
    tools,
    systemsApiService.listSystemsApiPublicUrls(),
    systemsApiService.listSystemsApiExposures(),
    systemsApiService.listSystemsApiDomainBindings(),
  );
  return jsonWithConditionalEtag(request, body);
}

function handleSystemsPhantomCompliance(url: URL): Response {
  const filter = parsePhantomComplianceFilter(url);
  const { status, entries, failures } = collectPhantomComplianceEntries(filter);
  const body: SystemsApiPhantomComplianceResponseDTO = {
    scope: "phantom-security",
    status: status.integrationStatus,
    count: entries.length,
    failingCount: failures.length,
    entries,
    failures,
    updatedAt: new Date().toISOString(),
  };
  return json(body);
}

function handleSystemsPhantomComplianceSummary(request: Request): Response {
  const status = systemsApiService.describeSystemsApiStatus();
  const body: SystemsApiPhantomComplianceSummaryResponseDTO = {
    scope: "phantom-security",
    status: status.integrationStatus,
    claimedSecuredCount: status.phantomSecuredClaimedCount,
    compliantCount: status.phantomSecuredCompliantCount,
    failingCount: status.failedIntegrationCount,
    updatedAt: new Date().toISOString(),
  };
  return jsonWithConditionalEtag(request, body);
}

function handleSystemsTrustSummary(request: Request): Response {
  const status = systemsApiService.describeSystemsApiStatus();
  const body: SystemsApiTrustSummaryResponseDTO = {
    scope: "trust-lifecycle",
    trust: status.trust,
  };
  return jsonWithConditionalEtag(request, body);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

/**
 * Query the durable NDJSON audit log.
 * Accepted query parameters: subjectId, source, level, kind, from, to, eventType, action, actor, limit.
 */
function handleAuditQuery(url: URL, subjectIdOverride?: string): Response {
  const q = url.searchParams;
  const filter: AuditFilter = {};
  const subjectId = subjectIdOverride ?? q.get("subjectId") ?? undefined;
  if (subjectId !== undefined) filter.subjectId = subjectId;
  const source = q.get("source");
  if (source !== null) filter.source = source;
  const level = q.get("level");
  if (level !== null) filter.level = level;
  const kind = q.get("kind");
  if (kind !== null) filter.kind = kind;
  const from = q.get("from");
  if (from !== null) filter.from = from;
  const to = q.get("to");
  if (to !== null) filter.to = to;
  const eventType = q.get("eventType");
  if (eventType !== null) filter.eventType = eventType;
  const action = q.get("action");
  if (action !== null) filter.action = action;
  const actor = q.get("actor");
  if (actor !== null) filter.actor = actor;
  const rawLimit = q.get("limit");
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isNaN(parsed) && parsed > 0) filter.limit = parsed;
  }
  const events = queryAuditLog(filter);
  return json({ events, count: events.length });
}

function handleGuardianDecisions(): Response {
  return json({
    decisions: guardianService.listGuardianDecisions(),
  } satisfies GuardianDecisionsResponse);
}

function handleGuardianDecisionAction(pathname: string): Response {
  const suffix = pathname.slice("/api/v1/guardian/".length);
  const [scope, encodedSubjectId, action] = suffix.split("/");
  const subjectId = decodeURIComponent(encodedSubjectId ?? "");
  if (!scope || !subjectId || !action) return notFound();
  const typedScope =
    scope === "exposure" || scope === "domain" || scope === "runtime" ? scope : null;
  if (!typedScope) return notFound();
  const decision =
    action === "approve"
      ? guardianService.approveGuardianDecision(typedScope, subjectId)
      : action === "deny"
        ? guardianService.denyGuardianDecision(typedScope, subjectId)
        : action === "suspend"
          ? guardianService.suspendGuardianDecision(typedScope, subjectId)
          : action === "quarantine"
            ? guardianService.quarantineGuardianDecision(typedScope, subjectId)
            : null;
  if (!decision) return notFound();
  return json({ decision } satisfies GuardianDecisionResponse);
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
  return json({
    addresses: systemsApiService.listSystemsApiAddresses(),
  } satisfies SystemsApiAddressesResponseDTO);
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
  const revoked = systemsApiService.revokeSystemsApiAddress({
    toolId,
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
  });
  return json({ addresses: revoked } satisfies SystemsApiAddressesResponseDTO);
}

function handleSystemsExposures(): Response {
  return json(
    toSystemsApiExposureResourcesResponseDTO(systemsApiService.listSystemsApiExposures()),
  );
}

function handleSystemsExposureGet(toolId: string): Response {
  const exposure = systemsApiService.getSystemsApiExposure(toolId);
  if (!exposure) return notFound();
  return json({
    exposure: toSystemsApiExposureResourceDTO(exposure),
  } satisfies SystemsApiExposureResponseDTO);
}

async function handleSystemsExposurePost(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiExposureRequest(body)) return badRequest("Missing exposure fields");
  const exposure = systemsApiService.requestSystemsApiExposure(body);
  if (!exposure) return notFound();
  return json(
    { exposure: toSystemsApiExposureResourceDTO(exposure) } satisfies SystemsApiExposureResponseDTO,
    201,
  );
}

function handleSystemsExposureRevoke(toolId: string): Response {
  const exposure = systemsApiService.revokeSystemsApiExposure(toolId);
  if (!exposure) return notFound();
  return json({
    exposure: toSystemsApiExposureResourceDTO(exposure),
  } satisfies SystemsApiExposureResponseDTO);
}

function handleSystemsDomains(): Response {
  return json(
    toSystemsApiDomainResourcesResponseDTO(systemsApiService.listSystemsApiDomainBindings()),
  );
}

async function handleSystemsDomainPost(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isSystemsApiDomainBindingRequest(body)) return badRequest("Missing domain binding fields");
  const domain = systemsApiService.requestSystemsApiDomainBinding(body);
  if (!domain) return notFound();
  return json(
    { domain: toSystemsApiDomainResourceDTO(domain) } satisfies SystemsApiDomainResponseDTO,
    201,
  );
}

function handleSystemsDomainGet(domain: string): Response {
  const binding = systemsApiService.getSystemsApiDomainBinding(domain);
  if (!binding) return notFound();
  return json({
    domain: toSystemsApiDomainResourceDTO(binding),
  } satisfies SystemsApiDomainResponseDTO);
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
  return json({
    domain: toSystemsApiDomainResourceDTO(revoked),
  } satisfies SystemsApiDomainResponseDTO);
}

async function handleSystemsToolRoute(request: Request, pathname: string): Promise<Response> {
  const prefix = "/api/v1/tools/";
  const suffix = pathname.slice(prefix.length);
  if (!suffix) return notFound();
  if (request.method === "GET" && suffix.endsWith("/history")) {
    const toolId = decodeURIComponent(suffix.slice(0, -"/history".length));
    return toolId ? handleSystemsToolHistory(toolId) : badRequest("Missing tool id");
  }
  if (request.method === "GET" && !suffix.includes("/"))
    return handleSystemsTool(decodeURIComponent(suffix));
  if (request.method === "PATCH" && !suffix.includes("/"))
    return handleSystemsToolPatch(request, decodeURIComponent(suffix));
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
  if (request.method === "DELETE" && !suffix.includes("/")) {
    const toolId = decodeURIComponent(suffix);
    const tool = systemsApiService.deregisterSystemsApiTool(toolId);
    if (!tool) return notFound();
    return json({ tool });
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
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: route.upstream.replace(/^https?:\/\//, "") }],
      },
    ],
  }));
  return json({ routes: caddyRoutes });
}

function handleFederationIdentity(): Response {
  const id = getNodeIdentity();
  return json({
    did: id.did,
    shortId: id.shortId,
    publicKey: id.did,
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
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>)["did"] !== "string" ||
    typeof (body as Record<string, unknown>)["upstreamUrl"] !== "string"
  ) {
    return badRequest("Missing required fields: did, upstreamUrl");
  }
  const announcement = body as GossipAnnouncement;

  const bootstrapPeers = (process.env["BOOTSTRAP_PEERS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isBootstrapPeer = bootstrapPeers.some((peerUrl) => {
    try {
      return new URL(peerUrl).host === new URL(announcement.upstreamUrl).host;
    } catch {
      return false;
    }
  });

  if (isBootstrapPeer) {
    const result = handleInboundBootstrapAnnouncement(announcement);
    return json(result);
  }

  const trustDecision = federationService.authorizeFederatedPeerAction(announcement.upstreamUrl);
  if (!trustDecision.allowed) {
    return json(
      {
        error: trustDecision.reason,
        reasonCode: trustDecision.reasonCode,
        requiredTrust: trustDecision.requiredTrust,
        peerTrustState: trustDecision.peerTrustState ?? "unregistered",
      },
      403,
    );
  }

  const result = handleInboundAnnouncement(announcement);
  return json(result);
}

async function handleUserRegister(_request: Request): Promise<Response> {
  // Cloud does not create identities. Answering 410 rather than 404 tells an
  // older client where accounts actually live.
  return json(
    {
      error: "Account creation has moved to Nexus-Auth",
      hint: "One account covers the whole ecosystem.",
      register: `${nexusAuthUrl}/api/v1/auth/users`,
    },
    410,
  );
}

async function handleUserList(request: Request): Promise<Response> {
  const credential = callerCredential(request);
  if (!credential) return json({ error: "Unauthorized" }, 401);
  try {
    const upstream = await listNexusAuthUsers(credential);
    return json(upstream.body, upstream.status);
  } catch (err) {
    if (err instanceof NexusAuthUnavailable) {
      return json({ error: "Identity service unavailable", hint: err.message }, 503);
    }
    throw err;
  }
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
      compliance: "/api/v1/compliance/phantom",
      complianceSummary: "/api/v1/compliance/phantom/summary",
      trustSummary: "/api/v1/trust/summary",
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
  if (!isSystemsApiToolRegistrationRequest(body))
    return badRequest("Missing tool registration fields");
  const tool = systemsApiService.registerSystemsApiTool(
    body as SystemsApiToolRegistrationRequestDTO,
  );
  return json({ tool } satisfies SystemsApiToolResponseDTO, 201);
}

async function handleSystemsAddressRoute(request: Request, pathname: string): Promise<Response> {
  const prefix = "/api/v1/addresses/";
  const suffix = pathname.slice(prefix.length);
  if (!suffix) return notFound();
  if (request.method === "GET" && !suffix.includes("/"))
    return handleSystemsAddressGet(decodeURIComponent(suffix));
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
  if (request.method === "GET" && !suffix.includes("/"))
    return handleSystemsExposureGet(decodeURIComponent(suffix));
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
  return json({
    connections: systemsApiService.listSystemsApiConnections(),
  } satisfies SystemsApiConnectionsResponseDTO);
}

function handleSystemsTopology(): Response {
  return json({
    topology: systemsApiService.describeSystemsApiTopology(),
  } satisfies SystemsApiTopologyResponseDTO);
}

async function handleSystemsRoute(request: Request, pathname: string): Promise<Response> {
  if (request.method === "GET" && pathname === "/api/v1/apps") return handleSystemsApps();
  if (request.method === "GET" && pathname === "/api/v1/connections")
    return handleSystemsConnections();
  if (request.method === "GET" && pathname === "/api/v1/topology") return handleSystemsTopology();
  if (request.method === "GET" && pathname === "/api/v1/addresses") return handleSystemsAddresses();
  if (request.method === "POST" && pathname === "/api/v1/addresses")
    return handleSystemsAddressPost(request);
  if (pathname.startsWith("/api/v1/addresses/"))
    return await handleSystemsAddressRoute(request, pathname);
  if (request.method === "GET" && pathname === "/api/v1/exposures") return handleSystemsExposures();
  if (request.method === "POST" && pathname === "/api/v1/exposures")
    return handleSystemsExposurePost(request);
  if (pathname.startsWith("/api/v1/exposures/"))
    return await handleSystemsExposureRoute(request, pathname);
  if (request.method === "GET" && pathname === "/api/v1/domains") return handleSystemsDomains();
  if (request.method === "POST" && pathname === "/api/v1/domains")
    return handleSystemsDomainPost(request);
  if (pathname.startsWith("/api/v1/domains/")) {
    const suffix = pathname.slice("/api/v1/domains/".length);
    if (request.method === "GET" && !suffix.includes("/"))
      return handleSystemsDomainGet(decodeURIComponent(suffix));
    if (request.method === "POST" && suffix.endsWith("/verify")) {
      const domain = decodeURIComponent(suffix.slice(0, -"/verify".length));
      return handleSystemsDomainVerify(request, domain);
    }
    if (request.method === "DELETE" && !suffix.includes("/"))
      return handleSystemsDomainDelete(decodeURIComponent(suffix));
  }
  return notFound();
}

// ── Storage backend & volumes ──────────────────────────────────────────────────

function handleStorageStatus(): Promise<Response> {
  const backend = checkStorageBackend();
  return backend.then((status) =>
    json({
      classes: storage.classes,
      backend: status,
      volumes: listVolumes(),
    }),
  );
}

export function handleStorageList(): Response {
  return json({ volumes: listVolumes() });
}

export async function handleStorageVolumeCreate(request: Request): Promise<Response> {
  const body = (await readJson(request)) as Partial<{
    name: string;
    className: string;
    sizeGb: number;
  }> | null;
  if (!body?.name) return badRequest("Missing required field: name");
  const volume = await createVolume({
    name: body.name,
    ...(body.className !== undefined ? { className: body.className } : {}),
    ...(body.sizeGb !== undefined ? { sizeGb: body.sizeGb } : {}),
  });
  return json({ volume }, volume.status === "provisioned" ? 201 : 202);
}

export function handleStorageVolumeGet(pathname: string): Response {
  const id = decodeURIComponent(pathname.slice("/api/v1/volumes/".length));
  if (!id || id.includes("/")) return notFound();
  const volume = getVolume(id);
  if (!volume) return json({ error: "volume not found" }, 404);
  return json({ volume });
}

export function handleStorageVolumeDelete(pathname: string): Response {
  const id = decodeURIComponent(pathname.slice("/api/v1/volumes/".length));
  if (!id || id.includes("/")) return notFound();
  return deleteVolume(id) ? json({ ok: true }) : json({ error: "volume not found" }, 404);
}

// ── Shared Storage Pool Management ──────────────────────────────────────────────

async function handleStoragePoolsList(request: Request): Promise<Response> {
  const authenticated = await callerIsAuthenticated(request);
  const localPools = listPools();
  const federatedPools = await listFederatedPools();
  return json({
    pools: redactPoolSecrets(localPools, authenticated),
    federatedPools: redactPoolSecrets(federatedPools, authenticated),
  });
}

async function handleStoragePoolCreate(request: Request): Promise<Response> {
  const body = (await readJson(request)) as Partial<{
    name: string;
    totalCapacityGb: number;
    tags: string[];
    replicationFactor: number;
  }> | null;
  if (!body?.name) return badRequest("Missing required field: name");
  if (!body?.totalCapacityGb || body.totalCapacityGb < 1)
    return badRequest("totalCapacityGb must be >= 1");

  const identity = getNodeIdentity();
  const pool = await registerPool(
    {
      name: body.name,
      totalCapacityGb: body.totalCapacityGb,
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.replicationFactor !== undefined
        ? { replicationFactor: body.replicationFactor }
        : {}),
    },
    identity.shortId,
    identity.did,
  );
  return json({ pool }, 201);
}

async function handleStoragePoolGet(pathname: string): Promise<Response> {
  const id = decodeURIComponent(pathname.slice("/api/v1/storage/pools/".length));
  if (!id || id.includes("/")) return notFound();
  const pool = getPool(id);
  if (!pool) return json({ error: "pool not found" }, 404);
  return json({ pool });
}

async function handleStoragePoolDelete(pathname: string): Promise<Response> {
  const id = decodeURIComponent(pathname.slice("/api/v1/storage/pools/".length));
  if (!id || id.includes("/")) return notFound();
  return removePool(id) ? json({ ok: true }) : json({ error: "pool not found" }, 404);
}

async function handleStoragePoolHeartbeat(pathname: string): Promise<Response> {
  const id = decodeURIComponent(
    pathname.slice("/api/v1/storage/pools/".length, -"/heartbeat".length),
  );
  if (!id || id.includes("/")) return notFound();
  const pool = updatePoolHeartbeat(id);
  if (!pool) return json({ error: "pool not found" }, 404);
  return json({ pool });
}

async function handleStoragePoolDrain(pathname: string): Promise<Response> {
  const id = decodeURIComponent(pathname.slice("/api/v1/storage/pools/".length, -"/drain".length));
  if (!id || id.includes("/")) return notFound();
  const pool = drainPool(id);
  if (!pool) return json({ error: "pool not found" }, 404);
  return json({ pool });
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
 * Idempotent: creates or updates the node's own root and wildcard as proxied
 * CNAMEs to the tunnel:
 *   <cloudDomain>    → <tunnel-id>.cfargotunnel.com  (proxied)
 *   *.<cloudDomain>  → <tunnel-id>.cfargotunnel.com  (proxied)
 * Requires CF_API_TOKEN, CF_ZONE_ID, and NEXUS_TUNNEL_ID (or
 * NEXUS_TUNNEL_CNAME_TARGET) to be set.
 */
async function handleDnsBootstrap(_request: Request): Promise<Response> {
  if (!hasCloudflareDns()) {
    return json({ error: "CF_API_TOKEN and NEXUS_TUNNEL_ID are not configured" }, 501);
  }
  const result = await bootstrapDns();
  const ok = result.root.ok && result.wildcard.ok;
  return json({ ok, root: result.root, wildcard: result.wildcard }, ok ? 200 : 502);
}

/**
 * POST /api/v1/dns/custom-domain
 * Publish a custom domain (outside the *.<cloudDomain> wildcard) as a proxied
 * CNAME to the tunnel, discovering the owning zone from the token's scope.
 * Body: { host: string }. Idempotent. Returns 403 with outOfScope=true when the
 * token cannot see the host's zone — the operator must add that zone to the
 * token, or the domain owner must point their own DNS at the tunnel.
 */
async function handleDnsCustomDomain(request: Request): Promise<Response> {
  const body = (await readJson(request)) as { host?: string } | null;
  const host = body?.host?.trim().toLowerCase();
  if (!host || !/^(?=.{1,253}$)([a-z0-9](-*[a-z0-9])*\.)+[a-z]{2,}$/.test(host)) {
    return json({ error: "a valid 'host' is required" }, 400);
  }
  const result = await ensureCustomDomainDns(host);
  const status = result.ok
    ? 200
    : result.outOfScope
      ? 403
      : result.status && result.status >= 400
        ? result.status
        : 502;
  return json(result, status);
}

/**
 * GET /api/v1/dns/status
 * Reports whether Cloudflare DNS integration is configured and the tunnel target
 * every hostname is published against.
 */
function handleDnsStatus(): Response {
  return json({
    cloudflareConfigured: hasCloudflareDns(),
    tunnelTarget: tunnelTarget() || null,
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

  if (request.method === "GET" && pathname === "/api/v1/storage") return handleStorageStatus();
  if (request.method === "GET" && pathname === "/api/v1/volumes") return handleStorageList();
  if (request.method === "POST" && pathname === "/api/v1/volumes")
    return handleStorageVolumeCreate(request);
  if (request.method === "GET" && pathname.startsWith("/api/v1/volumes/"))
    return handleStorageVolumeGet(pathname);
  if (request.method === "DELETE" && pathname.startsWith("/api/v1/volumes/"))
    return handleStorageVolumeDelete(pathname);
  if (request.method === "GET" && pathname === "/api/v1/storage/pools")
    return handleStoragePoolsList(request);
  if (request.method === "POST" && pathname === "/api/v1/storage/pools")
    return handleStoragePoolCreate(request);
  if (
    request.method === "GET" &&
    pathname.startsWith("/api/v1/storage/pools/") &&
    pathname.endsWith("/heartbeat")
  )
    return handleStoragePoolHeartbeat(pathname);
  if (
    request.method === "POST" &&
    pathname.startsWith("/api/v1/storage/pools/") &&
    pathname.endsWith("/drain")
  )
    return handleStoragePoolDrain(pathname);
  if (request.method === "GET" && pathname.startsWith("/api/v1/storage/pools/"))
    return handleStoragePoolGet(pathname);
  if (request.method === "DELETE" && pathname.startsWith("/api/v1/storage/pools/"))
    return handleStoragePoolDelete(pathname);

  // Subdomain proxy: *.cloudDomain requests are routed to the registered upstream.
  // This runs before CORS and auth so the upstream handles its own CORS/auth headers.
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0] ?? "";
  const cloudDomain = cloudConfig.cloudDomain.toLowerCase();
  const cloudOwnHost = `cloud.${cloudDomain}`;
  if (host !== cloudDomain && host !== cloudOwnHost && host.endsWith(`.${cloudDomain}`)) {
    return handleSubdomainProxy(request, host);
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(), "Access-Control-Max-Age": "86400" },
    });
  }

  // Authenticate all mutating requests, except the handful that authenticate
  // themselves:
  //   /api/v1/deployments — carries its own deploy token
  //   /api/v1/auth/login  — is the act of authenticating
  //   /api/v1/auth/logout — authenticates by session, and gating it behind the
  //                         API key made logout impossible for a signed-in user,
  //                         leaving the session alive everywhere
  //   /api/v1/users       — no longer creates anything; it answers 410 pointing
  //                         at Nexus-Auth, which a caller should see rather than
  //                         a 401 implying the endpoint still works
  const SELF_AUTHENTICATING = new Set([
    "/api/v1/deployments",
    "/api/v1/auth/login",
    "/api/v1/auth/logout",
    "/api/v1/users",
  ]);
  if (["POST", "PATCH", "DELETE"].includes(request.method) && !SELF_AUTHENTICATING.has(pathname)) {
    const authErr = checkApiKey(request);
    if (authErr) return authErr;
  }

  // Authenticate the read-only endpoints that hand out internal topology: the
  // domain -> upstream host:port table for every active route, the Caddy config
  // generated from it, and the DNS zone naming every subdomain. Cloud answers
  // publicly on cloud.<cloudDomain>, so anonymous reads there would publish the
  // private address of every backend in the deployment.
  //
  // /api/v1/routes/tls-ask deliberately stays open: Caddy calls it during a TLS
  // handshake and cannot present a credential, and its answer only confirms
  // allow/deny for a name the caller already supplied.
  if (request.method === "GET" && TOPOLOGY_READ_PATHS.has(pathname)) {
    const authErr = checkApiKey(request);
    if (authErr) return authErr;
  }

  if (request.method === "POST" && pathname === "/api/v1/auth/login")
    return handleAuthLogin(request);
  if (request.method === "POST" && pathname === "/api/v1/auth/logout")
    return handleAuthLogout(request);
  if (request.method === "GET" && pathname === "/api/v1/auth/me")
    return handleAuthMe(request);
  if (request.method === "GET" && (pathname === "/" || pathname === "/status"))
    return handleDashboard();
  if (request.method === "GET" && pathname === "/health") return handleHealth();
  if (request.method === "GET" && pathname === "/api/status") return handleLegacyStatus();
  if (request.method === "GET" && pathname === "/v1/architecture") return handleArchitecture();
  if (request.method === "GET" && pathname === "/v1/state") return handleState();
  if (request.method === "GET" && pathname === "/v1/nodes") return handleNodesList();
  if (request.method === "POST" && pathname === "/v1/nodes/register")
    return handleNodeRegister(request);
  if (request.method === "POST" && pathname === "/v1/nodes/trust/bulk")
    return handleNodeTrustBulk(request);
  if (
    request.method === "POST" &&
    pathname.startsWith("/v1/nodes/") &&
    pathname.includes("/trust/")
  )
    return handleNodeTrustAction(request, pathname);
  if (request.method === "GET" && pathname === "/v1/workloads") return handleWorkloadsList();
  if (request.method === "POST" && pathname === "/v1/workloads/plan")
    return handleWorkloadPlan(request);
  if (
    request.method === "POST" &&
    pathname.startsWith("/v1/workloads/") &&
    pathname.endsWith("/run")
  )
    return handleWorkloadRun(
      decodeURIComponent(pathname.slice("/v1/workloads/".length, -"/run".length)),
    );
  if (
    request.method === "POST" &&
    pathname.startsWith("/v1/workloads/") &&
    pathname.endsWith("/stop")
  )
    return handleWorkloadStop(
      decodeURIComponent(pathname.slice("/v1/workloads/".length, -"/stop".length)),
    );
  if (request.method === "GET" && pathname === "/v1/federation/peers") return handlePeersList();
  if (
    request.method === "POST" &&
    pathname.startsWith("/v1/federation/peers/") &&
    pathname.endsWith("/trust")
  )
    return handlePeerTrust(request, pathname);
  if (request.method === "GET" && pathname === "/v1/federation/identity")
    return handleFederationIdentity();
  if (request.method === "GET" && pathname === "/v1/federation/announcement")
    return handleNodeAnnouncement();
  if (request.method === "POST" && pathname === "/v1/federation/peers/announce")
    return handleInboundPeerAnnounce(request);
  if (request.method === "GET" && pathname === "/api/v1/users")
    return handleUserList(request);
  if (request.method === "POST" && pathname === "/api/v1/users")
    return handleUserRegister(request);
  if (request.method === "GET" && pathname === "/api/v1/tools")
    return handleSystemsTools(request, url);
  if (request.method === "POST" && pathname === "/api/v1/tools") return handleToolRegister(request);
  if (request.method === "GET" && pathname === "/api/v1/endpoints") return handleSystemsEndpoints();
  if (request.method === "GET" && pathname === "/api/v1/capabilities")
    return handleSystemsCapabilities();
  if (request.method === "GET" && pathname === "/api/v1/summary") return handleSystemsSummary();
  if (request.method === "GET" && pathname === "/api/v1/status")
    return handleSystemsStatus(request, url);
  if (request.method === "GET" && pathname === "/api/v1/compliance/phantom")
    return handleSystemsPhantomCompliance(url);
  if (request.method === "GET" && pathname === "/api/v1/compliance/phantom/summary")
    return handleSystemsPhantomComplianceSummary(request);
  if (request.method === "GET" && pathname === "/api/v1/trust/summary")
    return handleSystemsTrustSummary(request);
  if (request.method === "GET" && pathname === "/api/v1/routes") return handleSystemsRoutes();
  if (request.method === "GET" && pathname === "/api/v1/routes/caddy")
    return handleSystemsRoutesCaddy();
  if (request.method === "GET" && pathname === "/api/v1/guardian/decisions")
    return handleGuardianDecisions();
  if (request.method === "POST" && pathname.startsWith("/api/v1/guardian/"))
    return handleGuardianDecisionAction(pathname);
  if (request.method === "GET" && pathname === "/api/v1/audit") return handleAuditQuery(url);
  if (request.method === "GET" && pathname.startsWith("/api/v1/audit/")) {
    const subjectId = decodeURIComponent(pathname.slice("/api/v1/audit/".length));
    return subjectId ? handleAuditQuery(url, subjectId) : badRequest("Missing subjectId");
  }
  if (request.method === "GET" && pathname === "/api/v1/routes/tls-ask")
    return handleTlsAsk(url.searchParams);
  if (request.method === "GET" && pathname === "/api/v1/routes/zone") return handleZoneFile();
  if (request.method === "GET" && pathname === "/.well-known/nexus-cloud") return handleWellKnown();
  if (request.method === "GET" && pathname === "/api/v1/dns/status") return handleDnsStatus();
  if (request.method === "POST" && pathname === "/api/v1/dns/bootstrap")
    return await handleDnsBootstrap(request);
  if (request.method === "POST" && pathname === "/api/v1/dns/custom-domain")
    return await handleDnsCustomDomain(request);
  if (request.method === "GET" && pathname === "/api/v1/deployments/integration")
    return handleSystemsDeployIntegration();
  if (request.method === "POST" && pathname === "/api/v1/deployments")
    return handleSystemsDeploy(request);
  if (request.method === "POST" && pathname === "/api/v1/public-url")
    return handleSystemsPublicUrl(request);
  if (pathname.startsWith("/api/v1/tools/")) return await handleSystemsToolRoute(request, pathname);
  if (
    pathname === "/api/v1/apps" ||
    pathname === "/api/v1/connections" ||
    pathname === "/api/v1/topology" ||
    pathname === "/api/v1/addresses" ||
    pathname.startsWith("/api/v1/addresses/") ||
    pathname === "/api/v1/exposures" ||
    pathname.startsWith("/api/v1/exposures/") ||
    pathname === "/api/v1/domains" ||
    pathname.startsWith("/api/v1/domains/")
  ) {
    return await handleSystemsRoute(request, pathname);
  }
  return notFound();
}

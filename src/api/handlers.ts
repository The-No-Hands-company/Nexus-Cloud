import { architecture } from "../architecture";
import { controlPlane, controlPlaneService } from "../control-plane";
import { dataPlane } from "../data-plane";
import { federationService } from "../federation";
import { observabilityService } from "../observability";
import { storage } from "../storage";
import { apiRoutes } from "./index";
import {
  type ArchitectureResponse,
  type HealthResponse,
  type NodeListResponse,
  type PeerListResponse,
  type PlanWorkloadErrorResponse,
  type PlanWorkloadSuccessResponse,
  type RegisterNodeResponse,
  type StateResponse,
  type TrustPeerResponse,
  type WorkloadListResponse,
  isRegisterNodeRequest,
  isTrustPeerRequest,
  isWorkloadPlanRequest,
} from "./dto";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
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

function handleArchitecture(): Response {
  const body: ArchitectureResponse = {
    ...architecture,
    routes: apiRoutes,
  };

  return json(body);
}

function handleState(): Response {
  const body: StateResponse = controlPlaneService.snapshot();
  return json(body);
}

function handleNodesList(): Response {
  const body: NodeListResponse = { nodes: controlPlaneService.listNodes() };
  return json(body);
}

async function handleNodeRegister(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isRegisterNodeRequest(body)) {
    return badRequest("Missing node registration fields");
  }

  const response: RegisterNodeResponse = { node: controlPlaneService.registerNode(body) };
  return json(response, 201);
}

function handleWorkloadsList(): Response {
  const body: WorkloadListResponse = { workloads: controlPlaneService.listWorkloads() };
  return json(body);
}

async function handleWorkloadPlan(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isWorkloadPlanRequest(body)) {
    return badRequest("Missing workload fields");
  }

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
  const body: PeerListResponse = { peers: federationService.listPeers() };
  return json(body);
}

async function handlePeerTrust(request: Request, pathname: string): Promise<Response> {
  const domain = decodeURIComponent(pathname.slice("/v1/federation/peers/".length, -"/trust".length));
  if (!domain) {
    return badRequest("Missing peer domain");
  }

  const trust = await readJson(request);
  if (!isTrustPeerRequest(trust)) {
    return badRequest("Missing trust fields");
  }

  const response: TrustPeerResponse = { peer: federationService.trustPeer(domain, trust) };
  return json(response, 201);
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/health") return handleHealth();
  if (request.method === "GET" && pathname === "/v1/architecture") return handleArchitecture();
  if (request.method === "GET" && pathname === "/v1/state") return handleState();
  if (request.method === "GET" && pathname === "/v1/nodes") return handleNodesList();
  if (request.method === "POST" && pathname === "/v1/nodes/register") return handleNodeRegister(request);
  if (request.method === "GET" && pathname === "/v1/workloads") return handleWorkloadsList();
  if (request.method === "POST" && pathname === "/v1/workloads/plan") return handleWorkloadPlan(request);
  if (request.method === "GET" && pathname === "/v1/federation/peers") return handlePeersList();
  if (request.method === "POST" && pathname.startsWith("/v1/federation/peers/") && pathname.endsWith("/trust")) {
    return handlePeerTrust(request, pathname);
  }

  return notFound();
}

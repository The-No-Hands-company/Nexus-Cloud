import type { ArchitectureLayer } from "../architecture";
import type { FederationTrust } from "../architecture";
import type { NodeCapacity, NodeRegistrationRequest, NodeSpec, PlacementPlan, WorkloadSpec } from "../control-plane";
import type { PolicyDecision } from "../control-plane/policy";
import type { QuotaDecision } from "../control-plane/quota";
import type { FederationPeer, FederationSignedRequest } from "../federation";
import type { FederationSummary } from "../federation/service";
import type { ObservabilityEvent } from "../observability";
import type { ObservabilitySummary } from "../observability/service";
import type { StorageVolume } from "../storage";

export type ApiRoute = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
};

export type HealthResponse = {
  ok: true;
  project: string;
  services: {
    controlPlane: readonly string[];
    dataPlane: readonly string[];
    federation: FederationSummary;
    observability: ObservabilitySummary;
    storage: readonly string[];
  };
};

export type ArchitectureResponse = {
  project: string;
  mission: string;
  principles: readonly string[];
  layers: readonly ArchitectureLayer[];
  routes: readonly ApiRoute[];
};

export type StateResponse = {
  nodes: readonly NodeSpec[];
  workloads: readonly WorkloadSpec[];
  peers: readonly FederationPeer[];
  events: readonly ObservabilityEvent[];
  volumes: readonly StorageVolume[];
};

export type NodeListResponse = {
  nodes: readonly NodeSpec[];
};

export type WorkloadListResponse = {
  workloads: readonly WorkloadSpec[];
};

export type PeerListResponse = {
  peers: readonly FederationPeer[];
};

export type RegisterNodeResponse = {
  node: NodeSpec;
};

export type TrustPeerResponse = {
  peer: FederationPeer;
};

export type PlanWorkloadSuccessResponse = {
  workload: WorkloadSpec;
  plan: PlacementPlan;
  policy: PolicyDecision;
  quota: QuotaDecision;
  warning?: string;
};

export type PlanWorkloadErrorResponse = {
  error: string;
  policy: PolicyDecision;
  quota: QuotaDecision | null;
};

export type PlanWorkloadResponse = PlanWorkloadSuccessResponse | PlanWorkloadErrorResponse;

export type RegisterNodeRequestDTO = NodeRegistrationRequest;
export type WorkloadPlanRequestDTO = WorkloadSpec;
export type TrustPeerRequestDTO = FederationSignedRequest;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

function isNodeCapacity(value: unknown): value is NodeCapacity {
  return isRecord(value) && isNumber(value.cpu) && isNumber(value.memoryMb) && isNumber(value.storageGb) && (value.publicIpv4 === undefined || isString(value.publicIpv4));
}

export function isRegisterNodeRequest(value: unknown): value is RegisterNodeRequestDTO {
  return isRecord(value) && isString(value.name) && isString(value.region) && isString(value.zone) && (value.labels === undefined || isStringRecord(value.labels)) && isNodeCapacity(value.capacity);
}

export function isWorkloadPlanRequest(value: unknown): value is WorkloadPlanRequestDTO {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.image)
    && isNumber(value.replicas)
    && isNumber(value.cpuMillicores)
    && isNumber(value.memoryMb)
    && isStringRecord(value.env)
    && Array.isArray(value.ports) && value.ports.every(isNumber)
    && (value.runtime === "container" || value.runtime === "vm" || value.runtime === "function")
    && Array.isArray(value.storage) && value.storage.every(isString);
}

export function isTrustPeerRequest(value: unknown): value is TrustPeerRequestDTO {
  return isRecord(value)
    && isString(value.method)
    && isString(value.path)
    && isString(value.host)
    && isString(value.timestamp)
    && isString(value.nonce)
    && isString(value.keyId)
    && isString(value.signature);
}

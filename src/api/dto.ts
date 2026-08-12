import type { ArchitectureLayer } from "../architecture";
import type {
  NodeCapacity,
  NodeRegistrationRequest,
  NodeSpec,
  PlacementPlan,
  WorkloadSpec,
} from "../control-plane";
import type { PolicyDecision } from "../control-plane/policy";
import type { QuotaDecision } from "../control-plane/quota";
import type { DataPlaneUnit } from "../data-plane";
import type { FederationPeer, FederationSignedRequest } from "../federation";
import type { FederationSummary } from "../federation/service";
import type { HealthCheck, ObservabilityEvent } from "../observability";
import type { ObservabilitySummary } from "../observability/service";
import type { GuardianDecision } from "../state";
import type { StorageVolume } from "../storage";
import type {
  SystemsApiAddress,
  SystemsApiAddressKind,
  SystemsApiApp,
  SystemsApiCapability,
  SystemsApiConnection,
  SystemsApiDeployRequest,
  SystemsApiDeployResponse,
  SystemsApiDomainVerificationChallenge,
  SystemsApiEndpoint,
  SystemsApiIntegrationFailure,
  SystemsApiMode,
  SystemsApiPhantomSecurityProfile,
  SystemsApiPublicUrl,
  SystemsApiRegistryMetadata,
  SystemsApiRoute,
  SystemsApiStatus,
  SystemsApiSummary,
  SystemsApiTool,
  SystemsApiToolHealth,
  SystemsApiToolHistoryEntry,
  SystemsApiTopology,
} from "../systems-api";
import type {
  SystemsApiDomainResponseDTO as SystemsApiDomainResourceDTO,
  SystemsApiExposureResourceDTO,
  SystemsApiExposureResourcesResponseDTO,
} from "./exposure-dto";

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

export type LegacyStatusResponse = {
  status: "online";
  project: string;
  storage_used_gb: number;
  files_count: number;
  federation_peers: number;
  nodes: number;
  workloads: number;
  tools: number;
  public_urls: number;
  node_trust_summary: SystemsApiStatus["trust"]["nodes"];
  peer_trust_summary: SystemsApiStatus["trust"]["peers"];
  updated_at: string;
};

export type StateResponse = {
  nodes: readonly NodeSpec[];
  workloads: readonly WorkloadSpec[];
  peers: readonly FederationPeer[];
  events: readonly ObservabilityEvent[];
  volumes: readonly StorageVolume[];
  units: readonly DataPlaneUnit[];
  healthChecks: readonly HealthCheck[];
  guardianDecisions: readonly GuardianDecision[];
};

export type NodeListResponse = {
  nodes: readonly NodeSpec[];
};

export type WorkloadListResponse = {
  workloads: readonly WorkloadSpec[];
};

export type WorkloadRunResponse = {
  ok: boolean;
  unit: DataPlaneUnit;
  provider?: "docker" | "podman";
  error?: string;
};

export type WorkloadStopResponse = {
  units: readonly DataPlaneUnit[];
};

export type GuardianDecisionsResponse = {
  decisions: readonly GuardianDecision[];
};

export type GuardianDecisionResponse = {
  decision: GuardianDecision;
};

export type PeerListResponse = {
  peers: readonly FederationPeer[];
};

export type RegisterNodeResponse = {
  node: NodeSpec;
};

export type NodeTrustActionRequestDTO = {
  reason?: string;
};

export type NodeTrustBulkAction = "promote" | "quarantine" | "revoke";

export type NodeTrustBulkOperationDTO = {
  nodeId: string;
  action: NodeTrustBulkAction;
  reason?: string;
};

export type NodeTrustBulkRequestDTO = {
  operations: readonly NodeTrustBulkOperationDTO[];
};

export type NodeTrustBulkResultDTO = {
  nodeId: string;
  action: NodeTrustBulkAction;
  ok: boolean;
  node?: NodeSpec;
  error?: string;
  reasonCode?: "NODE_NOT_FOUND";
};

export type NodeTrustBulkResponseDTO = {
  results: readonly NodeTrustBulkResultDTO[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
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

export type SystemsApiToolsResponseDTO = {
  tools: readonly SystemsApiTool[];
};

export type SystemsApiToolResponseDTO = {
  tool: SystemsApiTool;
};

export type SystemsApiToolHistoryResponseDTO = {
  history: readonly SystemsApiToolHistoryEntry[];
};

export type SystemsApiAppsResponseDTO = {
  apps: readonly SystemsApiApp[];
};

export type SystemsApiConnectionsResponseDTO = {
  connections: readonly SystemsApiConnection[];
};

export type SystemsApiTopologyResponseDTO = {
  topology: SystemsApiTopology;
};

export type SystemsApiStatusResponseDTO = {
  status: SystemsApiStatus;
  tools: readonly SystemsApiTool[];
  publicUrls: readonly SystemsApiPublicUrl[];
};

export type SystemsApiPhantomComplianceToolDTO = {
  tool: SystemsApiTool;
  compliant: boolean;
  failure?: SystemsApiIntegrationFailure;
};

export type SystemsApiPhantomComplianceResponseDTO = {
  scope: "phantom-security";
  status: SystemsApiStatus["integrationStatus"];
  count: number;
  failingCount: number;
  entries: readonly SystemsApiPhantomComplianceToolDTO[];
  failures: readonly SystemsApiIntegrationFailure[];
  updatedAt: string;
};

export type SystemsApiPhantomComplianceSummaryResponseDTO = {
  scope: "phantom-security";
  status: SystemsApiStatus["integrationStatus"];
  claimedSecuredCount: number;
  compliantCount: number;
  failingCount: number;
  updatedAt: string;
};

export type SystemsApiTrustSummaryResponseDTO = {
  scope: "trust-lifecycle";
  trust: SystemsApiStatus["trust"];
};

export type SystemsApiEndpointsResponseDTO = {
  endpoints: readonly SystemsApiEndpoint[];
};

export type SystemsApiCapabilitiesResponseDTO = {
  capabilities: readonly SystemsApiCapability[];
};

export type SystemsApiSummaryResponseDTO = {
  summary: SystemsApiSummary;
};

export type SystemsApiRegistryMetadataResponseDTO = {
  registry: SystemsApiRegistryMetadata;
};

export type SystemsApiPublicUrlRequestDTO = {
  toolId: string;
  desiredHost?: string;
  refresh?: boolean;
};

export type SystemsApiPublicUrlResponseDTO = {
  publicUrl: SystemsApiPublicUrl;
  tool: SystemsApiTool;
};

export type SystemsApiAddressRequestDTO = {
  toolId: string;
  kind: SystemsApiAddressKind;
  subject?: string;
  desiredHost?: string;
};

export type SystemsApiAddressRevokeRequestDTO = {
  toolId: string;
  kind?: SystemsApiAddressKind;
};

export type SystemsApiAddressesResponseDTO = {
  addresses: readonly SystemsApiAddress[];
};

export type SystemsApiAddressResponseDTO = {
  address: SystemsApiAddress;
};

export type SystemsApiExposureRequestDTO = {
  toolId: string;
  desiredHost?: string;
};

export type SystemsApiExposureResponseDTO = {
  exposure: SystemsApiExposureResourceDTO;
};

export type SystemsApiExposuresResponseDTO = SystemsApiExposureResourcesResponseDTO;

export type SystemsApiDomainBindingRequestDTO = {
  toolId: string;
  domain: string;
  desiredHost?: string;
};

export type SystemsApiDomainResponseDTO = SystemsApiDomainResourceDTO;

export type SystemsApiDomainVerificationRequestDTO = {
  domain: string;
  token: string;
};

export type SystemsApiDomainVerificationResponseDTO = {
  challenge: SystemsApiDomainVerificationChallenge;
};

export type SystemsApiToolPatchRequestDTO = {
  name?: string;
  description?: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: SystemsApiToolHealth;
  capabilities?: readonly string[];
  /** Update the backend URL used by the proxy routing table */
  upstreamUrl?: string;
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  /**
   * Require an ecosystem sign-in before the proxy forwards to this tool.
   * Only settable here, on the API-key-guarded operator patch — never from a
   * tool's own registration, which it repeats on every restart and heartbeat.
   */
  requiresAuth?: boolean;
};

/** Register (or upsert) a tool with Nexus Cloud */
export type SystemsApiToolRegistrationRequestDTO = {
  id: string;
  name: string;
  description: string;
  upstreamUrl?: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: SystemsApiToolHealth;
  capabilities?: readonly string[];
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
};

export type SystemsApiNodeHeartbeatRequestDTO = {
  upstreamUrl?: string;
  health?: SystemsApiToolHealth;
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
};

export type SystemsApiRouteDTO = SystemsApiRoute;

export type SystemsApiRoutesResponseDTO = {
  domain: string;
  routes: readonly SystemsApiRouteDTO[];
  count: number;
  updatedAt: string;
};

export type SystemsApiDeployRequestDTO = SystemsApiDeployRequest;
export type SystemsApiDeployResponseDTO = SystemsApiDeployResponse;

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
  return (
    isRecord(value) &&
    isNumber(value.cpu) &&
    isNumber(value.memoryMb) &&
    isNumber(value.storageGb) &&
    (value.publicIpv4 === undefined || isString(value.publicIpv4))
  );
}

function isMode(value: unknown): value is SystemsApiMode {
  return value === "standalone" || value === "orchestrated";
}

function isToolHealth(value: unknown): value is SystemsApiToolHealth {
  return value === "healthy" || value === "degraded" || value === "offline";
}

function isPhantomProtectionLevel(
  value: unknown,
): value is "transitional" | "hardened" | "maximum" {
  return value === "transitional" || value === "hardened" || value === "maximum";
}

function isPhantomSecurityProfile(value: unknown): value is SystemsApiPhantomSecurityProfile {
  if (!isRecord(value) || !isRecord(value.guarantees)) return false;
  return (
    typeof value.claimedSecured === "boolean" &&
    isPhantomProtectionLevel(value.protectionLevel) &&
    typeof value.guarantees.postQuantum === "boolean" &&
    typeof value.guarantees.fheTransport === "boolean" &&
    typeof value.guarantees.zkProofs === "boolean" &&
    (value.metadata === undefined ||
      (isRecord(value.metadata) &&
        (value.metadata.pqAlgorithms === undefined ||
          (Array.isArray(value.metadata.pqAlgorithms) &&
            value.metadata.pqAlgorithms.every(isString))) &&
        (value.metadata.fheScheme === undefined || isString(value.metadata.fheScheme)) &&
        (value.metadata.zkProofSystem === undefined || isString(value.metadata.zkProofSystem)) &&
        (value.metadata.proofAttestation === undefined ||
          isString(value.metadata.proofAttestation)) &&
        (value.metadata.proofEndpoint === undefined || isString(value.metadata.proofEndpoint)) &&
        (value.metadata.lastVerifiedAt === undefined || isString(value.metadata.lastVerifiedAt))))
  );
}

export function isRegisterNodeRequest(value: unknown): value is RegisterNodeRequestDTO {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.region) &&
    isString(value.zone) &&
    (value.labels === undefined || isStringRecord(value.labels)) &&
    isNodeCapacity(value.capacity)
  );
}

export function isNodeTrustActionRequest(value: unknown): value is NodeTrustActionRequestDTO {
  return isRecord(value) && (value.reason === undefined || isString(value.reason));
}

export function isNodeTrustBulkRequest(value: unknown): value is NodeTrustBulkRequestDTO {
  return (
    isRecord(value) &&
    Array.isArray(value.operations) &&
    value.operations.every(
      (operation) =>
        isRecord(operation) &&
        isString(operation.nodeId) &&
        (operation.action === "promote" ||
          operation.action === "quarantine" ||
          operation.action === "revoke") &&
        (operation.reason === undefined || isString(operation.reason)),
    )
  );
}

export function isWorkloadPlanRequest(value: unknown): value is WorkloadPlanRequestDTO {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.image) &&
    isNumber(value.replicas) &&
    isNumber(value.cpuMillicores) &&
    isNumber(value.memoryMb) &&
    isStringRecord(value.env) &&
    Array.isArray(value.ports) &&
    value.ports.every(isNumber) &&
    (value.runtime === "container" || value.runtime === "vm" || value.runtime === "function") &&
    Array.isArray(value.storage) &&
    value.storage.every(isString)
  );
}

export function isTrustPeerRequest(value: unknown): value is TrustPeerRequestDTO {
  return (
    isRecord(value) &&
    isString(value.method) &&
    isString(value.path) &&
    isString(value.host) &&
    isString(value.timestamp) &&
    isString(value.nonce) &&
    isString(value.keyId) &&
    isString(value.signature)
  );
}

export function isSystemsApiPublicUrlRequest(
  value: unknown,
): value is SystemsApiPublicUrlRequestDTO {
  return (
    isRecord(value) &&
    isString(value.toolId) &&
    (value.desiredHost === undefined || isString(value.desiredHost)) &&
    (value.refresh === undefined || typeof value.refresh === "boolean")
  );
}

export function isSystemsApiAddressRequest(value: unknown): value is SystemsApiAddressRequestDTO {
  return (
    isRecord(value) &&
    isString(value.toolId) &&
    isString(value.kind) &&
    (value.subject === undefined || isString(value.subject)) &&
    (value.desiredHost === undefined || isString(value.desiredHost))
  );
}

export function isSystemsApiAddressRevokeRequest(
  value: unknown,
): value is SystemsApiAddressRevokeRequestDTO {
  return (
    isRecord(value) && isString(value.toolId) && (value.kind === undefined || isString(value.kind))
  );
}

export function isSystemsApiExposureRequest(value: unknown): value is SystemsApiExposureRequestDTO {
  return (
    isRecord(value) &&
    isString(value.toolId) &&
    (value.desiredHost === undefined || isString(value.desiredHost))
  );
}

export function isSystemsApiDomainBindingRequest(
  value: unknown,
): value is SystemsApiDomainBindingRequestDTO {
  return (
    isRecord(value) &&
    isString(value.toolId) &&
    isString(value.domain) &&
    (value.desiredHost === undefined || isString(value.desiredHost))
  );
}

export function isSystemsApiDomainVerificationRequest(
  value: unknown,
): value is SystemsApiDomainVerificationRequestDTO {
  return isRecord(value) && isString(value.domain) && isString(value.token);
}

export function isSystemsApiToolPatchRequest(
  value: unknown,
): value is SystemsApiToolPatchRequestDTO {
  return (
    isRecord(value) &&
    (value.name === undefined || isString(value.name)) &&
    (value.description === undefined || isString(value.description)) &&
    (value.mode === undefined || isMode(value.mode)) &&
    (value.exposed === undefined || typeof value.exposed === "boolean") &&
    (value.health === undefined || isToolHealth(value.health)) &&
    (value.upstreamUrl === undefined || isString(value.upstreamUrl)) &&
    (value.capabilities === undefined ||
      (Array.isArray(value.capabilities) && value.capabilities.every(isString))) &&
    (value.phantomSecurityProfile === undefined ||
      isPhantomSecurityProfile(value.phantomSecurityProfile)) &&
    (value.requiresAuth === undefined || typeof value.requiresAuth === "boolean")
  );
}

export function isSystemsApiToolRegistrationRequest(
  value: unknown,
): value is SystemsApiToolRegistrationRequestDTO {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.description) &&
    (value.upstreamUrl === undefined || isString(value.upstreamUrl)) &&
    (value.mode === undefined || isMode(value.mode)) &&
    (value.exposed === undefined || typeof value.exposed === "boolean") &&
    (value.health === undefined || isToolHealth(value.health)) &&
    (value.capabilities === undefined ||
      (Array.isArray(value.capabilities) && value.capabilities.every(isString))) &&
    (value.phantomSecurityProfile === undefined ||
      isPhantomSecurityProfile(value.phantomSecurityProfile))
  );
}

export function isSystemsApiNodeHeartbeatRequest(
  value: unknown,
): value is SystemsApiNodeHeartbeatRequestDTO {
  return (
    isRecord(value) &&
    (value.upstreamUrl === undefined || isString(value.upstreamUrl)) &&
    (value.health === undefined || isToolHealth(value.health)) &&
    (value.phantomSecurityProfile === undefined ||
      isPhantomSecurityProfile(value.phantomSecurityProfile))
  );
}

export function isSystemsApiDeployRequest(value: unknown): value is SystemsApiDeployRequestDTO {
  return (
    isRecord(value) &&
    isString(value.toolId) &&
    isString(value.repo) &&
    (value.name === undefined || isString(value.name)) &&
    (value.branch === undefined || isString(value.branch)) &&
    (value.buildCommand === undefined || isString(value.buildCommand)) &&
    (value.startCommand === undefined || isString(value.startCommand)) &&
    (value.volumePath === undefined || isString(value.volumePath)) &&
    (value.port === undefined || isNumber(value.port)) &&
    (value.env === undefined || isStringRecord(value.env)) &&
    (value.customDomain === undefined || isString(value.customDomain)) &&
    (value.autoDeployEnabled === undefined || typeof value.autoDeployEnabled === "boolean") &&
    (value.notifyUrl === undefined || isString(value.notifyUrl)) &&
    (value.deployNow === undefined || typeof value.deployNow === "boolean") &&
    (value.commitSha === undefined || isString(value.commitSha))
  );
}

export function isSystemsApiToolHistoryResponse(
  value: unknown,
): value is SystemsApiToolHistoryResponseDTO {
  return (
    isRecord(value) &&
    Array.isArray(value.history) &&
    value.history.every(
      (entry) =>
        isRecord(entry) &&
        isString(entry.toolId) &&
        isString(entry.action) &&
        isString(entry.summary) &&
        isString(entry.at),
    )
  );
}

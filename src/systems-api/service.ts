import {
  describeStatus,
  disableSystemsApiTool as disableTool,
  enableSystemsApiTool as enableTool,
  getAddress,
  getDomainBinding,
  getTool,
  getDomainVerificationChallenge,
  getExposure,
  getPublicUrl,
  listActiveRoutes,
  listAddresses,
  listDomainBindings,
  listExposures,
  listPublicUrls,
  listToolHistory,
  listTools,
  deregisterTool,
  expireToolHeartbeat,
  recordToolHeartbeat,
  registerSystemsApiTool as registerTool,
  requestDomainBinding,
  requestExposure,
  requestSystemsApiAddress as requestAddressRecord,
  revokeDomainBinding,
  revokeSystemsApiAddress as revokeAddressRecords,
  revokeSystemsApiExposure as revokeExposure,
  updateTool as patchTool,
  verifyDomainBinding,
} from "./registry";
import { cloudConfig } from "../config";
import { systemsApiDeployIntegration as deployIntegration } from "./deploy";
import type {
  SystemsApiAddress,
  SystemsApiAddressKind,
  SystemsApiApp,
  SystemsApiAppIntegrationMode,
  SystemsApiAppKind,
  SystemsApiCapability,
  SystemsApiConnection,
  SystemsApiConnectionKind,
  SystemsApiDomainBinding,
  SystemsApiDomainVerificationChallenge,
  SystemsApiEndpoint,
  SystemsApiExposureRecord,
  SystemsApiMode,
  SystemsApiPhantomSecurityProfile,
  SystemsApiPublicUrl,
  SystemsApiStatus,
  SystemsApiSummary,
  SystemsApiTool,
  SystemsApiToolHealth,
  SystemsApiToolHistoryEntry,
  SystemsApiTopology,
} from "./types";

const addressKinds: readonly SystemsApiAddressKind[] = ["website", "email", "server", "custom"];

const topologyApps: readonly SystemsApiApp[] = [
  {
    id: "nexus-cloud",
    name: "Nexus Cloud",
    description: "The sovereign control plane, registry, policy, topology, and orchestration hub for the Nexus Systems ecosystem.",
    kind: "platform",
    integrationMode: "embedded",
    embeddedIn: null,
    exposes: ["discovery", "status", "policy", "registry", "topology", "public-url", "deploy"],
    consumes: ["vault", "network", "deploy", "hosting", "forge", "ai", "computer"],
    requiredApis: ["Discovery API", "Systems Registry API", "Policy API", "Status API", "Topology API", "Exposure API", "Public URL API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus",
    name: "Nexus",
    description: "The collaboration and federation plane for messages, channels, and presence.",
    kind: "application",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["messages", "channels", "presence", "federation"],
    consumes: ["identity", "policy", "storage", "search", "notifications", "exposure"],
    requiredApis: ["Messaging API", "Presence API", "Federation API", "Notification API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-ai",
    name: "Nexus AI",
    description: "The agent orchestration and tool intelligence layer.",
    kind: "application",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["agents", "tool-routing", "workflows", "model-routing"],
    consumes: ["tool-registry", "vault", "identity", "status", "jobs", "deploy"],
    requiredApis: ["Tool Invocation API", "Agent Runtime API", "Model Routing API", "Job API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexusclaw",
    name: "Nexusclaw",
    description: "The multi-agent coordination layer for autonomous task graphs, baton passing, and specialist collaboration.",
    kind: "application",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["agent-graphs", "handoffs", "task-orchestration", "consensus"],
    consumes: ["topology", "jobs", "ai-runtime", "forge", "deploy"],
    requiredApis: ["Topology API", "Agent Runtime API", "Task Graph API", "Workflow API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-computer",
    name: "Nexus Computer",
    description: "The edge execution layer for local devices, agents, and remote tasks.",
    kind: "edge",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["device-registry", "edge-heartbeat", "remote-task", "sync"],
    consumes: ["jobs", "identity", "vault", "network", "control-plane"],
    requiredApis: ["Device Registry API", "Edge Heartbeat API", "Remote Task API", "Sync API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-deploy",
    name: "Nexus Deploy",
    description: "The build, release, and rollback delivery plane.",
    kind: "service",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["build", "release", "rollback", "environment"],
    consumes: ["registry", "vault", "hosting", "network", "status"],
    requiredApis: ["Build API", "Release API", "Environment API", "Rollback API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-forge",
    name: "Nexus Forge",
    description: "The repository, issue, pull request, and AI-assisted development coordination plane.",
    kind: "service",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["repositories", "issues", "pull-requests", "agent-queue"],
    consumes: ["ai", "cloud", "deploy", "vault", "identity"],
    requiredApis: ["Repository API", "Issue API", "Pull Request API", "Agent Task API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-hosting",
    name: "Nexus Hosting",
    description: "The site, route, and public runtime exposure plane.",
    kind: "service",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["sites", "routes", "assets", "public-exposure"],
    consumes: ["deploy", "cloud", "network", "vault", "storage"],
    requiredApis: ["Site Registration API", "Route Manifest API", "Publish API", "Public Address API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-network",
    name: "Nexus Network",
    description: "The connectivity, peer routing, tunnel, and federation fabric.",
    kind: "network",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["peers", "routing", "tunnel", "reachability"],
    consumes: ["identity", "policy", "vault", "status"],
    requiredApis: ["Peer Registry API", "Connectivity API", "Tunnel Session API", "Federation API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-porter",
    name: "Nexus Porter",
    description: "The container, probe, port intelligence, and environment scanning utility layer.",
    kind: "service",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["scan", "probe", "report", "container-intel"],
    consumes: ["network", "deploy", "hosting", "status"],
    requiredApis: ["Probe API", "Network Scan API", "Container Report API", "Status API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-vault",
    name: "Nexus Vault",
    description: "The secrets, tokens, signing, and trust anchor.",
    kind: "trust",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["secrets", "tokens", "signing", "rotation"],
    consumes: ["identity", "policy", "audit", "registry"],
    requiredApis: ["Secrets API", "Token Mint API", "Signing API", "Rotation API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nit",
    name: "Nit",
    description: "The lightweight interface shell and rapid runtime for fast product surfaces inside the ecosystem.",
    kind: "application",
    integrationMode: "embedded",
    embeddedIn: "nexus-cloud",
    exposes: ["ui-shell", "widget-runtime", "rapid-surface"],
    consumes: ["cloud", "identity", "status", "ai"],
    requiredApis: ["UI Shell API", "Widget Runtime API", "Status API"],
    standalone: true,
    cloudConnected: true,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom",
    name: "Phantom",
    description: "The protocol-level privacy and security overlay that hardens transport, metadata, and trust guarantees across the ecosystem.",
    kind: "protocol",
    integrationMode: "hybrid",
    embeddedIn: null,
    exposes: ["anonymous-routing", "pq-crypto", "oblivious-forwarding", "zk-proofing", "surveillance-resistance"],
    consumes: ["network-research", "identity", "federation", "verification"],
    requiredApis: ["Anonymous Transport API", "Federation API", "Cryptographic Capability API", "Proof Verification API"],
    standalone: true,
    cloudConnected: false,
    registeredAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

const topologyConnections: readonly SystemsApiConnection[] = [
  {
    id: "cloud-manages-nexus",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus",
    kind: "embedded-in",
    description: "Nexus is embedded into Nexus Cloud as a first-class communications module.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-manages-ai",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-ai",
    kind: "embedded-in",
    description: "Nexus AI is embedded in Nexus Cloud as the shared intelligence runtime.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-references-claw",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexusclaw",
    kind: "references",
    description: "Nexusclaw extends Cloud with agent-to-agent task choreography and specialist coordination.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-orchestrates-computer",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-computer",
    kind: "embedded-in",
    description: "Nexus Computer is embedded in Nexus Cloud for edge task orchestration and sync.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-calls-deploy",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-deploy",
    kind: "embedded-in",
    description: "Nexus Deploy is embedded in Nexus Cloud as the default release and rollout backend.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-connects-forge",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-forge",
    kind: "embedded-in",
    description: "Nexus Forge is embedded in Nexus Cloud and uses Cloud for topology and automation context.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-connects-hosting",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-hosting",
    kind: "embedded-in",
    description: "Nexus Hosting is embedded in Nexus Cloud and consumes registry, exposure, and deployment state.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-embeds-network",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-network",
    kind: "routes-through",
    description: "Nexus Network provides the peer, tunnel, and federation fabric for Cloud.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-references-porter",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-porter",
    kind: "references",
    description: "Nexus Porter gives Cloud operator-grade port, probe, and container intelligence.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-embeds-vault",
    sourceAppId: "nexus-cloud",
    targetAppId: "nexus-vault",
    kind: "depends-on",
    description: "Nexus Vault is the trust and secrets foundation used by Cloud and tools.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-references-nit",
    sourceAppId: "nexus-cloud",
    targetAppId: "nit",
    kind: "references",
    description: "Nit can surface lightweight ecosystem UI experiences inside or alongside Cloud.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "cloud-references-phantom",
    sourceAppId: "nexus-cloud",
    targetAppId: "phantom",
    kind: "references",
    description: "Phantom informs future sovereign transport and privacy-preserving federation paths for Cloud.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "ai-routes-to-tools",
    sourceAppId: "nexus-ai",
    targetAppId: "nexus",
    kind: "depends-on",
    description: "Nexus AI invokes communication and collaboration capabilities through Nexus.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "ai-delegates-to-claw",
    sourceAppId: "nexus-ai",
    targetAppId: "nexusclaw",
    kind: "depends-on",
    description: "Nexus AI can hand complex multi-agent coordination flows to Nexusclaw.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "computer-uses-ai",
    sourceAppId: "nexus-computer",
    targetAppId: "nexus-ai",
    kind: "depends-on",
    description: "Nexus Computer relies on Nexus AI for agent execution, tool selection, and remote assistance.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "forge-uses-ai",
    sourceAppId: "nexus-forge",
    targetAppId: "nexus-ai",
    kind: "depends-on",
    description: "Nexus Forge uses Nexus AI for reviews, generation, and queue-backed automation.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "hosting-uses-deploy",
    sourceAppId: "nexus-hosting",
    targetAppId: "nexus-deploy",
    kind: "depends-on",
    description: "Hosting consumes deployment outputs and release state from Deploy.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "forge-uses-deploy",
    sourceAppId: "nexus-forge",
    targetAppId: "nexus-deploy",
    kind: "depends-on",
    description: "Nexus Forge can trigger or observe deployments through Nexus Deploy after repository events.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "network-routes-public-exposure",
    sourceAppId: "nexus-network",
    targetAppId: "nexus-hosting",
    kind: "routes-through",
    description: "Public reachability and tunnels should route through the network layer.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "network-routes-nexus",
    sourceAppId: "nexus-network",
    targetAppId: "nexus",
    kind: "routes-through",
    description: "Real-time communication and federation traffic for Nexus should traverse the network layer.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "porter-observes-deploy",
    sourceAppId: "nexus-porter",
    targetAppId: "nexus-deploy",
    kind: "references",
    description: "Nexus Porter can scan and report on runtime surfaces created by deployment workflows.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-informs-network",
    sourceAppId: "phantom",
    targetAppId: "nexus-network",
    kind: "secures",
    description: "Phantom hardens Nexus Network transport and metadata resistance against surveillance and interception.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-cloud",
    sourceAppId: "phantom",
    targetAppId: "nexus-cloud",
    kind: "secures",
    description: "Phantom provides protocol-level privacy and secure transport guarantees to Cloud control-plane interactions.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-nexus",
    sourceAppId: "phantom",
    targetAppId: "nexus",
    kind: "secures",
    description: "Phantom hardens collaboration traffic paths with oblivious routing and metadata resistance primitives.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-ai",
    sourceAppId: "phantom",
    targetAppId: "nexus-ai",
    kind: "secures",
    description: "Phantom secures AI runtime communications with privacy-preserving protocol guarantees.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-claw",
    sourceAppId: "phantom",
    targetAppId: "nexusclaw",
    kind: "secures",
    description: "Phantom protects multi-agent coordination channels and baton-pass metadata paths.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-computer",
    sourceAppId: "phantom",
    targetAppId: "nexus-computer",
    kind: "secures",
    description: "Phantom secures edge compute transport and remote task exchange surfaces.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-deploy",
    sourceAppId: "phantom",
    targetAppId: "nexus-deploy",
    kind: "secures",
    description: "Phantom hardens deployment orchestration traffic and release control paths.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-forge",
    sourceAppId: "phantom",
    targetAppId: "nexus-forge",
    kind: "secures",
    description: "Phantom secures repository and automation control-plane communication flows.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-hosting",
    sourceAppId: "phantom",
    targetAppId: "nexus-hosting",
    kind: "secures",
    description: "Phantom protects hosting route, exposure, and runtime traffic against metadata leakage.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-porter",
    sourceAppId: "phantom",
    targetAppId: "nexus-porter",
    kind: "secures",
    description: "Phantom secures probe and diagnostics transport to reduce observability-based attack surfaces.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-vault",
    sourceAppId: "phantom",
    targetAppId: "nexus-vault",
    kind: "secures",
    description: "Phantom adds privacy-preserving transport assurances to secrets and key-management interactions.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "phantom-secures-nit",
    sourceAppId: "phantom",
    targetAppId: "nit",
    kind: "secures",
    description: "Phantom provides secure and private protocol guarantees for lightweight runtime surfaces.",
    embedded: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "ai-embedded-in-cloud",
    sourceAppId: "nexus-ai",
    targetAppId: "nexus-cloud",
    kind: "embedded-in",
    description: "Nexus AI is rendered as a shared embedded control surface inside Nexus Cloud.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "deploy-uses-ai",
    sourceAppId: "nexus-deploy",
    targetAppId: "nexus-ai",
    kind: "depends-on",
    description: "Nexus Deploy uses Nexus AI for pipeline generation, policy checks, and remediation suggestions.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "hosting-uses-ai",
    sourceAppId: "nexus-hosting",
    targetAppId: "nexus-ai",
    kind: "depends-on",
    description: "Nexus Hosting uses Nexus AI for smart routing guidance, diagnostics, and operator assistance.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "nexus-uses-ai",
    sourceAppId: "nexus",
    targetAppId: "nexus-ai",
    kind: "depends-on",
    description: "Nexus uses Nexus AI for assistants, moderation, and context-aware collaboration workflows.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "network-serves-ai",
    sourceAppId: "nexus-network",
    targetAppId: "nexus-ai",
    kind: "routes-through",
    description: "Nexus Network provides transport paths and tunnel reachability for AI service endpoints.",
    embedded: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

function appIntegrationMode(kind: SystemsApiAppKind, embeddedIn: string | null): SystemsApiAppIntegrationMode {
  if (embeddedIn) return "embedded";
  if (kind === "platform" || kind === "application") return "hybrid";
  return "standalone";
}

export type SystemsApiPublicUrlRequest = {
  toolId: string;
  desiredHost?: string;
  refresh?: boolean;
};

export type SystemsApiAddressRequest = {
  toolId: string;
  kind: SystemsApiAddressKind;
  subject?: string;
  desiredHost?: string;
};

export type SystemsApiExposureRequest = {
  toolId: string;
  desiredHost?: string;
};

export type SystemsApiDomainBindingRequest = {
  toolId: string;
  domain: string;
  desiredHost?: string;
};

export type SystemsApiDomainVerificationRequest = {
  domain: string;
  token: string;
};

export type SystemsApiToolRegistrationInput = {
  id: string;
  name: string;
  description: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: import("./types").SystemsApiToolHealth;
  capabilities?: readonly string[];
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
  publicUrl?: string;
  upstreamUrl?: string;
};

export type SystemsApiToolPatchInput = {
  name?: string;
  description?: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: import("./types").SystemsApiToolHealth;
  capabilities?: readonly string[];
  upstreamUrl?: string;
  phantomSecurityProfile?: SystemsApiPhantomSecurityProfile;
};

const endpoints = [
  { method: "GET", path: "/api/v1/tools", description: "List registered tools" },
  { method: "POST", path: "/api/v1/tools", description: "Register or upsert a tool" },
  { method: "GET", path: "/api/v1/tools/:toolId", description: "Inspect a registered tool" },
  { method: "GET", path: "/api/v1/tools/:toolId/history", description: "Inspect tool lifecycle history" },
  { method: "PATCH", path: "/api/v1/tools/:toolId", description: "Update registered tool metadata" },
  { method: "POST", path: "/api/v1/tools/:toolId/enable", description: "Enable a registered tool" },
  { method: "POST", path: "/api/v1/tools/:toolId/disable", description: "Disable a registered tool" },
  { method: "POST", path: "/api/v1/tools/:toolId/heartbeat", description: "Update tool liveness and upstream URL" },
  { method: "GET", path: "/api/v1/routes", description: "Live proxy routing table (domain → upstream)" },
  { method: "GET", path: "/api/v1/routes/caddy", description: "Caddy admin API format routing config" },
  { method: "GET", path: "/.well-known/nexus-cloud", description: "Nexus Cloud discovery document" },
  { method: "GET", path: "/api/v1/status", description: "Return normalized platform status" },
  { method: "GET", path: "/api/v1/compliance/phantom", description: "List PHANTOM security compliance entries" },
  { method: "GET", path: "/api/v1/compliance/phantom/summary", description: "Counts-only PHANTOM compliance summary" },
  { method: "POST", path: "/api/v1/public-url", description: "Request or refresh a public URL" },
  { method: "GET", path: "/api/v1/addresses", description: "List public address records" },
  { method: "GET", path: "/api/v1/addresses/:toolId", description: "Inspect public address records for a tool" },
  { method: "POST", path: "/api/v1/addresses", description: "Request a public address" },
  { method: "POST", path: "/api/v1/addresses/:toolId/revoke", description: "Revoke public address records for a tool" },
  { method: "GET", path: "/api/v1/exposures", description: "List exposure records" },
  { method: "GET", path: "/api/v1/exposures/:toolId", description: "Inspect an exposure record" },
  { method: "POST", path: "/api/v1/exposures", description: "Request a new exposure" },
  { method: "POST", path: "/api/v1/exposures/:toolId/revoke", description: "Revoke an exposure record" },
  { method: "GET", path: "/api/v1/domains", description: "List domain bindings" },
  { method: "POST", path: "/api/v1/domains", description: "Bind a custom domain" },
  { method: "GET", path: "/api/v1/domains/:domain", description: "Inspect a domain binding" },
  { method: "POST", path: "/api/v1/domains/:domain/verify", description: "Verify a domain binding" },
  { method: "DELETE", path: "/api/v1/domains/:domain", description: "Revoke a domain binding" },
  { method: "GET", path: "/api/v1/deployments/integration", description: "Inspect the Deploy backend integration" },
  { method: "POST", path: "/api/v1/deployments", description: "Request a managed Deploy deployment" },
] as const satisfies readonly SystemsApiEndpoint[];

const capabilities = [
  { id: "tools.discovery", description: "Discover tool metadata and exposure state" },
  { id: "tools.lifecycle", description: "Inspect and toggle tool exposure state" },
  { id: "tools.metadata", description: "Update tool metadata and capabilities" },
  { id: "tools.history", description: "Inspect tool lifecycle history" },
  { id: "status.health", description: "Read normalized health and platform summaries" },
  { id: "public-url.exposure", description: "Request public backend exposure" },
  { id: "addresses.issue", description: "Request website, email, server, and custom public addresses" },
  { id: "domains.binding", description: "Bind and verify custom domains" },
  { id: "domains.verification", description: "Generate and check domain verification challenges" },
  { id: "exposures.lifecycle", description: "Track exposure records and revocation state" },
  { id: "deploy.request", description: "Request and inspect managed deployments through Nexus Deploy" },
] as const satisfies readonly SystemsApiCapability[];

export function listSystemsApiEndpoints(): readonly SystemsApiEndpoint[] {
  return endpoints;
}

export function listSystemsApiCapabilities(): readonly SystemsApiCapability[] {
  return capabilities;
}

export function listSystemsApiTools(): readonly SystemsApiTool[] {
  return listTools();
}

export function getSystemsApiTool(toolId: string): SystemsApiTool | null {
  return getTool(toolId);
}

export function listSystemsApiToolHistory(toolId: string): readonly SystemsApiToolHistoryEntry[] {
  return listToolHistory(toolId);
}

export function listSystemsApiPublicUrls(): readonly SystemsApiPublicUrl[] {
  return listPublicUrls();
}

export function getSystemsApiPublicUrl(toolId: string): SystemsApiPublicUrl | null {
  return getPublicUrl(toolId);
}

export function listSystemsApiAddresses(): readonly SystemsApiAddress[] {
  return listAddresses();
}

export function listSystemsApiAddressesForTool(toolId: string): readonly SystemsApiAddress[] {
  return listAddresses().filter((item) => item.toolId === toolId);
}

export function getSystemsApiAddress(toolId: string, kind?: SystemsApiAddressKind): SystemsApiAddress | null {
  return getAddress(toolId, kind);
}

export function requestSystemsApiAddress(input: SystemsApiAddressRequest): SystemsApiAddress | null {
  return requestAddressRecord(input);
}

export function revokeSystemsApiAddress(input: { toolId: string; kind?: SystemsApiAddressKind }): readonly SystemsApiAddress[] {
  return revokeAddressRecords(input);
}

export function listSystemsApiExposures(): readonly SystemsApiExposureRecord[] {
  return listExposures();
}

export function getSystemsApiExposure(toolId: string): SystemsApiExposureRecord | null {
  return getExposure(toolId);
}

export function requestSystemsApiExposure(input: SystemsApiExposureRequest): SystemsApiExposureRecord | null {
  return requestExposure(input);
}

export function revokeSystemsApiExposure(toolId: string): SystemsApiExposureRecord | null {
  return revokeExposure(toolId);
}

export function listSystemsApiDomainBindings(): readonly SystemsApiDomainBinding[] {
  return listDomainBindings();
}

export function getSystemsApiDomainBinding(domain: string): SystemsApiDomainBinding | null {
  return getDomainBinding(domain);
}

export function requestSystemsApiDomainBinding(input: SystemsApiDomainBindingRequest): SystemsApiDomainBinding | null {
  return requestDomainBinding(input);
}

export function getSystemsApiDomainVerification(domain: string): SystemsApiDomainVerificationChallenge | null {
  return getDomainVerificationChallenge(domain);
}

export function verifySystemsApiDomain(domain: string, token: string): SystemsApiDomainBinding | null {
  return verifyDomainBinding(domain, token);
}

export function revokeSystemsApiDomain(domain: string): SystemsApiDomainBinding | null {
  return revokeDomainBinding(domain);
}

export function deregisterSystemsApiTool(toolId: string): SystemsApiTool | null {
  return deregisterTool(toolId);
}

export function registerSystemsApiTool(input: SystemsApiToolRegistrationInput): SystemsApiTool {
  return registerTool(input);
}

export function updateSystemsApiTool(toolId: string, patch: SystemsApiToolPatchInput): SystemsApiTool | null {
  return patchTool(toolId, patch);
}

export function exposeSystemsApiTool(toolId: string, exposed: boolean): SystemsApiTool | null {
  return exposed ? enableTool(toolId) : disableTool(toolId);
}

export function issueSystemsApiPublicUrl(input: SystemsApiPublicUrlRequest): SystemsApiPublicUrl | null {
  const tool = getSystemsApiTool(input.toolId);
  if (!tool) return null;
  const subject = input.desiredHost?.replace(/^https?:\/\//, "") || input.toolId;
  const address = requestAddressRecord({
    toolId: input.toolId,
    kind: "website",
    subject,
    desiredHost: input.desiredHost,
  });
  if (!address) return null;
  return getPublicUrl(input.toolId);
}

export function describeSystemsApiStatus(): SystemsApiStatus {
  return describeStatus();
}

export function listSystemsApiApps(): readonly SystemsApiApp[] {
  return topologyApps;
}

export function listSystemsApiConnections(): readonly SystemsApiConnection[] {
  return topologyConnections;
}

export function describeSystemsApiTopology(): SystemsApiTopology {
  const embeddedAppCount = topologyApps.filter((app) => app.integrationMode === "embedded").length;
  const referencedAppCount = topologyApps.filter((app) => app.integrationMode === "referenced").length;
  const hybridAppCount = topologyApps.filter((app) => app.integrationMode === "hybrid").length;
  return {
    apps: topologyApps,
    connections: topologyConnections,
    summary: {
      appCount: topologyApps.length,
      connectionCount: topologyConnections.length,
      embeddedAppCount,
      referencedAppCount,
      hybridAppCount,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function describeSystemsApi(): SystemsApiSummary {

  const status = describeSystemsApiStatus();
  return {
    version: status.version,
    scope: "canonical platform contract for Nexus tools and orchestrated services",
    endpoints,
    capabilities,
    toolCount: status.toolCount,
    status,
    addressKinds: status.addressKinds,
    deploy: deployIntegration,
  };
}

export function describeSystemsApiDeployIntegration(): typeof deployIntegration {
  return deployIntegration;
}

export const systemsApiDeployIntegration = deployIntegration;

export function listSystemsApiRoutes() {
  return listActiveRoutes();
}

export function heartbeatSystemsApiTool(toolId: string, patch: { upstreamUrl?: string; health?: SystemsApiToolHealth; phantomSecurityProfile?: SystemsApiPhantomSecurityProfile }): SystemsApiTool | null {
  return recordToolHeartbeat(toolId, patch);
}

/**
 * Mark tools as `offline` when they have previously heartbeated but have not
 * done so within `thresholdMs` milliseconds. Tools that have never heartbeated
 * since Cloud started are left untouched (they keep their persisted state).
 * Returns the number of tools transitioned.
 */
export function applyHeartbeatExpiry(thresholdMs = 90_000): number {
  const cutoff = Date.now() - thresholdMs;
  let count = 0;
  for (const tool of listTools()) {
    if (tool.registrationStatus === "offline") continue;
    if (!tool.lastHeartbeatAt) continue;
    const lastHeartbeatMs = Date.parse(tool.lastHeartbeatAt);
    if (Number.isNaN(lastHeartbeatMs)) continue;
    if (lastHeartbeatMs < cutoff) {
      expireToolHeartbeat(tool.id, new Date().toISOString());
      count++;
    }
  }
  return count;
}

export function getCloudDomain(): string {
  return cloudConfig.cloudDomain;
}

export const systemsApiService = {
  deregisterSystemsApiTool,
  describeSystemsApi,
  describeSystemsApiDeployIntegration,
  describeSystemsApiStatus,
  describeSystemsApiTopology,
  disableSystemsApiTool: disableTool,
  enableSystemsApiTool: enableTool,
  exposeSystemsApiTool,
  getSystemsApiAddress,
  getSystemsApiAddressForTool: listSystemsApiAddressesForTool,
  getSystemsApiDomainBinding,
  getSystemsApiDomainVerification,
  getSystemsApiExposure,
  getSystemsApiPublicUrl,
  getSystemsApiTool,
  issueSystemsApiAddress: requestSystemsApiAddress,
  issueSystemsApiPublicUrl,
  listSystemsApiAddresses,
  listSystemsApiAddressesForTool,
  listSystemsApiApps,
  listSystemsApiCapabilities,
  listSystemsApiConnections,
  listSystemsApiDomainBindings,
  listSystemsApiEndpoints,
  listSystemsApiExposures,
  listSystemsApiPublicUrls,
  listSystemsApiToolHistory,
  listSystemsApiTools,
  registerSystemsApiTool,
  requestSystemsApiAddress,
  requestSystemsApiDomainBinding,
  requestSystemsApiExposure,
  revokeSystemsApiAddress,
  revokeSystemsApiDomain,
  revokeSystemsApiExposure,
  updateSystemsApiTool,
  verifySystemsApiDomain,
  listSystemsApiRoutes,
  heartbeatSystemsApiTool,
  applyHeartbeatExpiry,
  getCloudDomain,
};

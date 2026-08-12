import { NexusClient, createConfig } from "../../../packages/nexus-sdk/src/index";
import { handleRequest } from "./api/router";
import { controlPlaneService } from "./control-plane";
import { federationService } from "./federation";
import { bootstrapPeers } from "./federation";
import { applyHeartbeatExpiry } from "./systems-api/service";

export const port = Number(process.env.PORT ?? "8787");
export const server = Bun.serve({
  port,
  // Loopback unless told otherwise — Bun.serve binds every interface by
  // default. Cloud holds the service registry and routing table, and its
  // mutating endpoints are guarded only by an API key; there is no reason for
  // anything but the local proxy and local services to reach it.
  hostname: process.env.NEXUS_BIND_HOST || "127.0.0.1",
  fetch: handleRequest,
});

// Initialize Nexus client after server is created
const nexusClient = new NexusClient(
  createConfig({
    id: "nexus-cloud",
    name: "Nexus Cloud",
    description: "Sovereign control plane, registry, policy, topology, and orchestration hub",
    port: Number(process.env.PORT ?? "8787"),
    capabilities: [
      "discovery",
      "status",
      "policy",
      "registry",
      "topology",
      "public-url",
      "deploy",
      "federation",
    ],
  }),
);

// Start heartbeats after creating the client
const _stopNexusHeartbeat = nexusClient.startCloudHeartbeat();
const _stopNexusMonitor = nexusClient.startMonitorHeartbeat();

bootstrapPeers().then(() => {
  console.log("[federation] Bootstrap completed, peers:", federationService.listPeers().length);
});

setInterval(() => {
  applyHeartbeatExpiry();
  controlPlaneService.applyNodeTrustExpiry();
  federationService.applyPeerTrustExpiry();
}, 30_000);

import { NexusClient, createConfig } from "../../../packages/nexus-sdk/src/index";
import { PhantomApp } from "../../../packages/phantom-sdk/src/integration";

export const phantomApp = new PhantomApp("nexus-cloud");
phantomApp.start()
  .then(() => phantomApp.registerWithCloud(`http://127.0.0.1:${process.env.PORT ?? "8787"}`))
  .catch((err: unknown) => {
    console.error("[nexus-cloud] Phantom startup failed:", err instanceof Error ? err.message : err);
  });
import { handleRequest } from "./api/router";
import { controlPlaneService } from "./control-plane";
import { federationService } from "./federation";
import { bootstrapPeers } from "./federation";
import { applyHeartbeatExpiry, probeExposedToolsHealth } from "./systems-api/service";

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

// Attach Phantom signer so outbound heartbeats and registrations carry post-quantum auth headers
phantomApp.start().then(() => {
  nexusClient.setPhantomSigner((body) => phantomApp.signHeaders(body));
}).catch(() => { /* non-fatal — heartbeats still work without signing */ });

// Start heartbeats after creating the client
const _stopNexusHeartbeat = nexusClient.startCloudHeartbeat();
const _stopNexusMonitor = nexusClient.startMonitorHeartbeat();

bootstrapPeers().then(() => {
  console.log("[federation] Bootstrap completed, peers:", federationService.listPeers().length);
});

setInterval(() => {
  applyHeartbeatExpiry();
  probeExposedToolsHealth();
  controlPlaneService.applyNodeTrustExpiry();
  federationService.applyPeerTrustExpiry();
}, 30_000);

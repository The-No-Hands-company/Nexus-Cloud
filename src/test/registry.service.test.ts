import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createSystemsApiTestHarness, emptySystemsApiRegistry } from "./systems-api-harness";

describe("Systems API registry/service behavior", () => {
  test("request and revoke exposure update registry state and history", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "tool-gamma",
        name: "Gamma",
        description: "Gamma tool",
        upstreamUrl: "http://127.0.0.1:4100",
        exposed: false,
        health: "healthy",
        capabilities: ["exposure.lifecycle"],
      });

      const requested = systemsApiService.requestSystemsApiExposure({
        toolId: "tool-gamma",
        desiredHost: "gamma.example.com",
      });
      expect(requested?.status).toBe("active");
      expect(systemsApiService.getSystemsApiExposure("tool-gamma")?.status).toBe("active");

      const revoked = systemsApiService.revokeSystemsApiExposure("tool-gamma");
      expect(revoked?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiExposure("tool-gamma")?.status).toBe("revoked");
      expect(systemsApiService.listSystemsApiTools()[0]?.exposed).toBe(false);
      expect(systemsApiService.listSystemsApiToolHistory("tool-gamma").map((entry: { action: string }) => entry.action)).toEqual(
        expect.arrayContaining(["registered", "exposure-requested", "exposure-activated", "exposure-revoked"]),
      );
    } finally {
      harness.cleanup();
    }
  });

  test("rejects domain binding before public URL issuance, accepts it after, and revokes dependent records", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "tool-delta",
        name: "Delta",
        description: "Delta tool",
        upstreamUrl: "http://127.0.0.1:4200",
        exposed: false,
        health: "healthy",
        capabilities: ["domains.binding"],
      });

      expect(
        systemsApiService.requestSystemsApiDomainBinding({
          toolId: "tool-delta",
          domain: "delta.example.com",
        }),
      ).toBeNull();

      const publicUrl = systemsApiService.issueSystemsApiPublicUrl({
        toolId: "tool-delta",
        desiredHost: "public.delta.example.com",
      });
      expect(publicUrl).not.toBeNull();
      expect(publicUrl?.status).toBe("active");

      const binding = systemsApiService.requestSystemsApiDomainBinding({
        toolId: "tool-delta",
        domain: "delta.example.com",
      });
      expect(binding).not.toBeNull();
      expect(binding?.status).toBe("pending");
      expect(binding?.canonicalUrl).toBe("https://tool-delta.nexus.local");
      expect(binding?.publicUrl).toBe("https://public.delta.example.com");

      const bindingAfterPublicUrl = systemsApiService.getSystemsApiDomainBinding("delta.example.com");
      expect(bindingAfterPublicUrl?.publicUrl).toBe("https://public.delta.example.com");
      expect(bindingAfterPublicUrl?.status).toBe("pending");

      const revokedExposure = systemsApiService.revokeSystemsApiExposure("tool-delta");
      expect(revokedExposure?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiExposure("tool-delta")?.status).toBe("revoked");
      expect(systemsApiService.listSystemsApiPublicUrls()[0]?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiDomainBinding("delta.example.com")?.status).toBe("revoked");
      expect(systemsApiService.listSystemsApiTools()[0]?.exposed).toBe(false);
      expect(systemsApiService.listSystemsApiToolHistory("tool-delta").map((entry: { action: string }) => entry.action)).toEqual(
        expect.arrayContaining(["registered", "public-url-issued", "exposure-requested", "exposure-activated", "domain-bound", "exposure-revoked", "domain-revoked"]),
      );
    } finally {
      harness.cleanup();
    }
  });

  test("quarantines exposure requests for degraded tools and records a Guardian decision", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { handleRequest, systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "tool-epsilon",
        name: "Epsilon",
        description: "Epsilon tool",
        upstreamUrl: "http://127.0.0.1:4300",
        exposed: false,
        health: "degraded",
        capabilities: ["exposure.lifecycle"],
      });

      const response = await handleRequest(new Request("http://localhost/api/v1/exposures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId: "tool-epsilon", desiredHost: "epsilon.example.com" }),
      }));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.exposure.target.status).toBe("quarantined");

      const decisionsResponse = await handleRequest(new Request("http://localhost/api/v1/guardian/decisions", { method: "GET" }));
      expect(decisionsResponse.status).toBe(200);
      const decisionsBody = await decisionsResponse.json();
      expect(decisionsBody.decisions.some((decision: { toolId: string; status: string }) => decision.toolId === "tool-epsilon" && decision.status === "quarantined")).toBe(true);
    } finally {
      harness.cleanup();
    }
  });

  test("marks integration status as failing when PHANTOM-secured claims are missing proof metadata", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "tool-zeta",
        name: "Zeta",
        description: "Zeta tool",
        upstreamUrl: "http://127.0.0.1:4400",
        exposed: false,
        health: "healthy",
        capabilities: ["exposure.lifecycle"],
        phantomSecurityProfile: {
          claimedSecured: true,
          protectionLevel: "hardened",
          guarantees: {
            postQuantum: true,
            fheTransport: true,
            zkProofs: true,
          },
          metadata: {
            pqAlgorithms: ["kyber-1024"],
            fheScheme: "ckks",
            // Intentionally incomplete: missing zkProofSystem/proofAttestation/proofEndpoint.
          },
        },
      });

      const status = systemsApiService.describeSystemsApiStatus();
      expect(status.integrationStatus).toBe("failing");
      expect(status.failedIntegrationCount).toBe(1);
      expect(status.phantomSecuredClaimedCount).toBe(1);
      expect(status.phantomSecuredCompliantCount).toBe(0);
      expect(status.integrationFailures.some((failure) => failure.toolId === "tool-zeta")).toBe(true);
      expect(status.integrationFailures[0]?.reason).toContain("missing zkProofSystem metadata");
    } finally {
      harness.cleanup();
    }
  });

  test("persists authoritative heartbeat state and expires stale tools from persisted timestamps", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      const registered = systemsApiService.registerSystemsApiTool({
        id: "tool-heartbeat",
        name: "Heartbeat Tool",
        description: "Tracks persisted liveness",
        upstreamUrl: "http://127.0.0.1:4500",
        exposed: false,
        capabilities: ["heartbeat.lifecycle"],
      });

      expect(registered.registrationStatus).toBe("registered");
      expect(registered.heartbeatCount).toBe(0);
      expect(registered.lastHeartbeatAt).toBeUndefined();

      const heartbeated = systemsApiService.heartbeatSystemsApiTool("tool-heartbeat", {
        health: "degraded",
        upstreamUrl: "http://127.0.0.1:4501",
      });
      expect(heartbeated).not.toBeNull();
      expect(heartbeated?.registrationStatus).toBe("active");
      expect(heartbeated?.health).toBe("degraded");
      expect(heartbeated?.heartbeatCount).toBe(1);
      expect(heartbeated?.lastHeartbeatAt).toEqual(expect.any(String));

      const registryPath = systemsApiService.describeSystemsApiStatus().registry.path;
      const persisted = JSON.parse(readFileSync(registryPath, "utf8"));
      expect(persisted.tools[0]?.registrationStatus).toBe("active");
      expect(persisted.tools[0]?.heartbeatCount).toBe(1);
      expect(typeof persisted.tools[0]?.lastHeartbeatAt).toBe("string");

      const expiredCount = systemsApiService.applyHeartbeatExpiry(-1);
      expect(expiredCount).toBe(1);

      const expired = systemsApiService.getSystemsApiTool("tool-heartbeat");
      expect(expired?.health).toBe("offline");
      expect(expired?.registrationStatus).toBe("offline");
    } finally {
      harness.cleanup();
    }
  });

  test("quarantines exposure until upstream host is represented by a trusted federation peer", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;
      const { federationService } = await import("../federation");

      systemsApiService.registerSystemsApiTool({
        id: "tool-remote",
        name: "Remote Tool",
        description: "Tool behind remote upstream host",
        upstreamUrl: "https://edge-1.example.net",
        exposed: false,
        health: "healthy",
        capabilities: ["exposure.lifecycle"],
      });

      const quarantined = systemsApiService.requestSystemsApiExposure({
        toolId: "tool-remote",
        desiredHost: "remote.example.net",
      });
      expect(quarantined?.status).toBe("quarantined");

      federationService.trustPeer("edge-1.example.net", {
        method: "POST",
        path: "/v1/federation/peers/edge-1.example.net/trust",
        host: "cloud.example.com",
        timestamp: new Date().toISOString(),
        nonce: crypto.randomUUID(),
        keyId: "peer-key-edge-1",
        signature: "signed-edge-1",
      });

      const approved = systemsApiService.requestSystemsApiExposure({
        toolId: "tool-remote",
        desiredHost: "remote.example.net",
      });
      expect(approved?.status).toBe("active");
    } finally {
      harness.cleanup();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createSystemsApiTestHarness, emptySystemsApiRegistry } from "./systems-api-harness";

describe("Systems API registry/service behavior", () => {
  test("persists Calendar's explicit delivery contract across a registry reload", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      const registered = systemsApiService.registerSystemsApiTool({
        id: "nexus-calendar",
        name: "Nexus-Calendar",
        description: "Shared calendars with events, reminders, and month/week views",
        path: "/calendar",
        publicUrl: "https://calendar.tnhc.dev",
        delivery: "proxied-app",
      });
      expect(registered).toMatchObject({
        path: "/calendar",
        publicUrl: "https://calendar.tnhc.dev",
        delivery: "proxied-app",
      });

      const registryPath = systemsApiService.describeSystemsApiStatus().registry.path;
      expect(JSON.parse(readFileSync(registryPath, "utf8")).tools[0]).toMatchObject({
        path: "/calendar",
        publicUrl: "https://calendar.tnhc.dev",
        delivery: "proxied-app",
      });

      const storeModule = await import(`../systems-api/store.ts?case=delivery-${Date.now()}`);
      const reloaded = storeModule.loadSystemsApiRegistry().tools[0];
      expect(reloaded).toMatchObject({
        path: "/calendar",
        publicUrl: "https://calendar.tnhc.dev",
        delivery: "proxied-app",
      });
    } finally {
      harness.cleanup();
    }
  });

  test("defaults malformed persisted delivery records from their safe destinations", async () => {
    const harness = await createSystemsApiTestHarness({
      ...emptySystemsApiRegistry,
      tools: [
        {
          id: "legacy-framed",
          name: "Legacy framed",
          description: "A legacy external app",
          mode: "standalone",
          exposed: true,
          exposure: "public",
          health: "healthy",
          registrationStatus: "registered",
          capabilities: [],
          heartbeatCount: 0,
          registeredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          path: "/legacy-framed",
          publicUrl: "https://legacy.tnhc.dev",
          delivery: "invalid" as never,
        },
        {
          id: "legacy-native",
          name: "Legacy native",
          description: "A legacy shell view",
          mode: "standalone",
          exposed: false,
          exposure: "private",
          health: "healthy",
          registrationStatus: "registered",
          capabilities: [],
          heartbeatCount: 0,
          registeredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          path: "/legacy-native",
          delivery: "invalid" as never,
        },
      ],
    });
    try {
      const registryPath = harness.systemsApiService.describeSystemsApiStatus().registry.path;
      const storeModule = await import(`../systems-api/store.ts?case=malformed-delivery-${Date.now()}`);
      const reloaded = storeModule.loadSystemsApiRegistry();

      expect(reloaded.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "legacy-framed", delivery: "framed" }),
          expect.objectContaining({ id: "legacy-native", delivery: "shell-native" }),
        ]),
      );
      expect(registryPath).toContain("systems-api-registry.json");
    } finally {
      harness.cleanup();
    }
  });

  test("rejects non-relative registration paths", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      expect(() =>
        harness.systemsApiService.registerSystemsApiTool({
          id: "unsafe-path",
          name: "Unsafe path",
          description: "Must not claim an origin as a shell route",
          path: "https://unsafe.example",
        }),
      ).toThrow("path must be a safe relative path");
    } finally {
      harness.cleanup();
    }
  });

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
      expect(
        systemsApiService
          .listSystemsApiToolHistory("tool-gamma")
          .map((entry: { action: string }) => entry.action),
      ).toEqual(
        expect.arrayContaining([
          "registered",
          "exposure-requested",
          "exposure-activated",
          "exposure-revoked",
        ]),
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

      const bindingAfterPublicUrl =
        systemsApiService.getSystemsApiDomainBinding("delta.example.com");
      expect(bindingAfterPublicUrl?.publicUrl).toBe("https://public.delta.example.com");
      expect(bindingAfterPublicUrl?.status).toBe("pending");

      const revokedExposure = systemsApiService.revokeSystemsApiExposure("tool-delta");
      expect(revokedExposure?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiExposure("tool-delta")?.status).toBe("revoked");
      expect(systemsApiService.listSystemsApiPublicUrls()[0]?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiDomainBinding("delta.example.com")?.status).toBe(
        "revoked",
      );
      expect(systemsApiService.listSystemsApiTools()[0]?.exposed).toBe(false);
      expect(
        systemsApiService
          .listSystemsApiToolHistory("tool-delta")
          .map((entry: { action: string }) => entry.action),
      ).toEqual(
        expect.arrayContaining([
          "registered",
          "public-url-issued",
          "exposure-requested",
          "exposure-activated",
          "domain-bound",
          "exposure-revoked",
          "domain-revoked",
        ]),
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

      const response = await handleRequest(
        new Request("http://localhost/api/v1/exposures", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toolId: "tool-epsilon", desiredHost: "epsilon.example.com" }),
        }),
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.exposure.target.status).toBe("quarantined");

      const decisionsResponse = await handleRequest(
        new Request("http://localhost/api/v1/guardian/decisions", { method: "GET" }),
      );
      expect(decisionsResponse.status).toBe(200);
      const decisionsBody = await decisionsResponse.json();
      expect(
        decisionsBody.decisions.some(
          (decision: { toolId: string; status: string }) =>
            decision.toolId === "tool-epsilon" && decision.status === "quarantined",
        ),
      ).toBe(true);
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
      expect(status.integrationFailures.some((failure) => failure.toolId === "tool-zeta")).toBe(
        true,
      );
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

describe("probeExposedToolsHealth", () => {
  test("marks an offline exposed tool healthy when its /health responds 200", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      // Register a tool that is exposed but has never heartbeated
      systemsApiService.registerSystemsApiTool({
        id: "nexus-chat",
        name: "Nexus Chat",
        description: "Chat service",
        exposed: true,
        upstreamUrl: "http://127.0.0.1:9991",
      });
      // Expire it so it shows offline
      systemsApiService.updateSystemsApiTool("nexus-chat", {
        health: "offline" as const,
      });

      const before = systemsApiService.getSystemsApiTool("nexus-chat");
      expect(before?.health).toBe("offline");

      // Stub fetch to return 200
      const originalFetch = global.fetch;
      global.fetch = async (_url: string | Request | URL) => new Response(null, { status: 200 });
      try {
        const result = await systemsApiService.probeExposedToolsHealth();
        expect(result.probed).toBe(1);
        expect(result.recovered).toBe(1);
        expect(result.failed).toBe(0);
      } finally {
        global.fetch = originalFetch;
      }

      const after = systemsApiService.getSystemsApiTool("nexus-chat");
      expect(after?.health).toBe("healthy");
      expect(after?.registrationStatus).toBe("active");
    } finally {
      harness.cleanup();
    }
  });

  test("leaves a tool offline when its /health responds non-2xx", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "nexus-broken",
        name: "Nexus Broken",
        description: "Broken service",
        exposed: true,
        upstreamUrl: "http://127.0.0.1:9992",
      });

      const originalFetch = global.fetch;
      global.fetch = async (_url: string | Request | URL) => new Response(null, { status: 503 });
      try {
        await systemsApiService.probeExposedToolsHealth();
      } finally {
        global.fetch = originalFetch;
      }

      const after = systemsApiService.getSystemsApiTool("nexus-broken");
      expect(after?.health).toBe("offline");
    } finally {
      harness.cleanup();
    }
  });

  test("does not probe tools without an upstreamUrl", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "nexus-no-upstream",
        name: "No Upstream",
        description: "Tool with no upstream",
        exposed: true,
      });

      let fetchCalled = false;
      const originalFetch = global.fetch;
      global.fetch = async (_url: string | Request | URL) => {
        fetchCalled = true;
        return new Response(null, { status: 200 });
      };
      try {
        const result = await systemsApiService.probeExposedToolsHealth();
        expect(result.probed).toBe(0);
        expect(fetchCalled).toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    } finally {
      harness.cleanup();
    }
  });

  test("does not probe non-exposed tools", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "nexus-internal",
        name: "Internal Tool",
        description: "Not exposed",
        exposed: false,
        upstreamUrl: "http://127.0.0.1:9993",
      });

      let fetchCalled = false;
      const originalFetch = global.fetch;
      global.fetch = async (_url: string | Request | URL) => {
        fetchCalled = true;
        return new Response(null, { status: 200 });
      };
      try {
        const result = await systemsApiService.probeExposedToolsHealth();
        expect(result.probed).toBe(0);
        expect(fetchCalled).toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    } finally {
      harness.cleanup();
    }
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";
import { apiRouteManifest } from "./routes";

const routePaths = apiRouteManifest.map((route) => route.path);

describe("API route handlers", () => {
  let handleRequest: (request: Request) => Promise<Response>;
  let systemsApiService: typeof import("../systems-api").systemsApiService;
  let cleanup: () => void;

  beforeAll(async () => {
    const harness = await createSystemsApiTestHarness();
    handleRequest = harness.handleRequest;
    systemsApiService = harness.systemsApiService;
    cleanup = harness.cleanup;
  });

  afterAll(() => {
    cleanup?.();
  });

  test("shares a canonical manifest that includes the exposure lifecycle routes", () => {
    expect(routePaths).toContain("/api/v1/exposures/:toolId");
    expect(routePaths).toContain("/api/v1/exposures/:toolId/revoke");
    expect(routePaths).toContain("/api/v1/compliance/phantom");
    expect(routePaths).toContain("/api/v1/compliance/phantom/summary");
    expect(routePaths).toContain("/api/v1/trust/summary");
    expect(routePaths).toContain("/v1/nodes/trust/bulk");
    expect(routePaths).toContain("/v1/nodes/:nodeId/trust/promote");
    expect(routePaths).toContain("/v1/nodes/:nodeId/trust/quarantine");
    expect(routePaths).toContain("/v1/nodes/:nodeId/trust/revoke");
  });

  test("serves compact trust summary for dashboard polling", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/v1/trust/summary", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      scope: "trust-lifecycle",
      trust: {
        nodes: {
          total: expect.any(Number),
          pending: expect.any(Number),
          verified: expect.any(Number),
          trusted: expect.any(Number),
          quarantined: expect.any(Number),
          revoked: expect.any(Number),
          expired: expect.any(Number),
        },
        peers: {
          total: expect.any(Number),
          pending: expect.any(Number),
          verified: expect.any(Number),
          trusted: expect.any(Number),
          quarantined: expect.any(Number),
          revoked: expect.any(Number),
          expired: expect.any(Number),
        },
        updatedAt: expect.any(String),
      },
    });
    expect(body.tools).toBeUndefined();
    expect(body.publicUrls).toBeUndefined();
  });

  test("enforces trusted peer gating for inbound federation announcements", async () => {
    const blocked = await handleRequest(
      new Request("http://localhost/v1/federation/peers/announce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          did: "did:nexus:peer-a",
          shortId: "peer-a",
          upstreamUrl: "https://peer-a.example.net",
        }),
      }),
    );
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).reasonCode).toBe("FEDERATION_PEER_UNREGISTERED");
  });

  test("supports operator node trust promotion/quarantine/revoke", async () => {
    const register = await handleRequest(
      new Request("http://localhost/v1/nodes/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "ops-node",
          region: "eu-west-1",
          zone: "eu-west-1a",
          labels: { role: "ops" },
          capacity: { cpu: 4, memoryMb: 8192, storageGb: 100 },
        }),
      }),
    );
    expect(register.status).toBe(201);
    const registeredNode = (await register.json()).node;

    const promote = await handleRequest(
      new Request(
        `http://localhost/v1/nodes/${encodeURIComponent(registeredNode.id)}/trust/promote`,
        { method: "POST" },
      ),
    );
    expect(promote.status).toBe(200);
    expect((await promote.json()).node.trustState).toBe("trusted");

    const quarantine = await handleRequest(
      new Request(
        `http://localhost/v1/nodes/${encodeURIComponent(registeredNode.id)}/trust/quarantine`,
        { method: "POST" },
      ),
    );
    expect(quarantine.status).toBe(200);
    expect((await quarantine.json()).node.trustState).toBe("quarantined");

    const revoke = await handleRequest(
      new Request(
        `http://localhost/v1/nodes/${encodeURIComponent(registeredNode.id)}/trust/revoke`,
        { method: "POST" },
      ),
    );
    expect(revoke.status).toBe(200);
    const revokedNode = (await revoke.json()).node;
    expect(revokedNode.trustState).toBe("revoked");
    expect(revokedNode.status).toBe("offline");
  });

  test("supports bulk node trust operations with partial-failure reporting", async () => {
    const first = await handleRequest(
      new Request("http://localhost/v1/nodes/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "bulk-node-a",
          region: "eu-west-1",
          zone: "eu-west-1a",
          labels: { role: "ops" },
          capacity: { cpu: 4, memoryMb: 8192, storageGb: 100 },
        }),
      }),
    );
    const second = await handleRequest(
      new Request("http://localhost/v1/nodes/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "bulk-node-b",
          region: "eu-west-1",
          zone: "eu-west-1b",
          labels: { role: "ops" },
          capacity: { cpu: 4, memoryMb: 8192, storageGb: 100 },
        }),
      }),
    );

    const nodeA = (await first.json()).node;
    const nodeB = (await second.json()).node;

    const response = await handleRequest(
      new Request("http://localhost/v1/nodes/trust/bulk", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-actor": "ops@example" },
        body: JSON.stringify({
          operations: [
            { nodeId: nodeA.id, action: "promote", reason: "incident-mitigation" },
            { nodeId: nodeB.id, action: "quarantine", reason: "suspicious-telemetry" },
            { nodeId: "missing-node", action: "revoke", reason: "cleanup" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
    expect(body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: nodeA.id,
          action: "promote",
          ok: true,
          node: expect.objectContaining({ trustState: "trusted" }),
        }),
        expect.objectContaining({
          nodeId: nodeB.id,
          action: "quarantine",
          ok: true,
          node: expect.objectContaining({ trustState: "quarantined" }),
        }),
        expect.objectContaining({
          nodeId: "missing-node",
          action: "revoke",
          ok: false,
          reasonCode: "NODE_NOT_FOUND",
        }),
      ]),
    );
  });

  test("returns explicit policy reason code when all nodes are trust-blocked", async () => {
    const register = await handleRequest(
      new Request("http://localhost/v1/nodes/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "blocked-node",
          region: "eu-west-1",
          zone: "eu-west-1a",
          labels: { role: "ops" },
          capacity: { cpu: 4, memoryMb: 8192, storageGb: 100 },
        }),
      }),
    );
    const _node = (await register.json()).node;

    const nodesList = await handleRequest(
      new Request("http://localhost/v1/nodes", { method: "GET" }),
    );
    const allNodes = (await nodesList.json()).nodes as Array<{ id: string }>;
    await Promise.all(
      allNodes.map((registeredNode) =>
        handleRequest(
          new Request(
            `http://localhost/v1/nodes/${encodeURIComponent(registeredNode.id)}/trust/revoke`,
            { method: "POST" },
          ),
        ),
      ),
    );

    const workload = await handleRequest(
      new Request("http://localhost/v1/workloads/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "workload-trust-blocked",
          name: "trust blocked workload",
          image: "nginx:latest",
          replicas: 1,
          cpuMillicores: 100,
          memoryMb: 128,
          env: {},
          ports: [80],
          runtime: "container",
          storage: [],
        }),
      }),
    );

    expect(workload.status).toBe(409);
    const body = await workload.json();
    expect(body.policy.reasonCode).toBe("POLICY_ONLY_UNTRUSTED_NODES");
  });

  test("includes trust summaries in both legacy and v1 status endpoints", async () => {
    const legacy = await handleRequest(
      new Request("http://localhost/api/status", { method: "GET" }),
    );
    expect(legacy.status).toBe(200);
    const legacyBody = await legacy.json();
    expect(legacyBody.node_trust_summary).toEqual({
      total: expect.any(Number),
      pending: expect.any(Number),
      verified: expect.any(Number),
      trusted: expect.any(Number),
      quarantined: expect.any(Number),
      revoked: expect.any(Number),
      expired: expect.any(Number),
    });
    expect(legacyBody.peer_trust_summary).toEqual({
      total: expect.any(Number),
      pending: expect.any(Number),
      verified: expect.any(Number),
      trusted: expect.any(Number),
      quarantined: expect.any(Number),
      revoked: expect.any(Number),
      expired: expect.any(Number),
    });

    const status = await handleRequest(
      new Request("http://localhost/api/v1/status", { method: "GET" }),
    );
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.status?.trust).toEqual({
      nodes: {
        total: expect.any(Number),
        pending: expect.any(Number),
        verified: expect.any(Number),
        trusted: expect.any(Number),
        quarantined: expect.any(Number),
        revoked: expect.any(Number),
        expired: expect.any(Number),
      },
      peers: {
        total: expect.any(Number),
        pending: expect.any(Number),
        verified: expect.any(Number),
        trusted: expect.any(Number),
        quarantined: expect.any(Number),
        revoked: expect.any(Number),
        expired: expect.any(Number),
      },
      updatedAt: expect.any(String),
    });
  });

  test("supports compact trust query mode on /api/v1/status for client migration", async () => {
    const status = await handleRequest(
      new Request("http://localhost/api/v1/status?compact=trust", { method: "GET" }),
    );
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body).toEqual({
      scope: "trust-lifecycle",
      trust: {
        nodes: {
          total: expect.any(Number),
          pending: expect.any(Number),
          verified: expect.any(Number),
          trusted: expect.any(Number),
          quarantined: expect.any(Number),
          revoked: expect.any(Number),
          expired: expect.any(Number),
        },
        peers: {
          total: expect.any(Number),
          pending: expect.any(Number),
          verified: expect.any(Number),
          trusted: expect.any(Number),
          quarantined: expect.any(Number),
          revoked: expect.any(Number),
          expired: expect.any(Number),
        },
        updatedAt: expect.any(String),
      },
    });
    expect(body.status).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.publicUrls).toBeUndefined();
  });

  test("supports conditional ETag polling for compact status and summary endpoints", async () => {
    const compact = await handleRequest(
      new Request("http://localhost/api/v1/status?compact=trust", { method: "GET" }),
    );
    expect(compact.status).toBe(200);
    const compactEtag = compact.headers.get("etag");
    expect(compactEtag).toEqual(expect.any(String));
    const compactEtagVal = compactEtag as string;

    const compact304 = await handleRequest(
      new Request("http://localhost/api/v1/status?compact=trust", {
        method: "GET",
        headers: { "if-none-match": compactEtagVal },
      }),
    );
    expect(compact304.status).toBe(304);

    const trustSummary = await handleRequest(
      new Request("http://localhost/api/v1/trust/summary", { method: "GET" }),
    );
    expect(trustSummary.status).toBe(200);
    const trustEtag = trustSummary.headers.get("etag");
    expect(trustEtag).toEqual(expect.any(String));
    const trustEtagVal = trustEtag as string;

    const trust304 = await handleRequest(
      new Request("http://localhost/api/v1/trust/summary", {
        method: "GET",
        headers: { "if-none-match": trustEtagVal },
      }),
    );
    expect(trust304.status).toBe(304);

    const phantomSummary = await handleRequest(
      new Request("http://localhost/api/v1/compliance/phantom/summary", { method: "GET" }),
    );
    expect(phantomSummary.status).toBe(200);
    const phantomEtag = phantomSummary.headers.get("etag");
    expect(phantomEtag).toEqual(expect.any(String));
    const phantomEtagVal = phantomEtag as string;

    const phantom304 = await handleRequest(
      new Request("http://localhost/api/v1/compliance/phantom/summary", {
        method: "GET",
        headers: { "if-none-match": phantomEtagVal },
      }),
    );
    expect(phantom304.status).toBe(304);
  });

  test("serves GET /api/v1/exposures/:toolId and POST /api/v1/exposures/:toolId/revoke end-to-end", async () => {
    systemsApiService.registerSystemsApiTool({
      id: "tool-alpha",
      name: "Alpha",
      description: "Alpha tool",
      upstreamUrl: "http://127.0.0.1:5100",
      exposed: false,
      health: "healthy",
      capabilities: ["exposure.lifecycle"],
    });
    const exposure = systemsApiService.requestSystemsApiExposure({
      toolId: "tool-alpha",
      desiredHost: "alpha.example.com",
    });
    expect(exposure).not.toBeNull();

    const getResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures/tool-alpha", { method: "GET" }),
    );
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      exposure: {
        target: {
          toolId: "tool-alpha",
          publicUrl: "https://alpha.example.com",
          domain: null,
          verificationToken: null,
          status: "active",
          target: "https://tool-alpha.nexus.local",
          expiresAt: expect.any(String),
          revokedAt: null,
        },
      },
    });

    const revokeResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures/tool-alpha/revoke", { method: "POST" }),
    );
    expect(revokeResponse.status).toBe(200);
    expect(await revokeResponse.json()).toEqual({
      exposure: {
        target: {
          toolId: "tool-alpha",
          publicUrl: "https://alpha.example.com",
          domain: null,
          verificationToken: null,
          status: "revoked",
          target: "https://tool-alpha.nexus.local",
          expiresAt: expect.any(String),
          revokedAt: expect.any(String),
        },
      },
    });

    const afterRevokeResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures/tool-alpha", { method: "GET" }),
    );
    expect(afterRevokeResponse.status).toBe(200);
    expect(await afterRevokeResponse.json()).toEqual({
      exposure: {
        target: {
          toolId: "tool-alpha",
          publicUrl: "https://alpha.example.com",
          domain: null,
          verificationToken: null,
          status: "revoked",
          target: "https://tool-alpha.nexus.local",
          expiresAt: expect.any(String),
          revokedAt: expect.any(String),
        },
      },
    });

    const missingGetResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures/missing-tool", { method: "GET" }),
    );
    expect(missingGetResponse.status).toBe(404);

    const missingRevokeResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures/missing-tool/revoke", { method: "POST" }),
    );
    expect(missingRevokeResponse.status).toBe(404);
  });

  test("serves GET /api/v1/exposures as a lifecycle list and reflects revocation", async () => {
    systemsApiService.registerSystemsApiTool({
      id: "tool-beta",
      name: "Beta",
      description: "Beta tool",
      upstreamUrl: "http://127.0.0.1:5200",
      exposed: false,
      health: "healthy",
      capabilities: ["exposure.lifecycle"],
    });

    const created = systemsApiService.requestSystemsApiExposure({
      toolId: "tool-beta",
      desiredHost: "beta.example.com",
    });
    expect(created).not.toBeNull();

    const beforeResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures", { method: "GET" }),
    );
    expect(beforeResponse.status).toBe(200);
    expect(await beforeResponse.json()).toEqual({
      exposures: expect.arrayContaining([
        {
          target: {
            toolId: "tool-alpha",
            publicUrl: "https://alpha.example.com",
            domain: null,
            verificationToken: null,
            status: "revoked",
            target: "https://tool-alpha.nexus.local",
            expiresAt: expect.any(String),
            revokedAt: expect.any(String),
          },
        },
        {
          target: {
            toolId: "tool-beta",
            publicUrl: "https://beta.example.com",
            domain: null,
            verificationToken: null,
            status: "active",
            target: "https://tool-beta.nexus.local",
            expiresAt: expect.any(String),
            revokedAt: null,
          },
        },
      ]),
    });

    const revokeResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures/tool-beta/revoke", { method: "POST" }),
    );
    expect(revokeResponse.status).toBe(200);

    const afterResponse = await handleRequest(
      new Request("http://localhost/api/v1/exposures", { method: "GET" }),
    );
    expect(afterResponse.status).toBe(200);
    expect(await afterResponse.json()).toEqual({
      exposures: expect.arrayContaining([
        {
          target: {
            toolId: "tool-alpha",
            publicUrl: "https://alpha.example.com",
            domain: null,
            verificationToken: null,
            status: "revoked",
            target: "https://tool-alpha.nexus.local",
            expiresAt: expect.any(String),
            revokedAt: expect.any(String),
          },
        },
        {
          target: {
            toolId: "tool-beta",
            publicUrl: "https://beta.example.com",
            domain: null,
            verificationToken: null,
            status: "revoked",
            target: "https://tool-beta.nexus.local",
            expiresAt: expect.any(String),
            revokedAt: expect.any(String),
          },
        },
      ]),
    });
  });

  test("supports Guardian operator actions for approve/deny/suspend/quarantine", async () => {
    systemsApiService.registerSystemsApiTool({
      id: "tool-guardian",
      name: "Guardian Subject",
      description: "Tool used for guardian workflow tests",
      upstreamUrl: "http://127.0.0.1:5400",
      exposed: false,
      health: "degraded",
      capabilities: ["exposure.lifecycle"],
    });

    const exposureCreate = await handleRequest(
      new Request("http://localhost/api/v1/exposures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId: "tool-guardian", desiredHost: "guardian.example.com" }),
      }),
    );
    expect(exposureCreate.status).toBe(201);

    const subjectId = encodeURIComponent("tool-guardian:exposure");

    const approve = await handleRequest(
      new Request(`http://localhost/api/v1/guardian/exposure/${subjectId}/approve`, {
        method: "POST",
      }),
    );
    expect(approve.status).toBe(200);
    expect((await approve.json()).decision.status).toBe("approved");

    const suspend = await handleRequest(
      new Request(`http://localhost/api/v1/guardian/exposure/${subjectId}/suspend`, {
        method: "POST",
      }),
    );
    expect(suspend.status).toBe(200);
    expect((await suspend.json()).decision.status).toBe("suspended");

    const quarantine = await handleRequest(
      new Request(`http://localhost/api/v1/guardian/exposure/${subjectId}/quarantine`, {
        method: "POST",
      }),
    );
    expect(quarantine.status).toBe(200);
    expect((await quarantine.json()).decision.status).toBe("quarantined");

    const deny = await handleRequest(
      new Request(`http://localhost/api/v1/guardian/exposure/${subjectId}/deny`, {
        method: "POST",
      }),
    );
    expect(deny.status).toBe(200);
    expect((await deny.json()).decision.status).toBe("denied");

    const missing = await handleRequest(
      new Request("http://localhost/api/v1/guardian/exposure/missing-subject/approve", {
        method: "POST",
      }),
    );
    expect(missing.status).toBe(404);
  });

  test("accepts phantomSecurityProfile during tool registration and heartbeat over HTTP", async () => {
    const registerResponse = await handleRequest(
      new Request("http://localhost/api/v1/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "tool-phantom-http",
          name: "Phantom HTTP Tool",
          description: "HTTP registration path",
          upstreamUrl: "http://127.0.0.1:5500",
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
              zkProofSystem: "plonk",
              proofAttestation: "attested",
              proofEndpoint: "https://tool-phantom-http.nexus.local/proofs",
            },
          },
        }),
      }),
    );

    expect(registerResponse.status).toBe(201);
    const registerBody = await registerResponse.json();
    expect(registerBody.tool.phantomSecurityProfile.claimedSecured).toBe(true);
    expect(registerBody.tool.phantomSecurityProfile.protectionLevel).toBe("hardened");

    const heartbeatResponse = await handleRequest(
      new Request("http://localhost/api/v1/tools/tool-phantom-http/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          health: "degraded",
          phantomSecurityProfile: {
            claimedSecured: true,
            protectionLevel: "maximum",
            guarantees: {
              postQuantum: true,
              fheTransport: true,
              zkProofs: true,
            },
            metadata: {
              pqAlgorithms: ["ml-kem-768"],
              fheScheme: "bfv",
              zkProofSystem: "halo2",
              proofAttestation: "heartbeat-attested",
              proofEndpoint: "https://tool-phantom-http.nexus.local/proofs/latest",
            },
          },
        }),
      }),
    );

    expect(heartbeatResponse.status).toBe(200);
    const heartbeatBody = await heartbeatResponse.json();
    expect(heartbeatBody.tool.health).toBe("degraded");
    expect(heartbeatBody.tool.phantomSecurityProfile.protectionLevel).toBe("maximum");
    expect(heartbeatBody.tool.phantomSecurityProfile.metadata.proofEndpoint).toBe(
      "https://tool-phantom-http.nexus.local/proofs/latest",
    );
  });

  test("serves failing-only PHANTOM compliance filters for ops dashboards", async () => {
    await handleRequest(
      new Request("http://localhost/api/v1/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "tool-phantom-compliant",
          name: "Compliant",
          description: "Compliant PHANTOM profile",
          upstreamUrl: "http://127.0.0.1:5600",
          health: "healthy",
          capabilities: [],
          phantomSecurityProfile: {
            claimedSecured: true,
            protectionLevel: "hardened",
            guarantees: {
              postQuantum: true,
              fheTransport: true,
              zkProofs: true,
            },
            metadata: {
              pqAlgorithms: ["ml-kem-768"],
              fheScheme: "ckks",
              zkProofSystem: "plonk",
              proofAttestation: "ok",
              proofEndpoint: "https://tool-phantom-compliant.nexus.local/proofs",
            },
          },
        }),
      }),
    );

    await handleRequest(
      new Request("http://localhost/api/v1/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "tool-phantom-failing",
          name: "Failing",
          description: "Failing PHANTOM profile",
          upstreamUrl: "http://127.0.0.1:5700",
          health: "healthy",
          capabilities: [],
          phantomSecurityProfile: {
            claimedSecured: true,
            protectionLevel: "hardened",
            guarantees: {
              postQuantum: true,
              fheTransport: true,
              zkProofs: true,
            },
            metadata: {
              pqAlgorithms: ["ml-kem-768"],
              fheScheme: "ckks",
            },
          },
        }),
      }),
    );

    const failingToolsResponse = await handleRequest(
      new Request("http://localhost/api/v1/tools?phantomCompliance=failing", { method: "GET" }),
    );
    expect(failingToolsResponse.status).toBe(200);
    const failingToolsBody = await failingToolsResponse.json();
    const failingToolIds = failingToolsBody.tools.map((tool: { id: string }) => tool.id);
    expect(failingToolIds).toContain("tool-phantom-failing");
    expect(failingToolIds).not.toContain("tool-phantom-compliant");

    const complianceResponse = await handleRequest(
      new Request("http://localhost/api/v1/compliance/phantom?status=failing", { method: "GET" }),
    );
    expect(complianceResponse.status).toBe(200);
    const complianceBody = await complianceResponse.json();
    expect(complianceBody.scope).toBe("phantom-security");
    expect(complianceBody.status).toBe("failing");
    expect(
      complianceBody.entries.every((entry: { compliant: boolean }) => entry.compliant === false),
    ).toBe(true);
    expect(
      complianceBody.failures.some(
        (failure: { toolId: string }) => failure.toolId === "tool-phantom-failing",
      ),
    ).toBe(true);
  });

  test("serves counts-only PHANTOM compliance summary for lightweight polling", async () => {
    const summaryResponse = await handleRequest(
      new Request("http://localhost/api/v1/compliance/phantom/summary", { method: "GET" }),
    );
    expect(summaryResponse.status).toBe(200);

    const summaryBody = await summaryResponse.json();
    expect(summaryBody).toEqual({
      scope: "phantom-security",
      status: "failing",
      claimedSecuredCount: expect.any(Number),
      compliantCount: expect.any(Number),
      failingCount: expect.any(Number),
      updatedAt: expect.any(String),
    });
    expect(summaryBody.claimedSecuredCount).toBeGreaterThanOrEqual(summaryBody.compliantCount);
    expect(summaryBody.failingCount).toBeGreaterThanOrEqual(1);
    expect(summaryBody.claimedSecuredCount).toBe(
      summaryBody.compliantCount + summaryBody.failingCount,
    );
  });

  test("hides tool upstream addresses from anonymous callers on /tools and /status", async () => {
    systemsApiService.registerSystemsApiTool({
      id: "tool-redact",
      name: "Redact",
      description: "Tool used to check upstream redaction",
      upstreamUrl: "http://127.0.0.1:5399",
      exposed: true,
      health: "healthy",
      capabilities: ["redaction.check"],
    });

    // The harness runs with no key, which disables auth instance-wide and so
    // disables redaction with it. Configure one so the gate is exercised.
    const previousKey = process.env.NEXUS_CLOUD_API_KEY;
    const key = "upstream-redaction-test-key";
    process.env.NEXUS_CLOUD_API_KEY = key;

    const toolsOf = async (headers: Record<string, string>, path: string) => {
      const res = await handleRequest(new Request(`http://localhost${path}`, { method: "GET", headers }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tools?: Array<Record<string, unknown>> };
      return (body.tools ?? []).filter((t) => t.id === "tool-redact");
    };

    try {
      for (const path of ["/api/v1/tools", "/api/v1/status"]) {
        const anonymous = await toolsOf({}, path);
        expect(anonymous.length).toBe(1);
        // The record is still served — only the private address is withheld.
        expect(anonymous[0]?.id).toBe("tool-redact");
        expect(anonymous[0]?.name).toBe("Redact");
        expect(anonymous[0]).not.toHaveProperty("upstreamUrl");

        const authorized = await toolsOf({ "x-api-key": key }, path);
        expect(authorized.length).toBe(1);
        expect(authorized[0]?.upstreamUrl).toBe("http://127.0.0.1:5399");
      }
    } finally {
      process.env.NEXUS_CLOUD_API_KEY = previousKey ?? "";
    }
  });

  test("requires the API key to read routing topology, but never for tls-ask", async () => {
    // The harness runs with no key, which disables auth entirely. Configure one
    // for this test so the gate is actually exercised.
    const previousKey = process.env.NEXUS_CLOUD_API_KEY;
    const key = "topology-read-test-key";
    process.env.NEXUS_CLOUD_API_KEY = key;

    try {
      for (const path of ["/api/v1/routes", "/api/v1/routes/caddy", "/api/v1/routes/zone"]) {
        const anonymous = await handleRequest(
          new Request(`http://localhost${path}`, { method: "GET" }),
        );
        expect(anonymous.status).toBe(401);

        const wrongKey = await handleRequest(
          new Request(`http://localhost${path}`, {
            method: "GET",
            headers: { "x-api-key": "not-the-key" },
          }),
        );
        expect(wrongKey.status).toBe(401);

        const authorized = await handleRequest(
          new Request(`http://localhost${path}`, {
            method: "GET",
            headers: { "x-api-key": key },
          }),
        );
        expect(authorized.status).toBe(200);
      }

      // Caddy calls tls-ask during a TLS handshake and cannot present a
      // credential, so gating it would stop every certificate from being issued.
      const ask = await handleRequest(
        new Request("http://localhost/api/v1/routes/tls-ask?domain=absent.nexus.local", {
          method: "GET",
        }),
      );
      expect(ask.status).not.toBe(401);

      // status.html fetches these anonymously from the browser.
      for (const path of ["/api/v1/tools", "/health"]) {
        const open = await handleRequest(new Request(`http://localhost${path}`, { method: "GET" }));
        expect(open.status).toBe(200);
      }
    } finally {
      process.env.NEXUS_CLOUD_API_KEY = previousKey ?? "";
    }
  });

  test("storage pools do not leak credentials to anonymous callers", async () => {
    // GET /api/v1/storage/pools answers on the public cloud subdomain and had no
    // auth check, so it served each pool's accessKey and secretKey to anyone.
    // A shared pool holds other people's data; federation exists to make these
    // endpoints reachable and their credentials real.
    // With no API key configured Cloud treats every caller as authenticated, so
    // redaction correctly does not apply. Set one, or this test would pass
    // against a server that leaks.
    const previousKey = process.env.NEXUS_CLOUD_API_KEY;
    process.env.NEXUS_CLOUD_API_KEY = "leak-check-key";  // pragma: allowlist secret — literal test value, not a credential
    try {
    const created = await handleRequest(
      new Request("http://localhost/api/v1/storage/pools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "leak-check-pool", totalCapacityGb: 10 }),
      }),
    );
    expect(created.status).toBe(201);

    const anonymous = await handleRequest(
      new Request("http://localhost/api/v1/storage/pools", { method: "GET" }),
    );
    expect(anonymous.status).toBe(200);
    const body = (await anonymous.json()) as {
      pools: Array<Record<string, unknown>>;
    };
    const pool = body.pools.find((p) => p["name"] === "leak-check-pool");
    expect(pool).toBeDefined();
    expect(pool?.["accessKey"]).toBeUndefined();
    expect(pool?.["secretKey"]).toBeUndefined();
    expect(pool?.["endpoint"]).toBeUndefined();
    // The non-secret fields must still be there, or this would be redacting by
    // breaking the endpoint rather than by removing the secrets.
    expect(pool?.["id"]).toBeDefined();
    expect(pool?.["totalCapacityGb"]).toBe(10);

    // Nothing anywhere in the anonymous payload may contain the secret.
    expect(JSON.stringify(body)).not.toContain("minioadmin");
    } finally {
      process.env.NEXUS_CLOUD_API_KEY = previousKey ?? "";
    }
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";

const proposal = {
  suggestedShelves: ["everyday"],
  suggestedAudiences: ["general"],
  capabilities: ["messaging"],
  keywords: ["chat"],
  submittedAt: "2026-10-17T00:00:00.000Z",
  version: 2,
};

function request(path: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

describe("catalog proposal routes", () => {
  let handleRequest: (request: Request) => Promise<Response>;
  let service: typeof import("../systems-api").systemsApiService;
  let cleanup: () => void;

  beforeAll(async () => {
    const harness = await createSystemsApiTestHarness();
    handleRequest = harness.handleRequest;
    service = harness.systemsApiService;
    cleanup = harness.cleanup;
  });
  afterAll(() => cleanup?.());

  test("registration stores a pending proposal without self-approval", async () => {
    const response = await handleRequest(request("/api/v1/tools", "POST", {
      id: "catalog-registration", name: "Catalog Registration", description: "Messaging", catalogProposal: proposal,
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.catalog).toMatchObject({ toolId: "catalog-registration", proposal, approved: null, reviewStatus: "pending" });
    expect(service.getCatalogRecord("catalog-registration")?.approved).toBeNull();
  });

  test("rejects malformed registration proposals without registering the tool", async () => {
    const response = await handleRequest(request("/api/v1/tools", "POST", {
      id: "catalog-invalid", name: "Invalid", description: "Invalid", catalogProposal: { ...proposal, suggestedShelves: ["unknown"] },
    }));
    expect(response.status).toBe(400);
    expect(service.getSystemsApiTool("catalog-invalid")).toBeNull();
  });

  test("proposal update preserves the previous approved record", async () => {
    service.registerSystemsApiTool({ id: "catalog-approved", name: "Approved", description: "Approved" });
    const approved = {
      primaryShelf: "work" as const, secondaryShelves: [], audiences: ["business" as const], capabilities: ["messaging"],
      maturity: "stable" as const, visibility: "default" as const,
      approvedAt: "2026-10-16T00:00:00.000Z", approvedBy: "platform:catalog", version: 1,
    };
    service.saveApprovedCatalog("catalog-approved", approved);
    const response = await handleRequest(request("/api/v1/tools/catalog-approved/catalog-proposal", "POST", proposal));
    expect(response.status).toBe(200);
    expect((await response.json()).catalog).toMatchObject({ proposal, approved, reviewStatus: "pending" });
    expect(service.getCatalogRecord("catalog-approved")?.approved).toEqual(approved);
  });

  test("a tool without metadata reads as an Explore fallback", async () => {
    service.registerSystemsApiTool({ id: "catalog-legacy", name: "Legacy", description: "Legacy" });
    const response = await handleRequest(request("/api/v1/catalog/catalog-legacy", "GET"));
    expect(response.status).toBe(200);
    expect((await response.json()).catalog).toMatchObject({ toolId: "catalog-legacy", primaryShelf: "explore", reviewStatus: "pending" });
  });

  test("patch can submit a proposal and omitted fields preserve catalog state", async () => {
    service.registerSystemsApiTool({ id: "catalog-patch", name: "Patch", description: "Patch" });
    const patch = await handleRequest(request("/api/v1/tools/catalog-patch", "PATCH", { catalogProposal: proposal }));
    expect(patch.status).toBe(200);
    expect((await patch.json()).catalog.reviewStatus).toBe("pending");
    const heartbeat = await handleRequest(request("/api/v1/tools/catalog-patch/heartbeat", "POST", {}));
    expect(heartbeat.status).toBe(200);
    const register = await handleRequest(request("/api/v1/tools", "POST", { id: "catalog-patch", name: "Patch", description: "Again" }));
    expect(register.status).toBe(201);
    expect(service.getCatalogRecord("catalog-patch")?.proposal).toEqual(proposal);
  });

  test("unknown tools return 404 and malformed explicit proposals return 400", async () => {
    expect((await handleRequest(request("/api/v1/catalog/missing", "GET"))).status).toBe(404);
    expect((await handleRequest(request("/api/v1/tools/missing/catalog-proposal", "POST", proposal))).status).toBe(404);
    const response = await handleRequest(request("/api/v1/tools/catalog-legacy/catalog-proposal", "POST", { ...proposal, version: 0 }));
    expect(response.status).toBe(400);
  });

  test("catalog reads and proposal writes retain the API-key boundary", async () => {
    const previousKey = process.env.NEXUS_CLOUD_API_KEY;
    process.env.NEXUS_CLOUD_API_KEY = "catalog-test-key";
    try {
      expect((await handleRequest(request("/api/v1/catalog/catalog-legacy", "GET"))).status).toBe(401);
      expect((await handleRequest(request("/api/v1/tools/catalog-legacy/catalog-proposal", "POST", proposal))).status).toBe(401);
      const anonymousTools = await handleRequest(request("/api/v1/tools", "GET"));
      expect((await anonymousTools.json()).catalog).toBeUndefined();
      const trusted = await handleRequest(new Request("http://localhost/api/v1/catalog/catalog-legacy", { headers: { "x-api-key": "catalog-test-key" } }));
      expect(trusted.status).toBe(200);
      const trustedTools = await handleRequest(new Request("http://localhost/api/v1/tools", { headers: { "x-api-key": "catalog-test-key" } }));
      expect((await trustedTools.json()).catalog).toEqual(expect.arrayContaining([expect.objectContaining({ toolId: "catalog-legacy" })]));
    } finally {
      process.env.NEXUS_CLOUD_API_KEY = previousKey ?? "";
    }
  });
});

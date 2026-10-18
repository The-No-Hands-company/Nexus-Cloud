import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";
import type { SystemsApiCatalogResponseDTO, SystemsApiCatalogListResponseDTO } from "./dto";

import type { CatalogProposal } from "../systems-api/catalog";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { setJsonStoreAfterReplaceHookForTests } from "../persistence/json-store";
import { expireToolHeartbeat } from "../systems-api/registry";
import { tmpdir } from "node:os";

const proposal: CatalogProposal = {
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
    const { catalog } = (await response.json()) as SystemsApiCatalogResponseDTO;
    expect(catalog).toMatchObject({ toolId: "catalog-legacy", primaryShelf: "explore", reviewStatus: "pending" });
    if (catalog.approved !== null) throw new Error("Expected Explore fallback");
    expect(catalog.primaryShelf).toBe("explore");
    expect(catalog.visibility).toBe("discoverable");
  });

  test("catalog projection joins runtime, approval, pending status and stable fallback", async () => {
    service.registerSystemsApiTool({ id: "projection-zeta", name: "Zeta", description: "Legacy", publicUrl: "https://zeta.example", upstreamUrl: "http://127.0.0.1:9999" });
    service.registerSystemsApiTool({ id: "projection-alpha", name: "Alpha", description: "Approved", publicUrl: "https://alpha.example", catalogProposal: proposal });
    service.saveApprovedCatalog("projection-alpha", { primaryShelf: "work", secondaryShelves: ["everyday"], audiences: ["business"], capabilities: ["chat"], maturity: "stable", visibility: "default", approvedAt: "2026-10-17T00:00:00.000Z", approvedBy: "platform", version: 2 });
    service.registerSystemsApiTool({ id: "projection-pending", name: "Pending", description: "Pending", publicUrl: "https://pending.example", catalogProposal: proposal });
    service.registerSystemsApiTool({ id: "projection-restricted", name: "Restricted", description: "Restricted", publicUrl: "https://restricted.example", catalogProposal: proposal });
    service.saveApprovedCatalog("projection-restricted", { primaryShelf: "operate", secondaryShelves: [], audiences: ["operations"], capabilities: [], maturity: "preview", visibility: "restricted", approvedAt: "2026-10-17T00:00:00.000Z", approvedBy: "platform", version: 2 });
    service.registerSystemsApiTool({ id: "projection-offline", name: "Offline", description: "Offline" });
    expireToolHeartbeat("projection-offline");
    const response = await handleRequest(request("/api/v1/catalog", "GET"));
    expect(response.status).toBe(200);
    const { apps } = (await response.json()) as SystemsApiCatalogListResponseDTO;
    const ours = apps.filter((app) => app.id.startsWith("projection-"));
    expect(ours.map((app) => app.name)).toEqual(["Alpha", "Offline", "Pending", "Restricted", "Zeta"]);
    expect(ours[0]).toMatchObject({ primaryShelf: "work", reviewStatus: "approved", health: "healthy", publicUrl: "https://alpha.example" });
    expect(ours[1]).toMatchObject({ primaryShelf: "explore", visibility: "discoverable", health: "offline", reviewStatus: "pending" });
    expect(ours[2]).toMatchObject({ primaryShelf: "explore", capabilities: [], reviewStatus: "pending" });
    expect(ours[3]).toMatchObject({ primaryShelf: "operate", visibility: "restricted", maturity: "preview" });
    expect(ours[4]).toMatchObject({ primaryShelf: "explore", secondaryShelves: [], audiences: [], maturity: "experimental" });
  });

  test("anonymous projection redacts upstream and hidden entries; platform key retains both", async () => {
    service.registerSystemsApiTool({ id: "projection-visible", name: "Visible", description: "Visible", upstreamUrl: "http://private:8081", publicUrl: "https://visible.example" });
    service.registerSystemsApiTool({ id: "projection-hidden", name: "Hidden", description: "Hidden", upstreamUrl: "http://private:8080", publicUrl: "https://hidden.example", catalogProposal: proposal });
    service.saveApprovedCatalog("projection-hidden", { primaryShelf: "operate", secondaryShelves: [], audiences: ["operations"], capabilities: [], maturity: "stable", visibility: "hidden", approvedAt: "2026-10-17T00:00:00.000Z", approvedBy: "platform", version: 2 });
    process.env.NEXUS_CLOUD_API_KEY = "projection-key";
    try {
      const anonymous = await handleRequest(request("/api/v1/catalog", "GET"));
      expect(anonymous.status).toBe(200);
      const anonymousApps = (await anonymous.json()).apps as Array<{ id: string; upstreamUrl?: string }>;
      expect(anonymousApps.some((app) => app.id === "projection-hidden")).toBe(false);
      expect(anonymousApps.find((app) => app.id === "projection-visible")?.upstreamUrl).toBeUndefined();
      const trusted = await handleRequest(new Request("http://localhost/api/v1/catalog", { headers: { "x-api-key": "projection-key" } }));
      expect(trusted.status).toBe(200);
      expect((await trusted.json()).apps).toEqual(expect.arrayContaining([expect.objectContaining({ id: "projection-hidden", visibility: "hidden", upstreamUrl: "http://private:8080" })]));
    } finally {
      process.env.NEXUS_CLOUD_API_KEY = "";
    }
  });

  test("ordinary signed-in users cannot read hidden apps, but permitted catalog consumers can", async () => {
    service.registerSystemsApiTool({ id: "session-hidden", name: "Hidden", description: "Hidden", publicUrl: "https://hidden.example", catalogProposal: proposal });
    service.saveApprovedCatalog("session-hidden", { primaryShelf: "operate", secondaryShelves: [], audiences: [], capabilities: [], maturity: "stable", visibility: "hidden", approvedAt: "2026-10-17T00:00:00.000Z", approvedBy: "platform", version: 2 });
    service.registerSystemsApiTool({ id: "session-visible", name: "Visible", description: "Visible", publicUrl: "https://visible.example", upstreamUrl: "http://private:8082" });
    process.env.NEXUS_CLOUD_API_KEY = "projection-key";
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request, init?: RequestInit) => {
      const credential = new Headers(init?.headers).get("authorization");
      return Response.json({ authorized: true, userId: "user-id", user: { id: "user-id", role: "founder", permissions: ["platform:catalog:approve"] }, permissions: credential === "Bearer trusted" ? ["platform:catalog:approve"] : [] });
    }) as unknown as typeof fetch);
    try {
      const ordinary = await handleRequest(new Request("http://localhost/api/v1/catalog", { headers: { authorization: "Bearer ordinary" } }));
      expect(ordinary.status).toBe(200);
      const ordinaryApps = (await ordinary.json()).apps as Array<{ id: string; upstreamUrl?: string }>;
      expect(ordinaryApps.some((app) => app.id === "session-hidden")).toBe(false);
      expect(ordinaryApps.find((app) => app.id === "session-visible")?.upstreamUrl).toBe("http://private:8082");
      const trusted = await handleRequest(new Request("http://localhost/api/v1/catalog", { headers: { authorization: "Bearer trusted" } }));
      expect((await trusted.json()).apps).toEqual(expect.arrayContaining([expect.objectContaining({ id: "session-hidden", visibility: "hidden" })]));
    } finally {
      fetchSpy.mockRestore();
      process.env.NEXUS_CLOUD_API_KEY = "";
    }
  });

  test("catalog collection is present in endpoint discovery and summary", async () => {
    const endpoints = (await (await handleRequest(request("/api/v1/endpoints", "GET"))).json()).endpoints as Array<{ path: string }>;
    const summary = (await (await handleRequest(request("/api/v1/summary", "GET"))).json()).summary as { endpoints: Array<{ path: string }> };
    expect(endpoints.some((entry) => entry.path === "/api/v1/catalog")).toBe(true);
    expect(summary.endpoints.some((entry) => entry.path === "/api/v1/catalog")).toBe(true);
  });

  test("tenant entitlements and node overlays stay scoped behind the Cloud key", async () => {
    const previousKey = process.env.NEXUS_CLOUD_API_KEY;
    const previousTenantPath = process.env.NEXUS_CLOUD_TENANT_CATALOG_PATH;
    const previousNodePath = process.env.NEXUS_CLOUD_NODE_CATALOG_PATH;
    const dir = mkdtempSync(join(tmpdir(), "nexus-catalog-routes-"));
    process.env.NEXUS_CLOUD_API_KEY = "scoped-catalog-test-key";
    process.env.NEXUS_CLOUD_TENANT_CATALOG_PATH = join(dir, "tenant.json");
    process.env.NEXUS_CLOUD_NODE_CATALOG_PATH = join(dir, "node.json");
    const keyed = (path: string, method: string, body?: unknown) =>
      new Request(`http://localhost${path}`, {
        method,
        headers: { "x-api-key": "scoped-catalog-test-key", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      expect((await handleRequest(request("/api/v1/tenants/tenant-a/catalog", "GET"))).status).toBe(401);

      const tenantPut = await handleRequest(
        keyed("/api/v1/tenants/tenant-a/catalog", "PUT", {
          enabledAppIds: ["nexus-calendar"],
          disabledAppIds: ["nexus-experimental"],
        }),
      );
      expect(tenantPut.status).toBe(200);
      expect((await tenantPut.json()).entitlements).toMatchObject({
        enabledAppIds: ["nexus-calendar"],
        disabledAppIds: ["nexus-experimental"],
      });
      const tenantGet = await handleRequest(keyed("/api/v1/tenants/tenant-a/catalog", "GET"));
      expect((await tenantGet.json()).entitlements).toMatchObject({ enabledAppIds: ["nexus-calendar"] });

      const nodePut = await handleRequest(
        keyed("/api/v1/nodes/node-a/catalog", "PUT", {
          disabledAppIds: ["nexus-chat"],
          shelfOverrides: { "nexus-calendar": "work" },
          localApps: [{ toolId: "node-only", name: "Node Only", primaryShelf: "explore" }],
        }),
      );
      expect(nodePut.status).toBe(200);
      expect((await nodePut.json()).overlay).toMatchObject({
        disabledAppIds: ["nexus-chat"],
        shelfOverrides: { "nexus-calendar": "work" },
      });
      const nodeGet = await handleRequest(keyed("/api/v1/nodes/node-a/catalog", "GET"));
      expect((await nodeGet.json()).overlay.localApps).toEqual([
        expect.objectContaining({ toolId: "node-only", name: "Node Only" }),
      ]);
      const platformClaim = await handleRequest(
        keyed("/api/v1/nodes/node-a/catalog", "PUT", {
          localApps: [{ toolId: "platform", name: "Forbidden" }],
        }),
      );
      expect(platformClaim.status).toBe(400);
    } finally {
      if (previousKey === undefined) process.env.NEXUS_CLOUD_API_KEY = undefined;
      else process.env.NEXUS_CLOUD_API_KEY = previousKey;
      if (previousTenantPath === undefined) process.env.NEXUS_CLOUD_TENANT_CATALOG_PATH = undefined;
      else process.env.NEXUS_CLOUD_TENANT_CATALOG_PATH = previousTenantPath;
      if (previousNodePath === undefined) process.env.NEXUS_CLOUD_NODE_CATALOG_PATH = undefined;
      else process.env.NEXUS_CLOUD_NODE_CATALOG_PATH = previousNodePath;
      rmSync(dir, { recursive: true, force: true });
    }
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

  test("rejects changed equal and lower version proposals without changing approval", async () => {
    const toolId = "catalog-versioned";
    const accepted = { ...proposal, version: 3 };
    service.registerSystemsApiTool({ id: toolId, name: "Versioned", description: "Original", catalogProposal: accepted });
    const approved = {
      primaryShelf: "work" as const, secondaryShelves: [], audiences: ["business" as const],
      capabilities: ["messaging"], maturity: "stable" as const, visibility: "default" as const,
      approvedAt: "2026-10-17T00:00:00.000Z", approvedBy: "platform:catalog", version: 3,
    };
    service.saveApprovedCatalog(toolId, approved);
    const changed = { ...accepted, keywords: ["changed"] };
    const equal = await handleRequest(request(`/api/v1/tools/${toolId}/catalog-proposal`, "POST", changed));
    expect(equal.status).toBe(400);
    expect((await equal.json()).error).toBe("Stale catalog proposal version");
    const lower = await handleRequest(request(`/api/v1/tools/${toolId}`, "PATCH", { description: "Changed", catalogProposal: { ...changed, version: 2 } }));
    expect(lower.status).toBe(400);
    expect((await lower.json()).error).toBe("Stale catalog proposal version");
    const reregister = await handleRequest(request("/api/v1/tools", "POST", { id: toolId, name: "Changed", description: "Changed", catalogProposal: changed }));
    expect(reregister.status).toBe(400);
    expect(service.getCatalogRecord(toolId)).toMatchObject({ proposal: accepted, approved, reviewStatus: "approved" });
    expect(service.getSystemsApiTool(toolId)).toMatchObject({ name: "Versioned", description: "Original" });
    const repeated = await handleRequest(request("/api/v1/tools", "POST", { id: toolId, name: "Versioned", description: "Original", catalogProposal: accepted }));
    expect(repeated.status).toBe(201);
  });
});


describe("catalog approval routes", () => {
  let harness: Awaited<ReturnType<typeof createSystemsApiTestHarness>>;
  let fetchSpy: ReturnType<typeof spyOn> | undefined;
  const permission = "platform:catalog:approve";
  beforeAll(async () => { harness = await createSystemsApiTestHarness(); });
  afterEach(() => { fetchSpy?.mockRestore(); fetchSpy = undefined; process.env.NEXUS_CLOUD_API_KEY = ""; setJsonStoreAfterReplaceHookForTests(null); });
  afterAll(() => harness.cleanup());

  function identity(role: string, permissions: string[] = []) {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({
      authorized: true, userId: `auth-${role}`, user: { id: `auth-${role}`, role }, permissions,
    })) as unknown as typeof fetch);
  }
  function seed(id: string) {
    harness.systemsApiService.registerSystemsApiTool({ id, name: id, description: "Catalog", catalogProposal: { ...proposal, suggestedShelves: ["everyday", "work"] } });
  }
  function decide(id: string, action: string, token?: string, body: unknown = {}, key: string | undefined = action === "rollback" ? crypto.randomUUID() : undefined) {
    return harness.handleRequest(new Request(`http://localhost/api/v1/catalog/${id}/${action}`, {
      method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(key ? { "idempotency-key": key } : {}),
        "x-role": "founder", "x-permissions": permission, "x-actor": "forged" }, body: JSON.stringify(body),
    }));
  }
  test.each(["approve", "defer", "reject", "rollback"])("%s always requires an identity, even in local dev", async (action) => {
    expect((await decide("missing", action)).status).toBe(401);
  });
  test.each(["operator", "user", "viewer", "node", "tenant"])("%s cannot approve using forged permission headers", async (role) => {
    seed(`forbidden-${role}`); identity(role);
    expect((await decide(`forbidden-${role}`, "approve", role)).status).toBe(403);
    expect(harness.systemsApiService.getCatalogRecord(`forbidden-${role}`)?.approved).toBeNull();
  });
  test("a Cloud node API key cannot approve", async () => {
    process.env.NEXUS_CLOUD_API_KEY = "node-key";
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ authorized: true, userId: "founder", user: { id: "founder" }, permissions: [permission] })) as unknown as typeof fetch);
    expect((await decide("missing", "approve", "node-key")).status).toBe(403);
    const response = await harness.handleRequest(new Request("http://localhost/api/v1/catalog/missing/approve", { method: "POST", headers: { "x-api-key": "node-key" } }));
    expect(response.status).toBe(403);
  });
  test("invalid credentials and unavailable Auth fail closed", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ authorized: false }, { status: 401 })) as unknown as typeof fetch);
    expect((await decide("missing", "approve", "invalid")).status).toBe(401);
    fetchSpy.mockImplementation(async () => { throw new Error("offline"); });
    expect((await decide("missing", "approve", "session")).status).toBe(503);
  });
  test("founder approval maps proposal fields and persists an authenticated audit event", async () => {
    seed("decision-approved"); identity("founder", [permission]);
    process.env.NEXUS_CLOUD_API_KEY = "node-only-key";
    const before = harness.systemsApiService.getCatalogRecord("decision-approved");
    const runtimeBefore = harness.systemsApiService.getSystemsApiTool("decision-approved");
    const response = await decide("decision-approved", "approve", "founder-session", { maturity: "stable", visibility: "default" });
    expect(response.status).toBe(200);
    const { catalog } = await response.json();
    expect(catalog.reviewStatus).toBe("approved");
    expect(catalog.approved).toMatchObject({ primaryShelf: "everyday", secondaryShelves: ["work"], audiences: ["general"], capabilities: ["messaging"], maturity: "stable", visibility: "default", version: 2, approvedBy: "auth-founder" });
    expect(Number.isNaN(Date.parse(catalog.approved.approvedAt))).toBe(false);
    const { queryAuditLog } = await import("../audit");
    const events = queryAuditLog({ subjectId: "decision-approved", eventType: "catalog-approval" });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ action: "approve", actor: "auth-founder", previousValue: JSON.stringify(before), newValue: JSON.stringify(harness.systemsApiService.getCatalogRecord("decision-approved")) });
    expect(Number.isNaN(Date.parse(events[0]?.timestamp ?? ""))).toBe(false);
    // Publishing placement does not enable the tool or grant runtime access.
    expect(harness.systemsApiService.getSystemsApiTool("decision-approved")).toEqual(runtimeBefore);
  });
  test.each(["defer", "reject"])("%s preserves approval and persists review status", async (action) => {
    const id = `decision-${action}`; seed(id); identity("admin", [permission]);
    expect((await decide(id, "approve", "admin-key")).status).toBe(200);
    const approved = harness.systemsApiService.getCatalogRecord(id)?.approved ?? undefined;
    const response = await decide(id, action, "admin-key");
    expect(response.status).toBe(200);
    expect((await response.json()).catalog).toMatchObject({ approved, reviewStatus: action === "defer" ? "deferred" : "rejected" });
    const { loadSystemsApiRegistry } = await import("../systems-api/store");
    const { resetSystemsApiRegistryForTests } = await import("../systems-api/registry");
    resetSystemsApiRegistryForTests(loadSystemsApiRegistry());
    expect(harness.systemsApiService.getCatalogRecord(id)?.reviewStatus).toBe(action === "defer" ? "deferred" : "rejected");
    const { queryAuditLog } = await import("../audit");
    expect(queryAuditLog({ subjectId: id, action, eventType: "catalog-approval" })[0]?.metadata?.actor).toBe("auth-admin");
  });
  test("rollback restores the previous approval after registry reload and records both values", async () => {
    const id = "decision-rollback"; seed(id); identity("founder", [permission]);
    await decide(id, "approve", "founder");
    const approved = harness.systemsApiService.getCatalogRecord(id)?.approved ?? undefined;
    harness.systemsApiService.saveCatalogProposal(id, { ...proposal, suggestedShelves: ["create"], version: 3 });
    await decide(id, "approve", "founder");
    const previous = harness.systemsApiService.getCatalogRecord(id);
    const { loadSystemsApiRegistry } = await import("../systems-api/store");
    const { resetSystemsApiRegistryForTests } = await import("../systems-api/registry");
    resetSystemsApiRegistryForTests(loadSystemsApiRegistry());
    const response = await decide(id, "rollback", "founder");
    expect(response.status).toBe(200);
    expect((await response.json()).catalog).toMatchObject({ approved, reviewStatus: "pending" });
    const { queryAuditLog } = await import("../audit");
    expect(queryAuditLog({ subjectId: id, action: "rollback" })[0]?.metadata).toMatchObject({ actor: "auth-founder", previousValue: JSON.stringify(previous), newValue: JSON.stringify(harness.systemsApiService.getCatalogRecord(id)) });
    expect((await decide(id, "rollback", "founder")).status).toBe(200);
    expect(harness.systemsApiService.getCatalogRecord(id)?.approved).toBeNull();
    expect((await decide(id, "rollback", "founder")).status).toBe(409);
  });
  test("catalog ids matching prototype names can be approved and rolled back", async () => {
    seed("constructor"); identity("admin", [permission]);
    expect((await decide("constructor", "approve", "admin")).status).toBe(200);
    expect((await decide("constructor", "rollback", "admin")).status).toBe(200);
  });
  test("rollback to an approval for the current proposal restores approved review status", async () => {
    seed("decision-same-version"); identity("admin", [permission]);
    expect((await decide("decision-same-version", "approve", "admin")).status).toBe(200);
    const original = harness.systemsApiService.getCatalogRecord("decision-same-version")?.approved;
    expect((await decide("decision-same-version", "approve", "admin", { maturity: "stable" })).status).toBe(200);
    const response = await decide("decision-same-version", "rollback", "admin");
    expect(response.status).toBe(200);
    expect((await response.json()).catalog).toMatchObject({ approved: original, reviewStatus: "approved" });
  });
  test("a failed audit append still leaves a durable, queryable decision event", async () => {
    seed("decision-audit-failure"); identity("admin", [permission]);
    const previousPath = process.env.NEXUS_CLOUD_AUDIT_PATH;
    process.env.NEXUS_CLOUD_AUDIT_PATH = join(process.cwd(), "data"); // a directory, so append fails
    try {
      expect((await decide("decision-audit-failure", "approve", "admin")).status).toBe(200);
      const { loadSystemsApiRegistry } = await import("../systems-api/store");
      const { resetSystemsApiRegistryForTests } = await import("../systems-api/registry");
      const { queryAuditLog } = await import("../audit");
      expect(loadSystemsApiRegistry().catalog.auditEvents?.filter((event) => event.subjectId === "decision-audit-failure")).toHaveLength(1);
      resetSystemsApiRegistryForTests(loadSystemsApiRegistry());
      expect(queryAuditLog({ subjectId: "decision-audit-failure", eventType: "catalog-approval" })).toHaveLength(1);
    } finally {
      if (previousPath === undefined) delete process.env.NEXUS_CLOUD_AUDIT_PATH;
      else process.env.NEXUS_CLOUD_AUDIT_PATH = previousPath;
    }
  });
  test("audit reads retain a valid primary when its older backup has a newer mtime", async () => {
    const id = "decision-primary-precedence"; seed(id); identity("admin", [permission]);
    expect((await decide(id, "approve", "admin")).status).toBe(200);
    const { getSystemsApiRegistryPath, loadSystemsApiRegistry } = await import("../systems-api/store");
    const { queryAuditLog } = await import("../audit");
    const path = getSystemsApiRegistryPath();
    const approved = harness.systemsApiService.getCatalogRecord(id)?.approved ?? undefined;
    const future = new Date(Date.now() + 60_000);
    utimesSync(`${path}.bak`, future, future);
    expect(queryAuditLog({ subjectId: id, eventType: "catalog-approval" })).toHaveLength(1);
    expect(loadSystemsApiRegistry().catalog.approved[id]).toEqual(approved);
    expect(JSON.parse(readFileSync(path, "utf8")).catalog.approved[id]).toEqual(approved);
  });
  test("post-replacement sync faults reconcile approval and rollback before responding", async () => {
    const id = "decision-post-replace"; seed(id); identity("admin", [permission]);
    const { getSystemsApiRegistryPath, loadSystemsApiRegistry } = await import("../systems-api/store");
    const { queryAuditLog } = await import("../audit");
    const registryPath = getSystemsApiRegistryPath();
    const failAfterReplaceOnce = () => setJsonStoreAfterReplaceHookForTests((path) => {
      if (path !== registryPath) return;
      setJsonStoreAfterReplaceHookForTests(null);
      throw new Error("simulated directory sync fault after rename");
    });
    failAfterReplaceOnce();
    expect((await decide(id, "approve", "admin")).status).toBe(200);
    const approved = harness.systemsApiService.getCatalogRecord(id)?.approved ?? undefined;
    expect(loadSystemsApiRegistry().catalog.approved[id]).toEqual(approved);
    expect(queryAuditLog({ subjectId: id, action: "approve" })).toHaveLength(1);
    failAfterReplaceOnce();
    expect((await decide(id, "rollback", "admin")).status).toBe(200);
    expect(harness.systemsApiService.getCatalogRecord(id)?.approved).toBeNull();
    expect(loadSystemsApiRegistry().catalog.approved[id]).toBeUndefined();
    expect(queryAuditLog({ subjectId: id, action: "rollback" })).toHaveLength(1);
    expect((await decide(id, "rollback", "admin")).status).toBe(409);
  });
  test("rollback requires an idempotency key and rejects key reuse for another tool", async () => {
    seed("decision-key-a"); seed("decision-key-b"); identity("admin", [permission]);
    expect((await decide("decision-key-a", "approve", "admin")).status).toBe(200);
    expect((await decide("decision-key-b", "approve", "admin")).status).toBe(200);
    expect((await decide("decision-key-a", "rollback", "admin", {}, "")).status).toBe(428);
    const key = "shared-rollback-key";
    expect((await decide("decision-key-a", "rollback", "admin", {}, key)).status).toBe(200);
    expect((await decide("decision-key-b", "rollback", "admin", {}, key)).status).toBe(409);
    expect(harness.systemsApiService.getCatalogRecord("decision-key-b")?.approved).not.toBeNull();
  });
  test("persistent post-replacement sync failure makes rollback retries idempotent", async () => {
    const id = "decision-persistent-sync"; seed(id); identity("admin", [permission]);
    const { getSystemsApiRegistryPath, loadSystemsApiRegistry } = await import("../systems-api/store");
    const { resetSystemsApiRegistryForTests } = await import("../systems-api/registry");
    const path = getSystemsApiRegistryPath();
    expect((await decide(id, "approve", "admin")).status).toBe(200);
    const version2 = harness.systemsApiService.getCatalogRecord(id)?.approved;
    harness.systemsApiService.saveCatalogProposal(id, { ...proposal, suggestedShelves: ["create"], version: 3 });
    expect((await decide(id, "approve", "admin")).status).toBe(200);
    const version3 = harness.systemsApiService.getCatalogRecord(id)?.approved;
    harness.systemsApiService.saveCatalogProposal(id, { ...proposal, suggestedShelves: ["develop"], version: 4 });
    expect((await decide(id, "approve", "admin")).status).toBe(200);
    const key = "persistent-rollback-retry";
    setJsonStoreAfterReplaceHookForTests((candidate) => {
      if (candidate === path) throw new Error("persistent directory sync failure");
    });
    const first = await decide(id, "rollback", "admin", {}, key);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ durability: "unconfirmed", retryWithSameKey: key });
    expect(harness.systemsApiService.getCatalogRecord(id)?.approved).toEqual(version3);
    const catalogAfterFirst = loadSystemsApiRegistry().catalog;
    const historyAfterFirst = catalogAfterFirst.approvalHistory?.[id];
    const auditAfterFirst = (catalogAfterFirst.auditEvents ?? []).filter((event) => event.metadata?.idempotencyKey === key);
    expect(auditAfterFirst).toHaveLength(1);
    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = await decide(id, "rollback", "admin", {}, key);
      expect(retry.status).toBe(202);
      expect(await retry.json()).toMatchObject({ durability: "unconfirmed", retryWithSameKey: key, replayed: true });
      expect(harness.systemsApiService.getCatalogRecord(id)?.approved).toEqual(version3);
      expect(loadSystemsApiRegistry().catalog).toEqual(catalogAfterFirst);
    }
    setJsonStoreAfterReplaceHookForTests(null);
    // Recovery must be confirmed by replay itself, before any reload helper persists.
    const replay = await decide(id, "rollback", "admin", {}, key);
    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(harness.systemsApiService.getCatalogRecord(id)?.approved).toEqual(version3);
    expect(loadSystemsApiRegistry().catalog.approvalHistory?.[id]).toEqual(historyAfterFirst);
    const { queryAuditLog } = await import("../audit");
    expect(queryAuditLog({ subjectId: id }).filter((event) => event.metadata?.idempotencyKey === key)).toEqual(auditAfterFirst);
    resetSystemsApiRegistryForTests(loadSystemsApiRegistry()); // simulated restart after recovery
    expect((await decide(id, "rollback", "admin", {}, key)).status).toBe(200);
    expect(loadSystemsApiRegistry().catalog).toEqual(catalogAfterFirst);
    expect((await decide(id, "rollback", "admin", {}, "intentional-next-rollback")).status).toBe(200);
    expect(harness.systemsApiService.getCatalogRecord(id)?.approved).toEqual(version2);
  });
  test("failed approval and rollback writes leave state, history and audit unchanged for retry", async () => {
    const id = "decision-store-failure"; seed(id); identity("admin", [permission]);
    const { loadSystemsApiRegistry } = await import("../systems-api/store");
    const { queryAuditLog } = await import("../audit");
    const previousPath = process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH;
    const before = harness.systemsApiService.getCatalogRecord(id);
    const diskBefore = loadSystemsApiRegistry().catalog;
    try {
      process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH = join(process.cwd(), "data"); // a directory
      expect((await decide(id, "approve", "admin")).status).toBe(503);
    } finally {
      if (previousPath === undefined) delete process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH;
      else process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH = previousPath;
    }
    expect(harness.systemsApiService.getCatalogRecord(id)).toEqual(before);
    expect(loadSystemsApiRegistry().catalog).toEqual(diskBefore);
    expect(queryAuditLog({ subjectId: id })).toHaveLength(0);
    expect((await decide(id, "approve", "admin")).status).toBe(200);
    const first = harness.systemsApiService.getCatalogRecord(id)?.approved;
    harness.systemsApiService.saveCatalogProposal(id, { ...proposal, suggestedShelves: ["create"], version: 3 });
    expect((await decide(id, "approve", "admin")).status).toBe(200);
    const beforeRollback = harness.systemsApiService.getCatalogRecord(id);
    const diskBeforeRollback = loadSystemsApiRegistry().catalog;
    const auditsBeforeRollback = queryAuditLog({ subjectId: id }).length;
    try {
      process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH = join(process.cwd(), "data");
      expect((await decide(id, "rollback", "admin")).status).toBe(503);
    } finally {
      if (previousPath === undefined) delete process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH;
      else process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH = previousPath;
    }
    expect(harness.systemsApiService.getCatalogRecord(id)).toEqual(beforeRollback);
    expect(loadSystemsApiRegistry().catalog).toEqual(diskBeforeRollback);
    expect(queryAuditLog({ subjectId: id })).toHaveLength(auditsBeforeRollback);
    expect((await decide(id, "rollback", "admin")).status).toBe(200);
    expect(harness.systemsApiService.getCatalogRecord(id)?.approved).toEqual(first);
  });
  test("missing tools, absent proposals and invalid approval overrides fail without mutation", async () => {
    identity("admin", [permission]);
    expect((await decide("missing", "approve", "admin")).status).toBe(404);
    harness.systemsApiService.registerSystemsApiTool({ id: "no-proposal", name: "Legacy", description: "Legacy" });
    expect((await decide("no-proposal", "approve", "admin")).status).toBe(409);
    seed("invalid-approval");
    for (const body of [{ primaryShelf: "unknown" }, { maturity: "unknown" }, { approvedBy: "forged" }, null]) {
      expect((await decide("invalid-approval", "approve", "admin", body)).status).toBe(400);
    }
    expect(harness.systemsApiService.getCatalogRecord("invalid-approval")?.approved).toBeNull();
  });
});

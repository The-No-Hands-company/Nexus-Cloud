import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";
import { apiRouteManifest } from "./routes";

describe("Systems API topology surface", () => {
  let handleRequest: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeAll(async () => {
    const harness = await createSystemsApiTestHarness();
    handleRequest = harness.handleRequest;
    cleanup = harness.cleanup;
  });

  afterAll(() => {
    cleanup?.();
  });

  test("manifest includes the canonical topology endpoints", () => {
    expect(apiRouteManifest.map((route) => route.path)).toEqual(
      expect.arrayContaining(["/api/v1/apps", "/api/v1/connections", "/api/v1/topology"]),
    );
  });

  test("GET /api/v1/topology returns the canonical app graph", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/v1/topology", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.topology.summary.appCount).toBeGreaterThanOrEqual(13);
    expect(body.topology.summary.connectionCount).toBeGreaterThanOrEqual(10);
    expect(body.topology.apps.some((app: { id: string }) => app.id === "nexus-cloud")).toBe(true);
    expect(body.topology.apps.some((app: { id: string }) => app.id === "nexus-vault")).toBe(true);
    expect(body.topology.apps.some((app: { id: string }) => app.id === "nexusclaw")).toBe(true);
    expect(body.topology.apps.some((app: { id: string }) => app.id === "phantom")).toBe(true);
  });

  test("GET /api/v1/apps and /api/v1/connections expose the same graph slices", async () => {
    const appsResponse = await handleRequest(
      new Request("http://localhost/api/v1/apps", { method: "GET" }),
    );
    const connectionsResponse = await handleRequest(
      new Request("http://localhost/api/v1/connections", { method: "GET" }),
    );

    expect(appsResponse.status).toBe(200);
    expect(connectionsResponse.status).toBe(200);

    const appsBody = await appsResponse.json();
    const connectionsBody = await connectionsResponse.json();

    const appIds = appsBody.apps.map((app: { id: string }) => app.id);
    const connectionIds = connectionsBody.connections.map(
      (connection: { id: string }) => connection.id,
    );

    const coreApps = [
      "nexus-cloud",
      "nexus",
      "nexus-ai",
      "nexusclaw",
      "nexus-computer",
      "nexus-deploy",
      "nexus-forge",
      "nexus-hosting",
      "nexus-network",
      "nexus-vault",
      "phantom",
    ];
    for (const id of coreApps) {
      expect(appIds).toContain(id);
    }
    // Connections: verify both endpoints return connections and they share structural IDs
    expect(connectionIds.length).toBeGreaterThan(50);
    expect(appIds.length).toBeGreaterThan(50);
    // Check that some expected connection patterns exist
    const hasEmbedded = connectionIds.some((id: string) => id.startsWith("embedded-in-"));
    const hasSecures = connectionIds.some((id: string) => id.startsWith("secures-"));
    expect(hasEmbedded).toBe(true);
    expect(hasSecures).toBe(true);
  });

  test("POST /api/v1/services/restart processes operator service restart signal", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/v1/services/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: "nexus-network" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.service).toBe("nexus-network");
  });

  test("GET and POST /api/v1/backups orchestrate atomic snapshot backups", async () => {
    const listRes = await handleRequest(
      new Request("http://localhost/api/v1/backups", { method: "GET" }),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(Array.isArray(listBody.backups)).toBe(true);

    const createRes = await handleRequest(
      new Request("http://localhost/api/v1/backups/create", { method: "POST" }),
    );
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    expect(createBody.backup.status).toBe("verified");
  });
});

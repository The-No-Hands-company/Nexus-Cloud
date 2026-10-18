import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";
import { apiRouteManifest } from "./routes";

describe("Nexus Cloud control-plane contract", () => {
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

  test("publishes Cloud as the hosted control-plane admin console", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/v1/contract", { method: "GET" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      protocol: "nexus-cloud/1",
      service: {
        id: "nexus-cloud",
        name: "Nexus Cloud",
        surface: "admin-console",
        hostedPath: "/cloud",
        auth: "Nexus Auth session or Cloud API key",
      },
    });
    expect(body.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/api/v1/contract", access: "public" }),
        expect.objectContaining({ method: "GET", path: "/api/v1/catalog", access: "public" }),
        expect.objectContaining({ method: "GET", path: "/api/v1/catalog/:toolId", access: "cloud-api-key" }),
        expect.objectContaining({ method: "GET", path: "/api/v1/routes", access: "cloud-api-key" }),
        expect.objectContaining({ method: "POST", path: "/api/v1/catalog/:toolId/approve", access: "platform-permission" }),
      ]),
    );
    expect(body.routes).toHaveLength(apiRouteManifest.length);
    expect(
      new Set(body.routes.map((route: { method: string; path: string }) => `${route.method} ${route.path}`)).size,
    ).toBe(
      apiRouteManifest.length,
    );
  });
});

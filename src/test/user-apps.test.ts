import { describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness, emptySystemsApiRegistry } from "./systems-api-harness";

/**
 * A member's deployed app gets the proxy's user-site isolation through one flag
 * on its route. These tests pin how that flag is set and, as importantly, how it
 * cannot be: it must not come from a payload, and it must survive a re-register.
 */
describe("user-deployed apps", () => {
  async function harness() {
    return createSystemsApiTestHarness(emptySystemsApiRegistry);
  }
  const routeFor = (h: Awaited<ReturnType<typeof harness>>, host: string) =>
    h.systemsApiService.listSystemsApiRoutes().find((r) => r.domain === host);

  test("publishing makes a flagged route to the given port", async () => {
    const h = await harness();
    try {
      const result = h.systemsApiService.publishUserApp({
        slug: "my-app",
        upstreamUrl: "http://127.0.0.1:20001",
        host: "my-app.nexus.local",
      });
      expect(result.ok).toBe(true);
      const route = routeFor(h, "my-app.nexus.local");
      expect(route?.upstream).toBe("http://127.0.0.1:20001");
      expect(route?.userDeployed).toBe(true);
      expect(route?.requiresAuth).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  test("publishing again moves the route to the new port (the blue/green switch)", async () => {
    const h = await harness();
    try {
      const publish = (port: number) =>
        h.systemsApiService.publishUserApp({
          slug: "my-app",
          upstreamUrl: `http://127.0.0.1:${port}`,
          host: "my-app.nexus.local",
        });
      publish(20001);
      publish(20002);
      const routes = h.systemsApiService
        .listSystemsApiRoutes()
        .filter((r) => r.domain === "my-app.nexus.local");
      expect(routes).toHaveLength(1);
      expect(routes[0]?.upstream).toBe("http://127.0.0.1:20002");
    } finally {
      h.cleanup();
    }
  });

  test("an ordinary route is not flagged", async () => {
    const h = await harness();
    try {
      h.systemsApiService.registerSystemsApiTool({
        id: "plain",
        name: "Plain",
        description: "An ecosystem tool",
        upstreamUrl: "http://127.0.0.1:4200",
        exposed: false,
        health: "healthy",
        capabilities: [],
      });
      h.systemsApiService.requestSystemsApiExposure({
        toolId: "plain",
        desiredHost: "plain.nexus.local",
      });
      expect(routeFor(h, "plain.nexus.local")?.userDeployed).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  test("the generic registration cannot create or take over a deployed app", async () => {
    const h = await harness();
    try {
      expect(() =>
        h.systemsApiService.registerSystemsApiTool({
          id: "deploy-sneaky",
          name: "Sneaky",
          description: "Claims the deployed-app namespace",
          upstreamUrl: "http://127.0.0.1:1",
          exposed: false,
          health: "healthy",
          capabilities: [],
        }),
      ).toThrow(/reserved/);

      h.systemsApiService.publishUserApp({
        slug: "mine",
        upstreamUrl: "http://127.0.0.1:20003",
        host: "mine.nexus.local",
      });
      expect(() =>
        h.systemsApiService.registerSystemsApiTool({
          id: "deploy-mine",
          name: "Overwrite",
          description: "Tries to re-register a deployed app",
          upstreamUrl: "http://127.0.0.1:2",
          exposed: false,
          health: "healthy",
          capabilities: [],
        }),
      ).toThrow(/reserved/);
      expect(routeFor(h, "mine.nexus.local")?.upstream).toBe("http://127.0.0.1:20003");
    } finally {
      h.cleanup();
    }
  });

  test("a payload field cannot set the flag on an ordinary tool", async () => {
    const h = await harness();
    try {
      h.systemsApiService.registerSystemsApiTool({
        id: "plain2",
        name: "Plain 2",
        description: "Sends a userDeployed field",
        upstreamUrl: "http://127.0.0.1:4201",
        exposed: false,
        health: "healthy",
        capabilities: [],
        userDeployed: true,
      } as never);
      expect(h.systemsApiService.getSystemsApiTool("plain2")?.userDeployed).toBeUndefined();
    } finally {
      h.cleanup();
    }
  });

  test("a host held by another tool is a conflict, and nothing is changed", async () => {
    const h = await harness();
    try {
      h.systemsApiService.registerSystemsApiTool({
        id: "draw",
        name: "Draw",
        description: "Ecosystem app",
        upstreamUrl: "http://127.0.0.1:8091",
        exposed: false,
        health: "healthy",
        capabilities: [],
      });
      h.systemsApiService.requestSystemsApiExposure({ toolId: "draw", desiredHost: "draw.nexus.local" });

      const result = h.systemsApiService.publishUserApp({
        slug: "draw",
        upstreamUrl: "http://127.0.0.1:20004",
        host: "draw.nexus.local",
      });
      expect(result).toEqual({ ok: false, reason: "conflict" });
      expect(routeFor(h, "draw.nexus.local")?.upstream).toBe("http://127.0.0.1:8091");
      expect(h.systemsApiService.getSystemsApiTool("deploy-draw")).toBeNull();
      expect(h.systemsApiService.isHostInUse("draw.nexus.local")).toBe(true);
      expect(h.systemsApiService.isHostInUse("free.nexus.local")).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  test("unpublishing removes the route and refuses anything that is not a deployed app", async () => {
    const h = await harness();
    try {
      h.systemsApiService.registerSystemsApiTool({
        id: "plain3",
        name: "Plain 3",
        description: "Ecosystem tool",
        upstreamUrl: "http://127.0.0.1:4202",
        exposed: false,
        health: "healthy",
        capabilities: [],
      });
      h.systemsApiService.publishUserApp({
        slug: "gone",
        upstreamUrl: "http://127.0.0.1:20005",
        host: "gone.nexus.local",
      });
      expect(h.systemsApiService.unpublishUserApp("gone")).not.toBeNull();
      expect(routeFor(h, "gone.nexus.local")).toBeUndefined();
      expect(h.systemsApiService.isHostInUse("gone.nexus.local")).toBe(false);
      expect(h.systemsApiService.unpublishUserApp("gone")).toBeNull();
      expect(h.systemsApiService.unpublishUserApp("plain3")).toBeNull();
    } finally {
      h.cleanup();
    }
  });
});

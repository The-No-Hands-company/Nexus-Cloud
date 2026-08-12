import { describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness, emptySystemsApiRegistry } from "./systems-api-harness";

/**
 * The login gate lives in the proxy, and the proxy learns which hosts to gate
 * from `requiresAuth` on the routes Cloud serves. Until this existed the flag
 * had no source at all — the proxy read a field nothing ever set, so the gate
 * could not be switched on for any host.
 */
describe("route requiresAuth", () => {
  async function harnessWithExposedTool() {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    const { systemsApiService } = harness;
    systemsApiService.registerSystemsApiTool({
      id: "tool-gated",
      name: "Gated",
      description: "A tool behind the login gate",
      upstreamUrl: "http://127.0.0.1:4200",
      exposed: false,
      health: "healthy",
      capabilities: [],
    });
    systemsApiService.requestSystemsApiExposure({
      toolId: "tool-gated",
      desiredHost: "gated.example.com",
    });
    return harness;
  }

  function routeFor(harness: Awaited<ReturnType<typeof harnessWithExposedTool>>) {
    return harness.systemsApiService
      .listSystemsApiRoutes()
      .find((r) => r.domain === "gated.example.com");
  }

  test("defaults to false, so an undecided route stays reachable", async () => {
    const harness = await harnessWithExposedTool();
    try {
      expect(routeFor(harness)?.requiresAuth).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  test("an operator patch turns the gate on, and it reaches the route", async () => {
    const harness = await harnessWithExposedTool();
    try {
      harness.systemsApiService.updateSystemsApiTool("tool-gated", { requiresAuth: true });
      expect(routeFor(harness)?.requiresAuth).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  test("re-registering the tool does not turn the gate off", async () => {
    // The one that matters. A tool re-registers on every restart and every
    // heartbeat, and its payload does not mention requiresAuth. If registration
    // reset the flag, gating an app would last until it next restarted — and
    // it would fail open, silently, at the exact moment of a deploy.
    const harness = await harnessWithExposedTool();
    try {
      const { systemsApiService } = harness;
      systemsApiService.updateSystemsApiTool("tool-gated", { requiresAuth: true });

      systemsApiService.registerSystemsApiTool({
        id: "tool-gated",
        name: "Gated",
        description: "A tool behind the login gate",
        upstreamUrl: "http://127.0.0.1:4200",
        exposed: false,
        health: "healthy",
        capabilities: [],
      });

      expect(systemsApiService.getSystemsApiTool("tool-gated")?.requiresAuth).toBe(true);
      expect(routeFor(harness)?.requiresAuth).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  test("an unrelated patch does not disturb the gate", async () => {
    const harness = await harnessWithExposedTool();
    try {
      const { systemsApiService } = harness;
      systemsApiService.updateSystemsApiTool("tool-gated", { requiresAuth: true });
      systemsApiService.updateSystemsApiTool("tool-gated", { description: "edited" });

      expect(routeFor(harness)?.requiresAuth).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  test("the gate can be turned back off deliberately", async () => {
    const harness = await harnessWithExposedTool();
    try {
      const { systemsApiService } = harness;
      systemsApiService.updateSystemsApiTool("tool-gated", { requiresAuth: true });
      systemsApiService.updateSystemsApiTool("tool-gated", { requiresAuth: false });

      expect(routeFor(harness)?.requiresAuth).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});

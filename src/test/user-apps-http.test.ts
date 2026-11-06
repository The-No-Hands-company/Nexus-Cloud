import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness, emptySystemsApiRegistry } from "./systems-api-harness";

const KEY = "user-apps-test-key";
const NODE_KEY = "node-key";

describe("/api/v1/user-apps", () => {
  let h: Awaited<ReturnType<typeof createSystemsApiTestHarness>>;
  beforeEach(async () => {
    h = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    process.env.NEXUS_CLOUD_USER_APPS_KEY = KEY;
    process.env.NEXUS_CLOUD_API_KEY = NODE_KEY;
    delete process.env.NEXUS_CLOUD_USER_APPS_PORTS;
  });
  afterEach(() => {
    delete process.env.NEXUS_CLOUD_USER_APPS_KEY;
    process.env.NEXUS_CLOUD_API_KEY = "";
    h.cleanup();
  });

  const call = (method: string, path: string, opts: { key?: string; body?: unknown } = {}) =>
    h.handleRequest(
      new Request(`http://127.0.0.1:8787${path}`, {
        method,
        headers: {
          ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      }),
    );

  test("without the user-apps key every method is refused, including the node key", async () => {
    for (const key of [undefined, "wrong", NODE_KEY]) {
      const res = await call("PUT", "/api/v1/user-apps/my-app", {
        ...(key ? { key } : {}),
        body: { upstreamUrl: "http://127.0.0.1:20001" },
      });
      expect(res.status).toBe(401);
    }
    expect((await call("DELETE", "/api/v1/user-apps/my-app", { key: NODE_KEY })).status).toBe(401);
    expect((await call("GET", "/api/v1/user-apps/my-app/availability")).status).toBe(401);
  });

  test("with no key configured the feature is off, not open", async () => {
    delete process.env.NEXUS_CLOUD_USER_APPS_KEY;
    const res = await call("PUT", "/api/v1/user-apps/my-app", {
      key: "anything",
      body: { upstreamUrl: "http://127.0.0.1:20001" },
    });
    expect(res.status).toBe(503);
  });

  test("publish, move and remove an app", async () => {
    const put = (port: number) =>
      call("PUT", "/api/v1/user-apps/my-app", {
        key: KEY,
        body: { upstreamUrl: `http://127.0.0.1:${port}` },
      });
    expect((await put(20001)).status).toBe(200);
    expect((await put(20002)).status).toBe(200);
    const routes = h.systemsApiService
      .listSystemsApiRoutes()
      .filter((r) => r.domain === "my-app.nexus.local");
    expect(routes).toHaveLength(1);
    expect(routes[0]?.upstream).toBe("http://127.0.0.1:20002");
    expect(routes[0]?.userDeployed).toBe(true);

    expect((await call("DELETE", "/api/v1/user-apps/my-app", { key: KEY })).status).toBe(204);
    expect(
      h.systemsApiService.listSystemsApiRoutes().some((r) => r.domain === "my-app.nexus.local"),
    ).toBe(false);
    expect((await call("DELETE", "/api/v1/user-apps/my-app", { key: KEY })).status).toBe(404);
  });

  test("an upstream outside loopback or the port range is refused", async () => {
    for (const upstreamUrl of [
      "http://127.0.0.1:4310",
      "http://127.0.0.1:19999",
      "http://127.0.0.1:30000",
      "http://10.0.0.5:20001",
      "https://127.0.0.1:20001",
      "http://127.0.0.1:20001/path",
      "http://localhost:20001",
      42,
    ]) {
      const res = await call("PUT", "/api/v1/user-apps/my-app", { key: KEY, body: { upstreamUrl } });
      expect(res.status, JSON.stringify(upstreamUrl)).toBe(400);
    }
  });

  test("the port range is configurable", async () => {
    process.env.NEXUS_CLOUD_USER_APPS_PORTS = "40000-40010";
    const ok = await call("PUT", "/api/v1/user-apps/my-app", {
      key: KEY,
      body: { upstreamUrl: "http://127.0.0.1:40005" },
    });
    expect(ok.status).toBe(200);
    const bad = await call("PUT", "/api/v1/user-apps/other", {
      key: KEY,
      body: { upstreamUrl: "http://127.0.0.1:20001" },
    });
    expect(bad.status).toBe(400);
  });

  test("a malformed name is refused", async () => {
    for (const slug of ["A", "ab", "-x-", "a--b", "x".repeat(41), "bad_name"]) {
      const res = await call("PUT", `/api/v1/user-apps/${slug}`, {
        key: KEY,
        body: { upstreamUrl: "http://127.0.0.1:20001" },
      });
      expect(res.status, slug).toBe(400);
    }
  });

  test("a name held by an ecosystem tool is a 409 and the tool's route is untouched", async () => {
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

    const res = await call("PUT", "/api/v1/user-apps/draw", {
      key: KEY,
      body: { upstreamUrl: "http://127.0.0.1:20001" },
    });
    expect(res.status).toBe(409);
    const route = h.systemsApiService.listSystemsApiRoutes().find((r) => r.domain === "draw.nexus.local");
    expect(route?.upstream).toBe("http://127.0.0.1:8091");
    expect(route?.userDeployed).toBe(false);
  });

  test("availability reports whether a name is already used", async () => {
    const free = await call("GET", "/api/v1/user-apps/fresh-name/availability", { key: KEY });
    expect(await free.json()).toEqual({ slug: "fresh-name", host: "fresh-name.nexus.local", taken: false });

    h.systemsApiService.registerSystemsApiTool({
      id: "calendar",
      name: "Calendar",
      description: "Ecosystem app",
      upstreamUrl: "http://127.0.0.1:8092",
      exposed: false,
      health: "healthy",
      capabilities: [],
    });
    h.systemsApiService.requestSystemsApiExposure({ toolId: "calendar", desiredHost: "calendar.nexus.local" });
    const taken = await call("GET", "/api/v1/user-apps/calendar/availability", { key: KEY });
    expect(((await taken.json()) as { taken: boolean }).taken).toBe(true);

    // The app's own earlier registration does not count against it.
    await call("PUT", "/api/v1/user-apps/mine", { key: KEY, body: { upstreamUrl: "http://127.0.0.1:20009" } });
    const own = await call("GET", "/api/v1/user-apps/mine/availability", { key: KEY });
    expect(((await own.json()) as { taken: boolean }).taken).toBe(false);
  });

  test("DELETE refuses to remove an ecosystem tool", async () => {
    h.systemsApiService.registerSystemsApiTool({
      id: "plain",
      name: "Plain",
      description: "Ecosystem tool",
      upstreamUrl: "http://127.0.0.1:4200",
      exposed: false,
      health: "healthy",
      capabilities: [],
    });
    expect((await call("DELETE", "/api/v1/user-apps/plain", { key: KEY })).status).toBe(404);
    expect(h.systemsApiService.getSystemsApiTool("plain")).not.toBeNull();
  });
});

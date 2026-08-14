import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";

/**
 * Cloud has no frontend any more — its operator console moved into the shell
 * at https://app.tnhc.dev/cloud (see
 * docs/superpowers/specs/2026-08-14-cloud-console-as-shell-views-design.md).
 * `GET /` and `GET /status` now answer with a JSON pointer to that console
 * rather than serving status.html, and `/nexus-tokens.css` — vendored only to
 * style that page — is gone with it.
 */
describe("GET / and GET /status (service pointer)", () => {
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

  const expected = {
    service: "nexus-cloud",
    role: "registry, routes, orchestration, Systems API",
    console: "https://app.tnhc.dev/cloud",
  };

  test("GET / returns the JSON service pointer, not HTML", async () => {
    const res = await handleRequest(new Request("http://localhost/", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(expected);
  });

  test("GET /status answers the same pointer", async () => {
    const res = await handleRequest(new Request("http://localhost/status", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expected);
  });

  test("GET /nexus-tokens.css is gone along with the page it styled", async () => {
    const res = await handleRequest(
      new Request("http://localhost/nexus-tokens.css", { method: "GET" }),
    );
    expect(res.status).toBe(404);
  });
});

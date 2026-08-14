import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";

describe("GET / (dashboard console)", () => {
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

  test("refuses framing by anyone but the shell", async () => {
    const res = await handleRequest(new Request("http://localhost/", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self' https://app.tnhc.dev",
    );
  });

  test("standalone: no embed class", async () => {
    const res = await handleRequest(new Request("http://localhost/", { method: "GET" }));
    expect(await res.text()).not.toContain('class="embedded"');
  });

  test("embedded: the class is injected for embed=1", async () => {
    const res = await handleRequest(new Request("http://localhost/?embed=1", { method: "GET" }));
    expect(await res.text()).toContain('class="embedded"');
  });

  test("only embed=1 counts, matching isEmbedded() in Draw and Chat", async () => {
    const res = await handleRequest(new Request("http://localhost/?embed=0", { method: "GET" }));
    expect(await res.text()).not.toContain('class="embedded"');
  });

  test("the embedded class actually hides the top bar", () => {
    const statusHtmlSource = readFileSync(
      new URL("../../public/status.html", import.meta.url),
      "utf-8",
    );
    expect(statusHtmlSource).toMatch(/\.embedded\s+#topbar\s*\{[^}]*display:\s*none/);
  });
});

describe("GET /nexus-tokens.css (vendored design tokens)", () => {
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

  test("serves the vendored stylesheet", async () => {
    const res = await handleRequest(
      new Request("http://localhost/nexus-tokens.css", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await res.text()).toContain("--nexus-color-accent-primary");
  });
});

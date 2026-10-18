import { afterEach, expect, spyOn, test } from "bun:test";
import { checkSessionPermission } from "./nexus-auth";

let fetchSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => { fetchSpy?.mockRestore(); fetchSpy = undefined; });

test("permission checks use the Auth check response and authenticated owner id", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_url: string | URL | Request, options?: RequestInit) => {
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer api-key");
    return Response.json({ authorized: true, userId: "owner-id", user: { id: "other-id", role: "founder" }, permissions: ["platform:catalog:approve"] });
  }) as unknown as typeof fetch);
  expect(await checkSessionPermission("api-key", "platform:catalog:approve")).toEqual({
    user: { id: "owner-id", role: "founder", permissions: ["platform:catalog:approve"] }, allowed: true,
  });
});

test.each([undefined, "platform:catalog:approve", [42]])("missing or malformed server permissions never infer authority from a role", async (permissions) => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({
    authorized: true, userId: "owner-id", user: { id: "owner-id", role: "founder", permissions: ["platform:catalog:approve"] }, permissions,
  })) as unknown as typeof fetch);
  expect((await checkSessionPermission("session", "platform:catalog:approve"))?.allowed).toBe(false);
});

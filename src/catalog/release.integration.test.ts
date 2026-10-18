import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { toAppEntries } from "../../../Nexus-Dashboard/src/apps";
import type { CatalogProposal } from "../systems-api/catalog";
import { expireToolHeartbeat } from "../systems-api/registry";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";

const proposal: CatalogProposal = {
	suggestedShelves: ["everyday", "work"],
	suggestedAudiences: ["general"],
	capabilities: ["messaging"],
	keywords: ["release"],
	submittedAt: "2026-10-17T00:00:00.000Z",
	version: 1,
};

function request(path: string, init: RequestInit = {}): Request {
	return new Request(`http://localhost${path}`, init);
}

describe("disposable Cloud to Dashboard catalog release", () => {
	let restoreFetch: (() => void) | undefined;

	afterEach(() => {
		restoreFetch?.();
		restoreFetch = undefined;
	});

	test("approves, projects, and normalizes the release path", async () => {
		const harness = await createSystemsApiTestHarness();
		try {
			harness.systemsApiService.registerSystemsApiTool({
				id: "release-approved",
				name: "Release Approved",
				description: "An approved release app",
				publicUrl: "https://release-approved.tnhc.dev",
				catalogProposal: proposal,
			});
			harness.systemsApiService.registerSystemsApiTool({
				id: "release-pending",
				name: "Release Pending",
				description: "A pending release app",
				publicUrl: "https://release-pending.tnhc.dev",
			});
			harness.systemsApiService.registerSystemsApiTool({
				id: "release-offline",
				name: "Release Offline",
				description: "An offline release app",
				publicUrl: "https://release-offline.tnhc.dev",
			});
			expireToolHeartbeat("release-offline");

			const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
				(async () =>
					Response.json({
						authorized: true,
						userId: "platform-admin",
						user: { id: "platform-admin", role: "admin" },
						permissions: ["platform:catalog:approve"],
					})) as unknown as typeof fetch,
			);
			restoreFetch = () => fetchSpy.mockRestore();

			const denied = await harness.handleRequest(
				request("/api/v1/catalog/release-approved/approve", { method: "POST" }),
			);
			expect(denied.status).toBe(401);

			const approved = await harness.handleRequest(
				request("/api/v1/catalog/release-approved/approve", {
					method: "POST",
					headers: { authorization: "Bearer platform-session" },
				}),
			);
			expect(approved.status).toBe(200);

			const catalogResponse = await harness.handleRequest(
				request("/api/v1/catalog"),
			);
			expect(catalogResponse.status).toBe(200);
			const projected = await catalogResponse.json();
			const entries = toAppEntries(projected, "auth.tnhc.dev");

			expect(
				entries.find((entry) => entry.id === "release-approved"),
			).toMatchObject({
				primaryShelf: "everyday",
				reviewStatus: "approved",
				health: "healthy",
			});
			expect(
				entries.find((entry) => entry.id === "release-pending"),
			).toMatchObject({
				primaryShelf: "explore",
				reviewStatus: "pending",
			});
			expect(
				entries.find((entry) => entry.id === "release-offline"),
			).toMatchObject({
				primaryShelf: "explore",
				health: "offline",
			});
		} finally {
			harness.cleanup();
		}
	});

	test("does not let a non-platform identity publish approval", async () => {
		const harness = await createSystemsApiTestHarness();
		try {
			harness.systemsApiService.registerSystemsApiTool({
				id: "release-forbidden",
				name: "Release Forbidden",
				description: "A proposed app",
				catalogProposal: proposal,
			});
			const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
				(async () =>
					Response.json({
						authorized: true,
						userId: "tenant-admin",
						user: { id: "tenant-admin", role: "tenant" },
						permissions: [],
					})) as unknown as typeof fetch,
			);
			restoreFetch = () => fetchSpy.mockRestore();
			const response = await harness.handleRequest(
				request("/api/v1/catalog/release-forbidden/approve", {
					method: "POST",
					headers: { authorization: "Bearer tenant-session" },
				}),
			);
			expect(response.status).toBe(403);
			expect(
				harness.systemsApiService.getCatalogRecord("release-forbidden")
					?.approved,
			).toBeNull();
		} finally {
			harness.cleanup();
		}
	});
});

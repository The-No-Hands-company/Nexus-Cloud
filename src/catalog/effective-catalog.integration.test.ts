import { describe, expect, test } from "bun:test";
import type { ApprovedCatalog } from "../systems-api/catalog";
import { resolveEffectiveCatalog, type GlobalCatalogEntry } from "./resolution";

const approved = (
	toolId: string,
	primaryShelf: ApprovedCatalog["primaryShelf"] = "everyday",
	): GlobalCatalogEntry => ({
	toolId,
	name: toolId,
	description: `${toolId} description`,
	reviewStatus: "approved",
	approved: {
		primaryShelf,
		secondaryShelves: [],
		audiences: ["general"],
		capabilities: ["test"],
		maturity: "stable",
		visibility: "default",
		approvedAt: "2026-10-17T00:00:00.000Z",
		approvedBy: "platform:catalog",
		version: 1,
	},
});

describe("effective catalog scope boundaries", () => {
	test("keeps tenant, node, runtime, and user layers isolated", () => {
		const globalEntries = [
			approved("approved-app"),
			approved("tenant-disabled"),
			approved("offline-app", "create"),
		];

		const tenantView = resolveEffectiveCatalog(globalEntries, {
			tenantEntitlements: { disabledAppIds: ["tenant-disabled"] },
			runtime: {
				"approved-app": { health: "healthy", canLaunch: true },
				"tenant-disabled": { health: "healthy", canLaunch: true },
				"offline-app": { health: "offline", canLaunch: true },
			},
		});
		const tenantDisabled = tenantView.find((entry) => entry.toolId === "tenant-disabled");
		const offline = tenantView.find((entry) => entry.toolId === "offline-app");
		expect(tenantDisabled).toMatchObject({ scope: "platform", availability: "disabled", canLaunch: false });
		expect(offline).toMatchObject({ availability: "offline", canLaunch: false });

		const nodeView = resolveEffectiveCatalog(globalEntries, {
			nodeOverlay: {
				disabledAppIds: ["approved-app"],
				localApps: [{ toolId: "node-local", name: "Node local", canLaunch: true }],
			},
			runtime: {
				"approved-app": { health: "healthy", canLaunch: true },
				"node-local": { health: "healthy", canLaunch: true },
			},
		});
		expect(nodeView.find((entry) => entry.toolId === "approved-app")).toMatchObject({ availability: "disabled", canLaunch: false });
		expect(nodeView.find((entry) => entry.toolId === "node-local")).toMatchObject({ scope: "node", primaryShelf: "explore", reviewStatus: "pending", canLaunch: true });
		expect(tenantView.some((entry) => entry.toolId === "node-local")).toBe(false);

		const userView = resolveEffectiveCatalog(globalEntries, {
			userPreferences: { pinnedIds: ["offline-app"], preferredShelf: "create" },
			runtime: {
				"approved-app": { health: "healthy", canLaunch: true },
				"tenant-disabled": { health: "healthy", canLaunch: true },
				"offline-app": { health: "offline", canLaunch: true },
			},
		});
		expect(userView[0]).toMatchObject({ toolId: "offline-app", primaryShelf: "create", preferredByUser: true, canLaunch: false });
	});

	test("presentation preferences never grant access or mutate source entries", () => {
		const globalEntries = [approved("restricted-app", "operate")];
		const before = structuredClone(globalEntries);
		const [entry] = resolveEffectiveCatalog(globalEntries, {
			userPreferences: { pinnedIds: ["restricted-app"], preferredShelf: "operate" },
			runtime: { "restricted-app": { health: "healthy", canLaunch: true } },
		});

		// This fixture is globally visible; the explicit runtime access decision is
		// what controls launchability, even when the user pins its shelf.
		expect(entry).toMatchObject({ primaryShelf: "operate", preferredByUser: true, canLaunch: true });
		expect(globalEntries).toEqual(before);

		const denied = resolveEffectiveCatalog(globalEntries, {
			tenantEntitlements: { disabledAppIds: ["restricted-app"] },
			userPreferences: { preferredShelf: "operate", pinnedIds: ["restricted-app"] },
			runtime: { "restricted-app": { health: "healthy", canLaunch: true } },
		})[0];
		expect(denied).toMatchObject({ primaryShelf: "operate", preferredByUser: true, availability: "disabled", canLaunch: false });
	});
});

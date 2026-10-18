import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeCatalogOverlayStore, resolveNodeOverlay } from "./node-overlay";

describe("node catalog overlays", () => {
	test("persist local apps and shelf overrides without becoming global", () => {
		const dir = mkdtempSync(join(tmpdir(), "nexus-node-catalog-"));
		try {
			const path = join(dir, "state.json");
			const first = new NodeCatalogOverlayStore(path);
			first.upsert("node-a", {
				disabledAppIds: ["nexus-mail"],
				shelfOverrides: { "nexus-mail": "operate" },
				localApps: [{ toolId: "local-draw", name: "Local Draw", canLaunch: true }],
			});
			const second = new NodeCatalogOverlayStore(path);
			expect(resolveNodeOverlay(second, "node-a")).toMatchObject({ disabledAppIds: ["nexus-mail"], shelfOverrides: { "nexus-mail": "operate" } });
			expect(resolveNodeOverlay(second, "node-a").localApps?.[0]).toMatchObject({ toolId: "local-draw" });
			expect(resolveNodeOverlay(second, "node-b")).toEqual({});
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});

	test("rejects a local record that claims platform scope", () => {
		const store = new NodeCatalogOverlayStore(join(mkdtempSync(join(tmpdir(), "nexus-node-catalog-")), "state.json"));
		expect(() => store.upsert("node-a", { localApps: [{ toolId: "platform", name: "No", canLaunch: true }] })).toThrow(/platform scope/);
	});
});

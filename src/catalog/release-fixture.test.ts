import { describe, expect, test } from "bun:test";
import { buildCatalogReleaseFixture } from "./release-fixture";

describe("catalog release fixture", () => {
	test("covers each release state and preserves the app routes", () => {
		const { apps } = buildCatalogReleaseFixture();
		expect(apps).toHaveLength(7);
		expect(apps.map((app) => app.path)).toEqual([
			"/calendar",
			"/design",
			"/forge",
			"/cloud",
			"/experimental",
			"/video",
			"/legacy-notes",
		]);
		expect(apps.filter((app) => app.reviewStatus === "approved")).toHaveLength(
			5,
		);
		expect(apps.find((app) => app.id === "nexus-experimental")).toMatchObject({
			reviewStatus: "pending",
			delivery: "framed",
		});
		expect(
			apps.find((app) => app.id === "nexus-experimental"),
		).not.toHaveProperty("primaryShelf");
		expect(apps.find((app) => app.id === "nexus-video")).toMatchObject({
			primaryShelf: "create",
			health: "offline",
		});
		expect(apps.find((app) => app.id === "legacy-notes")).not.toHaveProperty(
			"primaryShelf",
		);
	});
});

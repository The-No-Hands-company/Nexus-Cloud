import { describe, expect, test } from "bun:test";
import { buildCatalogReleaseFixture } from "./release-fixture";

describe("catalog release fixture", () => {
	test("covers each release state and preserves the app routes", () => {
		const { apps } = buildCatalogReleaseFixture();
		expect(apps).toHaveLength(8);
		expect(apps.map((app) => app.path)).toEqual([
			"/mail",
			"/calendar",
			"/design",
			"/forge",
			"/cloud",
			"/experimental",
			"/video",
			"/legacy-notes",
		]);
		expect(apps.filter((app) => app.reviewStatus === "approved")).toHaveLength(
			6,
		);
		expect(apps.find((app) => app.id === "nexus-email")).toMatchObject({ delivery: "shell-native", surface: "user-app", releaseState: "released" });
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
			surface: "user-app",
			releaseState: "staged",
		});
		expect(apps.find((app) => app.id === "nexus-calendar")).toMatchObject({ surface: "user-app", releaseState: "staged" });
		expect(apps.find((app) => app.id === "nexus-design")).toMatchObject({ surface: "user-app", releaseState: "staged" });
		expect(apps.find((app) => app.id === "nexus-forge")).toMatchObject({ surface: "developer-tool", releaseState: "released" });
		expect(apps.find((app) => app.id === "nexus-cloud")).toMatchObject({ surface: "admin-console", releaseState: "released" });
		expect(apps.find((app) => app.id === "legacy-notes")).not.toHaveProperty(
			"primaryShelf",
		);
	});
});

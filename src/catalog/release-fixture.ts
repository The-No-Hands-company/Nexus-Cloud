/**
 * Disposable Cloud response used by the catalog release tests.
 *
 * This deliberately mirrors the public `/api/v1/catalog` wire shape without
 * importing the runtime registry. It is a contract fixture, never startup
 * data: the seed migration remains the only source of built-in approvals.
 */
export type CatalogReleaseFixtureApp = {
	id: string;
	name: string;
	description: string;
	path: string;
	publicUrl?: string;
	delivery: "shell-native" | "proxied-app" | "framed" | "external";
	health: "healthy" | "offline";
	primaryShelf?: string;
	secondaryShelves?: string[];
	audiences?: string[];
	capabilities?: string[];
	maturity?: "stable" | "preview" | "experimental";
	visibility?: "default" | "discoverable" | "restricted" | "hidden";
	reviewStatus?: "approved" | "pending" | "deferred" | "rejected";
};

export type CatalogReleaseFixture = { apps: CatalogReleaseFixtureApp[] };

export function buildCatalogReleaseFixture(): CatalogReleaseFixture {
	return {
		apps: [
			{
				id: "nexus-calendar",
				name: "Nexus Calendar",
				description: "Shared calendars and scheduling",
				path: "/calendar",
				publicUrl: "https://calendar.tnhc.dev",
				delivery: "proxied-app",
				health: "healthy",
				primaryShelf: "everyday",
				secondaryShelves: ["work", "personal"],
				audiences: ["general"],
				capabilities: ["calendar", "scheduling"],
				maturity: "stable",
				visibility: "default",
				reviewStatus: "approved",
			},
			{
				id: "nexus-design",
				name: "Nexus Design",
				description: "Interface and product design",
				path: "/design",
				publicUrl: "https://design.tnhc.dev",
				delivery: "framed",
				health: "healthy",
				primaryShelf: "create",
				secondaryShelves: [],
				audiences: ["creator", "general"],
				capabilities: ["design", "ui"],
				maturity: "stable",
				visibility: "default",
				reviewStatus: "approved",
			},
			{
				id: "nexus-forge",
				name: "Nexus Forge",
				description: "Repositories and development workflows",
				path: "/forge",
				publicUrl: "https://forge.tnhc.dev",
				delivery: "framed",
				health: "healthy",
				primaryShelf: "develop",
				secondaryShelves: ["operate"],
				audiences: ["developer", "power-user"],
				capabilities: ["code", "repositories"],
				maturity: "stable",
				visibility: "default",
				reviewStatus: "approved",
			},
			{
				id: "nexus-cloud",
				name: "Nexus Cloud",
				description: "Control plane, registry, and federation",
				path: "/cloud",
				delivery: "shell-native",
				health: "healthy",
				primaryShelf: "operate",
				secondaryShelves: [],
				audiences: ["operations", "power-user"],
				capabilities: ["control-plane", "registry", "federation"],
				maturity: "stable",
				visibility: "default",
				reviewStatus: "approved",
			},
			{
				id: "nexus-experimental",
				name: "Nexus Experimental",
				description: "An app awaiting catalog review",
				path: "/experimental",
				publicUrl: "https://experimental.tnhc.dev",
				delivery: "framed",
				health: "healthy",
				reviewStatus: "pending",
			},
			{
				id: "nexus-video",
				name: "Nexus Video",
				description: "Video creation",
				path: "/video",
				publicUrl: "https://video.tnhc.dev",
				delivery: "framed",
				health: "offline",
				primaryShelf: "create",
				secondaryShelves: [],
				audiences: ["creator"],
				capabilities: ["video", "media"],
				maturity: "stable",
				visibility: "default",
				reviewStatus: "approved",
			},
			{
				id: "legacy-notes",
				name: "Legacy Notes",
				description: "An older registry record without catalog metadata",
				path: "/legacy-notes",
				publicUrl: "https://legacy-notes.tnhc.dev",
				delivery: "framed",
				health: "healthy",
			},
		],
	};
}

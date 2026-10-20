import {
	type ApprovedCatalog,
	CATALOG_AUDIENCES,
	type CatalogAudience,
	type CatalogMaturity,
	type CatalogReleaseState,
	type CatalogShelf,
	type CatalogSurface,
} from "../systems-api/catalog";
import {
	getCatalogRecord,
	getCatalogSeedVersion,
	listTools,
	saveApprovedCatalog,
	setCatalogSeedVersion,
} from "../systems-api/registry";

export const CATALOG_SEED_VERSION = 2;

export type CoreCatalogSeed = {
	primaryShelf: CatalogShelf;
	secondaryShelves: CatalogShelf[];
	audiences: CatalogAudience[];
	capabilities: string[];
	maturity: CatalogMaturity;
	surface: CatalogSurface;
	releaseState: CatalogReleaseState;
};

const general: CatalogAudience[] = ["general"];
const developer: CatalogAudience[] = ["developer", "power-user"];
const operations: CatalogAudience[] = ["operations", "power-user"];

/** The first-wave placement is explicit and versioned, never inferred by name. */
export const CORE_CATALOG_SEED: Readonly<Record<string, CoreCatalogSeed>> = {
	"nexus-email": {
		primaryShelf: "everyday",
		secondaryShelves: ["work"],
		audiences: general,
		capabilities: ["mail", "calendar-inbox"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "released",
	},
	"nexus-calendar": {
		primaryShelf: "everyday",
		secondaryShelves: ["work", "personal"],
		audiences: general,
		capabilities: ["calendar", "scheduling"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-chat": {
		primaryShelf: "work",
		secondaryShelves: ["everyday", "personal"],
		audiences: general,
		capabilities: ["chat", "messaging"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-project": {
		primaryShelf: "work",
		secondaryShelves: ["develop"],
		audiences: ["business", "developer"],
		capabilities: ["projects", "tasks"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-design": {
		primaryShelf: "create",
		secondaryShelves: [],
		audiences: ["creator", "general"],
		capabilities: ["design", "ui"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-graphic": {
		primaryShelf: "create",
		secondaryShelves: [],
		audiences: ["creator", "general"],
		capabilities: ["graphics", "illustration"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-photos": {
		primaryShelf: "create",
		secondaryShelves: ["personal"],
		audiences: ["creator", "general"],
		capabilities: ["photos", "media"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-video": {
		primaryShelf: "create",
		secondaryShelves: [],
		audiences: ["creator", "general"],
		capabilities: ["video", "media"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-draw": {
		primaryShelf: "create",
		secondaryShelves: ["work"],
		audiences: ["creator", "business"],
		capabilities: ["canvas", "whiteboard"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-forge": {
		primaryShelf: "develop",
		secondaryShelves: ["operate"],
		audiences: developer,
		capabilities: ["code", "repositories"],
		maturity: "stable",
		surface: "developer-tool",
		releaseState: "released",
	},
	"nexus-hosting": {
		primaryShelf: "create",
		secondaryShelves: ["operate", "develop"],
		audiences: ["general", "developer"] as CatalogAudience[],
		capabilities: ["hosting", "static-sites", "custom-domains"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "released",
	},
	"nexus-deploy": {
		primaryShelf: "operate",
		secondaryShelves: ["develop"],
		audiences: operations,
		capabilities: ["deployment", "ci-cd"],
		maturity: "stable",
		surface: "user-app",
		releaseState: "staged",
	},
	"nexus-terminal": {
		primaryShelf: "operate",
		secondaryShelves: ["develop"],
		audiences: operations,
		capabilities: ["terminal", "cli"],
		maturity: "stable",
		surface: "developer-tool",
		releaseState: "released",
	},
	"nexus-cloud": {
		primaryShelf: "operate",
		secondaryShelves: [],
		audiences: operations,
		capabilities: ["control-plane", "registry", "federation"],
		maturity: "stable",
		surface: "admin-console",
		releaseState: "released",
	},
	"nexus-auth": {
		primaryShelf: "operate",
		secondaryShelves: [],
		audiences: operations,
		capabilities: ["identity", "sso"],
		maturity: "stable",
		surface: "platform-service",
		releaseState: "released",
	},
	"nexus-network": {
		primaryShelf: "operate",
		secondaryShelves: [],
		audiences: operations,
		capabilities: ["network", "topology"],
		maturity: "stable",
		surface: "platform-service",
		releaseState: "released",
	},
	"nexus-vault": {
		primaryShelf: "operate",
		secondaryShelves: ["personal"],
		audiences: ["general", "operations"],
		capabilities: ["secrets", "storage"],
		maturity: "stable",
		surface: "platform-service",
		releaseState: "released",
	},
};

export type SeedRegistry = {
	listTools: () => readonly { id: string }[];
	getCatalogRecord: (
		toolId: string,
	) => { approved: ApprovedCatalog | null } | null;
	getCatalogSeedVersion: () => number;
	saveApprovedCatalog: (toolId: string, approved: ApprovedCatalog) => unknown;
	setCatalogSeedVersion: (version: number) => void;
};

const liveRegistry: SeedRegistry = {
	listTools,
	getCatalogRecord,
	getCatalogSeedVersion,
	saveApprovedCatalog,
	setCatalogSeedVersion,
};

export function applyCoreCatalogSeed(registry: SeedRegistry = liveRegistry): {
	applied: string[];
	skipped: string[];
} {
	const registered = new Set(registry.listTools().map((tool) => tool.id));
	const applied: string[] = [];
	const skipped: string[] = [];
	const approvedAt = new Date().toISOString();

	for (const [toolId, placement] of Object.entries(CORE_CATALOG_SEED).sort(
		([a], [b]) => a.localeCompare(b),
	)) {
		if (!registered.has(toolId)) {
			skipped.push(toolId);
			continue;
		}
		const existing = registry.getCatalogRecord(toolId)?.approved;
		if (existing && existing.version >= CATALOG_SEED_VERSION) {
			skipped.push(toolId);
			continue;
		}
		registry.saveApprovedCatalog(toolId, {
			...placement,
			visibility: "default",
			approvedAt,
			approvedBy: "core-catalog-seed",
			version: CATALOG_SEED_VERSION,
		});
		applied.push(toolId);
	}

	if (registry.getCatalogSeedVersion() < CATALOG_SEED_VERSION)
		registry.setCatalogSeedVersion(CATALOG_SEED_VERSION);
	return { applied, skipped };
}

export function assertCoreCatalogSeed(): void {
	for (const placement of Object.values(CORE_CATALOG_SEED)) {
		if (!CATALOG_AUDIENCES.every((audience) => typeof audience === "string"))
			throw new Error("Invalid catalog audience");
		if (placement.secondaryShelves.includes(placement.primaryShelf))
			throw new Error("Seed shelf duplicates primary shelf");
	}
}

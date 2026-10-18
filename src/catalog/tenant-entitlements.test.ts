import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTenantEntitlements, TenantCatalogEntitlementsStore } from "./tenant-entitlements";

describe("tenant catalog entitlements", () => {
	test("persists tenant-isolated availability without changing global state", () => {
		const dir = mkdtempSync(join(tmpdir(), "nexus-tenant-catalog-"));
		try {
			const path = join(dir, "state.json");
			const first = new TenantCatalogEntitlementsStore(path);
			first.upsert("tenant-a", { disabledAppIds: ["nexus-mail", "nexus-mail"] });
			first.upsert("tenant-b", { enabledAppIds: ["nexus-mail"] });
			const second = new TenantCatalogEntitlementsStore(path);
			expect(resolveTenantEntitlements(second, "tenant-a")).toEqual({ enabledAppIds: [], disabledAppIds: ["nexus-mail"] });
			expect(resolveTenantEntitlements(second, "tenant-b")).toEqual({ enabledAppIds: ["nexus-mail"], disabledAppIds: [] });
			expect(resolveTenantEntitlements(second, "missing")).toEqual({});
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});
});

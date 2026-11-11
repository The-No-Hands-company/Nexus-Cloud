import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "nexus-cloud-tests-"));

process.env.NEXUS_CLOUD_STATE_PATH = join(dir, "platform-state.json");

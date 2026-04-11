import { architecture } from "./architecture";
import { apiRoutes, apiSurface } from "./api";
import { controlPlane, controlPlaneService } from "./control-plane";
import { dataPlane } from "./data-plane";
import { federation } from "./federation";
import { observability } from "./observability";
import { server, port } from "./server";
import { storage } from "./storage";
import { systemsApiService } from "./systems-api";
import { generateZoneFile } from "./dns-zone";
import { mkdirSync, writeFileSync } from "fs";

console.log(`${architecture.project} listening on ${port}`);
console.log(architecture.mission);
console.log("Principles:");
for (const principle of architecture.principles) {
  console.log(`- ${principle}`);
}

console.log("API routes:");
for (const route of apiRoutes) {
  console.log(`- ${route.method} ${route.path} — ${route.description}`);
}

console.log("Surface modules:");
console.log(Object.keys(apiSurface).join(", "));
console.log("State snapshot:", JSON.stringify(controlPlaneService.snapshot()));
console.log("Systems API:", systemsApiService.describeSystemsApi());
console.log("Modules:", {
  controlPlane: controlPlane.services,
  dataPlane: dataPlane.runtimes,
  federation: federation.protocol,
  observability: observability.signals,
  storage: storage.classes.map((item) => item.name),
});

server;

// Write the initial DNS zone file so CoreDNS (sovereign mode) can serve it on startup.
try {
  mkdirSync("data/dns", { recursive: true });
  writeFileSync("data/dns/nexus.zone", generateZoneFile(), "utf-8");
} catch {
  // Non-fatal — zone file is regenerated on GET /api/v1/routes/zone
}

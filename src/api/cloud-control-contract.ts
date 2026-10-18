import type { ApiRoute } from "./dto";
import { apiRouteManifest } from "./routes";

export type CloudContractAccess =
  | "public"
  | "cloud-api-key"
  | "platform-permission"
  | "session-or-bearer"
  | "deploy-token";

export type CloudContractRoute = ApiRoute & {
  access: CloudContractAccess;
};

export type NexusCloudContract = {
  protocol: "nexus-cloud/1";
  service: {
    id: "nexus-cloud";
    name: "Nexus Cloud";
    surface: "admin-console";
    hostedPath: "/cloud";
    auth: "Nexus Auth session or Cloud API key";
  };
  routes: readonly CloudContractRoute[];
};

const PUBLIC_GET_PATHS = new Set([
  "/health",
  "/api/v1/contract",
  "/api/v1/tools",
  "/api/v1/catalog",
  "/api/v1/endpoints",
  "/api/v1/capabilities",
  "/api/v1/summary",
  "/api/v1/compliance/phantom",
  "/api/v1/compliance/phantom/summary",
  "/api/v1/trust/summary",
  "/api/v1/apps",
  "/api/v1/connections",
  "/api/v1/topology",
  "/api/v1/status",
  "/api/v1/addresses",
  "/api/v1/exposures",
  "/api/v1/domains",
  "/api/v1/deployments/integration",
  "/api/v1/dns/status",
  "/api/v1/routes/tls-ask",
  "/.well-known/nexus-cloud",
]);

function accessForRoute(route: ApiRoute): CloudContractAccess {
  if (route.path === "/api/v1/contract") return "public";
  if (route.path.includes("/catalog/:toolId/") && route.method === "POST") {
    return "platform-permission";
  }
  if (
    route.method === "GET" &&
    (route.path === "/api/v1/routes" ||
      route.path === "/api/v1/routes/caddy" ||
      route.path === "/api/v1/routes/zone" ||
      route.path.startsWith("/api/v1/catalog/") ||
      route.path.startsWith("/api/v1/tenants/") ||
      route.path.startsWith("/api/v1/nodes/"))
  ) {
    return "cloud-api-key";
  }
  if (route.path === "/api/v1/auth/login" || route.path === "/api/v1/users") {
    return route.method === "GET" ? "session-or-bearer" : "public";
  }
  if (route.path === "/api/v1/auth/logout" || route.path === "/api/v1/auth/me") {
    return "session-or-bearer";
  }
  if (route.path === "/api/v1/deployments" && route.method === "POST") return "deploy-token";
  if (route.method === "GET" && PUBLIC_GET_PATHS.has(route.path)) return "public";
  return route.method === "GET" ? "public" : "cloud-api-key";
}

export function buildCloudControlContract(): NexusCloudContract {
  return {
    protocol: "nexus-cloud/1",
    service: {
      id: "nexus-cloud",
      name: "Nexus Cloud",
      surface: "admin-console",
      hostedPath: "/cloud",
      auth: "Nexus Auth session or Cloud API key",
    },
    routes: apiRouteManifest.map((route) => ({ ...route, access: accessForRoute(route) })),
  };
}

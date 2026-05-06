import { handleRequest } from "./api/router";
import { controlPlaneService } from "./control-plane";
import { federationService } from "./federation";
import { applyHeartbeatExpiry } from "./systems-api/service";

export const port = Number(process.env.PORT ?? "8787");
export const server = Bun.serve({
  port,
  fetch: handleRequest,
});

// Mark tools offline when they have heartbeated before but missed the 90-second deadline.
setInterval(() => {
  applyHeartbeatExpiry();
  controlPlaneService.applyNodeTrustExpiry();
  federationService.applyPeerTrustExpiry();
}, 30_000);

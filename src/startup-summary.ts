import type { ControlPlaneSnapshot } from "./control-plane/service";

export type SafeStartupSummary = {
  nodeCount: number;
  workloadCount: number;
  peerCount: number;
  eventCount: number;
  volumeCount: number;
  storagePoolCount: number;
  unitCount: number;
  healthCheckCount: number;
  guardianDecisionCount: number;
};

export function startupSummary(snapshot: ControlPlaneSnapshot): SafeStartupSummary {
  return {
    nodeCount: snapshot.nodes.length,
    workloadCount: snapshot.workloads.length,
    peerCount: snapshot.peers.length,
    eventCount: snapshot.events.length,
    volumeCount: snapshot.volumes.length,
    storagePoolCount: snapshot.sharedStoragePools.length,
    unitCount: snapshot.units.length,
    healthCheckCount: snapshot.healthChecks.length,
    guardianDecisionCount: snapshot.guardianDecisions.length,
  };
}

import { spawnSync } from "node:child_process";
import { mutateState, state } from "../state";
import { recordEvent, upsertHealthCheck } from "../observability";
import type { WorkloadSpec } from "../control-plane";
import type { DataPlaneUnit, StorageMount } from "./index";

export type ContainerRuntimeProvider = "docker" | "podman";

export type RuntimeExecutionResult = {
  ok: boolean;
  unit: DataPlaneUnit;
  provider?: ContainerRuntimeProvider;
  error?: string;
};

export type CommandRunner = typeof spawnSync;

let commandRunner: CommandRunner = spawnSync;

export function setCommandRunnerForTests(runner: CommandRunner | null): void {
  commandRunner = runner ?? spawnSync;
}

function now(): string {
  return new Date().toISOString();
}

function findAvailableContainerProvider(): ContainerRuntimeProvider | null {
  for (const provider of ["docker", "podman"] as const) {
    const result = commandRunner(provider, ["--version"], { stdio: "ignore" });
    if (result.status === 0) return provider;
  }
  return null;
}

function buildContainerName(workloadId: string): string {
  return `nexus-cloud-${workloadId}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildEnvArgs(workload: WorkloadSpec): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(workload.env)) {
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

function buildPortArgs(workload: WorkloadSpec): string[] {
  const args: string[] = [];
  for (const port of workload.ports) {
    args.push("-p", `${port}:${port}`);
  }
  return args;
}

function buildMounts(workload: WorkloadSpec): StorageMount[] {
  return workload.storage.map((volumeId, index) => ({
    volumeId,
    mountPath: `/mnt/nexus/${index + 1}`,
    readOnly: false,
  }));
}

function buildMountArgs(mounts: StorageMount[]): string[] {
  const args: string[] = [];
  for (const mount of mounts) {
    args.push("-v", `${mount.volumeId}:${mount.mountPath}${mount.readOnly ? ":ro" : ""}`);
  }
  return args;
}

function createUnit(workload: WorkloadSpec, nodeId: string, stateName: DataPlaneUnit["state"], partial?: Partial<DataPlaneUnit>): DataPlaneUnit {
  return {
    id: `unit_${crypto.randomUUID()}`,
    kind: workload.runtime,
    state: stateName,
    nodeId,
    workloadId: workload.id,
    image: workload.image,
    mounts: buildMounts(workload),
    ports: [...workload.ports],
    env: { ...workload.env },
    createdAt: now(),
    updatedAt: now(),
    ...partial,
  };
}

function saveUnit(unit: DataPlaneUnit): DataPlaneUnit {
  mutateState((draft) => {
    const index = draft.units.findIndex((item) => item.id === unit.id);
    if (index >= 0) draft.units[index] = unit;
    else draft.units.push(unit);
  });
  upsertHealthCheck({
    id: `runtime:${unit.id}`,
    component: "data-plane",
    subject: unit.workloadId ?? unit.id,
    status: unit.state === "running" ? "healthy" : unit.state === "failed" ? "offline" : "degraded",
    summary: `Runtime unit ${unit.state}`,
    checkedAt: unit.updatedAt ?? now(),
    details: { nodeId: unit.nodeId, runtime: unit.kind, provider: unit.provider ?? "none" },
  });
  return unit;
}

export function listRuntimeUnits(): readonly DataPlaneUnit[] {
  return state.units;
}

export function runContainerWorkload(workload: WorkloadSpec, nodeId: string): RuntimeExecutionResult {
  const provider = findAvailableContainerProvider();
  if (!provider) {
    const failed = saveUnit(createUnit(workload, nodeId, "failed", { lastError: "No container runtime available" }));
    recordEvent({
      kind: "audit",
      level: "error",
      source: "data-plane",
      subjectId: workload.id,
      message: `Failed to start workload ${workload.id}: no container runtime available`,
      timestamp: failed.updatedAt ?? now(),
    });
    return { ok: false, unit: failed, error: failed.lastError };
  }

  const name = buildContainerName(workload.id);
  const mounts = buildMounts(workload);
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--label",
    `nexus.cloud.workload=${workload.id}`,
    ...buildPortArgs(workload),
    ...buildEnvArgs(workload),
    ...buildMountArgs(mounts),
    workload.image,
  ];

  const result = commandRunner(provider, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const failed = saveUnit(createUnit(workload, nodeId, "failed", {
      provider,
      runtimeId: name,
      lastError: (result.stderr || result.stdout || "Container runtime failed").trim(),
      mounts,
    }));
    recordEvent({
      kind: "audit",
      level: "error",
      source: "data-plane",
      subjectId: workload.id,
      message: `Container start failed for ${workload.id}`,
      timestamp: failed.updatedAt ?? now(),
      metadata: { provider },
    });
    return { ok: false, unit: failed, provider, error: failed.lastError };
  }

  const running = saveUnit(createUnit(workload, nodeId, "running", {
    provider,
    runtimeId: (result.stdout || "").trim() || name,
    mounts,
  }));
  recordEvent({
    kind: "audit",
    level: "info",
    source: "data-plane",
    subjectId: workload.id,
    message: `Started workload ${workload.id} with ${provider}`,
    timestamp: running.updatedAt ?? now(),
    metadata: { provider },
  });
  return { ok: true, unit: running, provider };
}

export function runWorkload(workloadId: string): RuntimeExecutionResult | null {
  const workload = state.workloads.find((item) => item.id === workloadId);
  const node = state.nodes.find((item) => item.status === "ready");
  if (!workload || !node) return null;
  if (workload.runtime !== "container") {
    const failed = saveUnit(createUnit(workload, node.id, "failed", { lastError: `Unsupported runtime ${workload.runtime}` }));
    return { ok: false, unit: failed, error: failed.lastError };
  }
  return runContainerWorkload(workload, node.id);
}

export function stopWorkload(workloadId: string): DataPlaneUnit[] {
  const units = state.units.filter((item) => item.workloadId === workloadId && item.state === "running");
  const stopped: DataPlaneUnit[] = [];
  for (const unit of units) {
    if (unit.provider && unit.runtimeId) {
      commandRunner(unit.provider, ["stop", unit.runtimeId], { encoding: "utf8" });
    }
    const next: DataPlaneUnit = { ...unit, state: "stopped", updatedAt: now() };
    stopped.push(saveUnit(next));
  }
  if (stopped.length) {
    recordEvent({
      kind: "audit",
      level: "info",
      source: "data-plane",
      subjectId: workloadId,
      message: `Stopped workload ${workloadId}`,
      timestamp: now(),
    });
  }
  return stopped;
}

export const dataPlaneService = {
  listRuntimeUnits,
  runWorkload,
  setCommandRunnerForTests,
  stopWorkload,
};
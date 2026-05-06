import { afterEach, describe, expect, test } from "bun:test";
import { dataPlaneService } from "./service";
import { resetPlatformStateForTests, type PlatformState } from "../state";

function seedState(runtime: "container" | "function" = "container"): void {
  const seeded: PlatformState = {
    nodes: [
      {
        id: "node-1",
        name: "node-1",
        region: "local",
        zone: "local-a",
        labels: {},
        capacity: { cpu: 4, memoryMb: 8192, storageGb: 100 },
        status: "ready",
      },
    ],
    workloads: [
      {
        id: "workload-1",
        name: "workload-1",
        image: "nginx:latest",
        replicas: 1,
        cpuMillicores: 250,
        memoryMb: 256,
        runtime,
        env: { NEXUS_MODE: "test" },
        ports: [8080],
        storage: ["volume-a"],
      },
    ],
    peers: [],
    events: [],
    volumes: [],
    units: [],
    healthChecks: [],
    guardianDecisions: [],
  };
  resetPlatformStateForTests(seeded);
}

afterEach(() => {
  dataPlaneService.setCommandRunnerForTests(null);
  resetPlatformStateForTests();
});

describe("data-plane runtime adapter", () => {
  test("returns failed when no container runtime is available", () => {
    seedState("container");
    dataPlaneService.setCommandRunnerForTests(((command: string, args?: readonly string[]) => {
      if (args?.[0] === "--version") {
        return { status: 1, stdout: "", stderr: "missing" } as any;
      }
      return { status: 1, stdout: "", stderr: "missing" } as any;
    }) as any);

    const result = dataPlaneService.runWorkload("workload-1");
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.unit.state).toBe("failed");
    expect(result?.error).toContain("No container runtime available");
  });

  test("starts container workload when provider is available", () => {
    seedState("container");
    const calls: Array<{ command: string; args: readonly string[] | undefined }> = [];
    dataPlaneService.setCommandRunnerForTests(((command: string, args?: readonly string[]) => {
      calls.push({ command, args });
      if (args?.[0] === "--version") {
        return { status: command === "docker" ? 0 : 1, stdout: "ok", stderr: "" } as any;
      }
      if (args?.[0] === "run") {
        return { status: 0, stdout: "container-id-123\n", stderr: "" } as any;
      }
      return { status: 0, stdout: "", stderr: "" } as any;
    }) as any);

    const result = dataPlaneService.runWorkload("workload-1");
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    expect(result?.provider).toBe("docker");
    expect(result?.unit.state).toBe("running");
    expect(result?.unit.runtimeId).toBe("container-id-123");
    expect(calls.some((call) => call.command === "docker" && call.args?.[0] === "run")).toBe(true);
  });

  test("records failure when runtime command fails", () => {
    seedState("container");
    dataPlaneService.setCommandRunnerForTests(((command: string, args?: readonly string[]) => {
      if (args?.[0] === "--version") {
        return { status: command === "podman" ? 0 : 1, stdout: "ok", stderr: "" } as any;
      }
      if (args?.[0] === "run") {
        return { status: 1, stdout: "", stderr: "boom" } as any;
      }
      return { status: 0, stdout: "", stderr: "" } as any;
    }) as any);

    const result = dataPlaneService.runWorkload("workload-1");
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.provider).toBe("podman");
    expect(result?.unit.state).toBe("failed");
    expect(result?.error).toContain("boom");
  });

  test("stops active units and marks them stopped", () => {
    seedState("container");
    const calls: Array<{ command: string; args: readonly string[] | undefined }> = [];
    dataPlaneService.setCommandRunnerForTests(((command: string, args?: readonly string[]) => {
      calls.push({ command, args });
      if (args?.[0] === "--version") {
        return { status: command === "docker" ? 0 : 1, stdout: "ok", stderr: "" } as any;
      }
      if (args?.[0] === "run") {
        return { status: 0, stdout: "container-id-456\n", stderr: "" } as any;
      }
      if (args?.[0] === "stop") {
        return { status: 0, stdout: "stopped", stderr: "" } as any;
      }
      return { status: 0, stdout: "", stderr: "" } as any;
    }) as any);

    const started = dataPlaneService.runWorkload("workload-1");
    expect(started?.ok).toBe(true);

    const stopped = dataPlaneService.stopWorkload("workload-1");
    expect(stopped.length).toBe(1);
    expect(stopped[0]?.state).toBe("stopped");
    expect(calls.some((call) => call.command === "docker" && call.args?.[0] === "stop")).toBe(true);
  });

  test("returns failed for unsupported runtime kind", () => {
    seedState("function");
    const result = dataPlaneService.runWorkload("workload-1");
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.unit.state).toBe("failed");
    expect(result?.error).toContain("Unsupported runtime function");
  });
});
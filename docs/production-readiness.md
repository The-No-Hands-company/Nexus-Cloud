# Nexus Cloud Production Readiness

## Purpose

This document is the implementation-facing backlog for making Nexus Cloud feature complete and production ready.

It is intentionally repo-grounded. It reflects the current code shape rather than an abstract ideal.

## Current reality

Nexus Cloud already has meaningful progress in three areas:

- the control plane has real module boundaries for registration, quota, policy, scheduling, and placement
- the Systems API already exposes substantial canonical surfaces for tools, topology, status, exposures, domains, and addresses
- the federation layer already has a usable peer and trust scaffold

Nexus Cloud is not yet production ready because several critical layers are still shallow or memory-backed:

- state durability is not complete
- observability is minimal
- Guardian policy workflows are incomplete
- the data plane does not yet execute workloads end to end
- storage does not yet manage real lifecycle and recovery semantics

## Production gates

Nexus Cloud should not be considered production ready until all of these gates are satisfied:

### 1. Durable platform state

- persist nodes, workloads, peers, exposures, domains, public addresses, and audit events
- define startup recovery behavior after unclean shutdown
- document state schema evolution and migration strategy
- prove restart safety with tests

### 2. Guardian and trust enforcement

- require explicit policy evaluation for public exposure and domain binding
- support approval, denial, suspension, and quarantine flows
- record machine-readable reasons for every decision
- unify operator, service, and peer trust boundaries

### 3. Operator auth and service auth

- define operator sessions and bearer-token policy clearly
- formalize service-to-service request signing beyond ad hoc tokens
- deepen peer request verification for federation paths
- separate user-facing auth from internal service trust

### 4. Observability and forensics

- expose health summaries that reflect real subsystem state
- store audit events durably
- add structured metrics for registry, exposure, policy, routing, and peer events
- add alert hooks for unsafe exposure, peer trust failures, and failed workload transitions

### 5. Runtime execution

- move from placement planning to workload enactment
- support runtime state transitions with clear failure semantics
- add at least one real runtime adapter as the first production target
- connect runtime health back into Systems API status and observability

### 6. Storage lifecycle

- create and track durable volumes
- support attach and detach semantics
- add snapshots, backup metadata, and retention policy
- define recovery and restore behavior for workload-linked storage

### 7. Public access hardening

- make route health explicit
- bind policy decisions to route admission
- complete custom-domain verification and certificate lifecycle operations
- ensure exposure state and routing state cannot drift silently

### 8. Federation hardening

- add trust expiry and renewal workflows
- preserve signed request metadata across peer actions
- make peer discovery and trust state visible to operators
- define safe behavior for revoked or degraded peers

### 9. Test and failure coverage

- add restart and recovery tests
- add policy denial and quarantine tests
- add exposure-to-routing integration tests
- add state migration and backward-compatibility tests

## Priority implementation order

### Phase A: must-have platform safety

1. Durable state backend
2. Guardian policy engine completion
3. Audit trail durability
4. Operator and service auth hardening

### Phase B: feature completeness

1. First real runtime adapter
2. Workload lifecycle transitions
3. Storage lifecycle and snapshots
4. Route health and edge admission policy

### Phase C: operational maturity

1. Alerts and health dashboards
2. Federation renewal and revocation flows
3. Backup and restore workflows
4. Ecosystem adapters for priority tools

## Repo-grounded subsystem assessment

| Subsystem | Current maturity | Main gap |
| --- | --- | --- |
| `src/control-plane/` | medium | no durable backing store or full lifecycle orchestration |
| `src/systems-api/` | medium to high | needs deeper auth, policy hooks, and stronger runtime integration |
| `src/federation/` | low to medium | trust lifecycle and signed enforcement need hardening |
| `src/observability/` | low | currently too shallow for production operations |
| `src/data-plane/` | low | abstractions exist, execution does not |
| `src/storage/` | low | metadata exists, lifecycle does not |
| `src/state.ts` | blocker | in-memory state is incompatible with production expectations |

## Immediate implementation focus

If the project focus is production readiness, the next implementation work should concentrate on:

1. replacing memory-backed platform state with a durable local-first state layer
2. completing Guardian approval, denial, suspension, and quarantine workflows
3. making observability durable and operator-visible
4. implementing a first real container runtime adapter for the data plane
5. adding real storage volume and snapshot lifecycle primitives

## Non-goals right now

Until the above is done, avoid spending the main effort on:

- more topology breadth without runtime integration follow-through
- cosmetic dashboard expansion without operational visibility behind it
- adding many new tool adapters before state, policy, and observability are durable
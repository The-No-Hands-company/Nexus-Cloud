# Nexus Systems Ecosystem Map

## Purpose

This document is the product-level inventory for the current Nexus Systems ecosystem as Nexus Cloud understands it today.

Use it for three things:

- keeping the Cloud topology graph aligned with reality
- separating live runtime registry state from broader ecosystem awareness
- making integration depth explicit so the hub can grow deliberately instead of pretending every tool is equally integrated already

## Organisation hierarchy

1. The No Hands Company
2. Nexus Systems ecosystem
3. Current ecosystem applications and protocol projects

## Current ecosystem inventory

| Project | Role in ecosystem | Current Cloud integration | Expected depth |
| --- | --- | --- | --- |
| Nexus Cloud | Central hub, control plane, topology source, exposure and routing authority | Native | Deep |
| Nexus | Privacy-first collaboration platform | Embedded module inside Cloud; consumes shared auth, policy, exposure, and topology | Deep |
| Nexus AI | Sovereign AI and tool-use runtime | Embedded shared intelligence module; consumed by multiple tools via Systems API contracts | Deep |
| Nexusclaw | Multi-agent orchestration framework | Embedded specialist orchestration module coordinated by Cloud and AI | Medium to deep |
| Nexus Computer | Personal AI cloud computer and edge runtime | Embedded edge/runtime module with Cloud-managed tasks and AI delegation | Deep |
| Nexus Deploy | Delivery, build, release, and rollback plane | Embedded deployment backend integrated into Cloud orchestration flows | Deep |
| Nexus Forge | Repository, issue, PR, and AI-dev platform | Embedded dev platform consuming Cloud topology + AI + Deploy | Deep |
| Nexus Hosting | Static hosting and federation runtime | Embedded runtime exposure module using Cloud addresses/domains + AI + Deploy | Deep |
| Nexus Network | Connectivity, tunnels, federation, peer routing | Foundational transport fabric for Cloud-managed reachability | Deep |
| Nexus Porter | Port, probe, and container intelligence tooling | Embedded operational utility for runtime visibility and diagnostics | Medium |
| Nexus Vault | Secrets, signing, and trust anchor | Core trust and secrets dependency for Cloud and connected tools | Deep |
| Nit | Lightweight UI/runtime shell | Embedded fast-surface runtime for Cloud-attached product surfaces | Medium |
| Phantom | Protocol-level safety, privacy, and anti-surveillance layer for all ecosystem traffic | Hybrid protocol overlay consumed by every app/network path; not treated as a regular app module | Deep (cross-cutting) |

## Integration rule

Nexus Cloud should model the ecosystem in two layers:

- Live registry layer: what is actually registered, routable, exposed, and heartbeat-aware right now
- Ecosystem topology layer: what belongs to the ecosystem and how Cloud intends to relate to it even if the service is not currently active

## Working interpretation

"Embedded" means the capability is effectively part of the Cloud control surface.

"Protocol layer" means a cross-cutting cryptographic and transport hardening plane that secures ecosystem traffic paths but is not modeled as a standalone product surface.

"Hybrid" means the project remains standalone but shares meaningful contracts, control-plane decisions, or operator surfaces with Cloud. This mode is still supported for future ecosystem expansions outside the current app set.

"Referenced" means the project is in the ecosystem map and should appear in discovery and architecture context, but its runtime coupling to Cloud is still intentionally shallow. Current core app modules are no longer in this mode.

## Current embedding policy

For the current app set under `apps/`, Nexus Cloud treats each project as an embedded ecosystem module. Standalone execution remains available through each project's own compose or dev runtime, but orchestration truth is represented by Cloud topology and Systems API contracts.

## Nexus AI cross-tool mesh

Nexus AI is a shared runtime consumed directly by:

- Nexus Cloud (embedded intelligence surface)
- Nexus (assistant and moderation workflows)
- Nexus Computer (agent execution and remote assistance)
- Nexus Forge (review, generation, and automation)
- Nexus Deploy (pipeline suggestions and remediation)
- Nexus Hosting (diagnostics and operator assistance)
- Nexusclaw (delegated multi-agent choreography)
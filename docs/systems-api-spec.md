# Nexus Systems API Spec

## Purpose

The Nexus Systems API is the canonical platform API for Nexus Cloud. It provides a normalized interface for clients, tools, agents, and external integrations to discover capabilities, inspect status, request public exposure, and trigger safe platform actions.

## Design goals

- One stable contract for the ecosystem
- Privacy-first by default
- Explicit versioning
- Thin clients, strong server-side validation
- Compatible with standalone mode and orchestrated mode

## Core v1 scope

The first version should focus on three platform primitives:

- `GET /api/v1/tools`
- `GET /api/v1/status`
- `POST /api/v1/public-url`

These endpoints are backed by a tool registry and status model that can be shared across standalone tools and orchestrated services.

## Tool registry model

Each tool entry should capture:

- stable tool identity
- display name and description
- exposure state
- operating mode (`standalone` or `orchestrated`)
- health state
- capability tags
- optional public URL
- timestamps for registration and last update

## Status model

The status endpoint should return a normalized summary including:

- API version
- runtime mode
- total tool count
- exposed tool count
- healthy tool count
- public URL count
- last update timestamp

## Public URL model

Public URL issuance should:

- resolve a tool by ID
- create or refresh an exposure record
- return the canonical URL and expiration window
- keep the endpoint safe for future orchestration and edge integration

## Authentication

### User-facing requests

Use bearer token auth for authenticated client requests.

### Service-to-service requests

Use signed internal requests when tools or peers call through Nexus Cloud on behalf of another service.

### Federation requests

Federated peers must use signed requests and explicit trust relationships.

## Error format

Errors should return JSON in this shape:

```json
{
  "error": "human readable message"
}
```

Implementations may add a `details` object for validation errors when needed.

## Runtime model

The Systems API should live inside Nexus Cloud first, backed by a shared registry/service layer, then later be extracted into a shared SDK for standalone tools.

## Non-goals for v1

- GraphQL
- arbitrary cross-tool CRUD
- hidden telemetry
- implicit background mutations
- vendor-specific auth flows

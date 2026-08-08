# Nexus Cloud Home Screen Spec

## Objective

Define a concrete, app-first Home experience for Nexus Cloud that presents the ecosystem as a unified operating surface while keeping operator controls accessible but secondary.

## Home Information Architecture

The Home screen must use these exact section names and ordering:

1. Continue
2. Pinned
3. Quick Actions
4. Recommended Workflows
5. Ecosystem Apps
6. Live Ecosystem Pulse
7. Control Plane

Layout order is preset-driven:
- `builder`: workflow and app-launch first
- `operator`: control-plane and pulse first

## Section Definitions

### 1) Continue

Purpose: fast re-entry for previously used apps.

Data source:
- Local: `nc_last_used_apps` (browser localStorage)
- Fallback: empty state prompt

Behavior:
- Show up to 6 most recently used apps
- Sort by most recent descending
- Clicking an item opens the app directly

Empty state text:
- Title: `No recent apps yet.`
- Subtitle: `Open any app from Ecosystem Apps to populate this section.`

### 2) Quick Actions

Purpose: task-first filtering and jump points.

Actions:
- `All Apps`
- `Personal`
- `Build`
- `Runtime`
- `Trust`
- `Cloud Health`

Behavior:
- Category buttons filter Ecosystem Apps immediately
- `Cloud Health` opens Dashboard view directly
- Search box filters Ecosystem Apps by name, description, and category in real time

### 3) Pinned

Purpose: persistent one-click launcher for personally important apps.

Data source:
- Local: `nc_pinned_apps` (browser localStorage)

Behavior:
- User can pin/unpin from Ecosystem App cards
- Pinned section renders only pinned apps, preserving app launch rules
- Pinned cards support drag-and-drop reordering
- Order persists locally per logged-in user profile
- Pinned cards include keyboard-focusable `Move Left` and `Move Right` controls
- Reorder controls are boundary-aware (first card cannot move left, last card cannot move right)

### 4) Recommended Workflows

Purpose: guide users into high-value ecosystem flows, not just app launching.

Initial workflow cards:
- Build New Feature
- Run AI Workflow
- Publish Service

Behavior:
- Each card deep-links into a primary app for that workflow

### Home Presets

Purpose: adapt Home information hierarchy to user intent.

Modes:
- `Builder Mode`
- `Operator Mode`

Behavior:
- Preset selection is saved per user
- Preset updates section order immediately without reload
- Preset state is visible via active toggle in Quick Actions

### 5) Ecosystem Apps

Purpose: canonical ecosystem launcher grid.

Categories:
- `personal`
- `build`
- `runtime`
- `trust`
- `core`

Initial app inventory:
- Nexus
- Nexus AI
- Nexus Computer
- Nit
- Nexus Forge
- Nexus Deploy
- Nexus Hosting
- Nexus Network
- Nexus Vault
- Phantom
- Nexus Cloud
- Nexusclaw

Card behavior:
- If app has registered upstream in tool registry and healthy/degraded: open embedded frame
- If app exists but is offline: show offline modal
- If app is cataloged but unregistered: route to Tools view
- For Nexus Cloud app: route to Dashboard view

### 6) Live Ecosystem Pulse

Purpose: high-signal status strip + recent operational events.

Contents:
- Metric chips/cards:
  - `Apps Registered`
  - `Healthy`
  - `Peers`
  - `Users`
- Recent Events feed:
  - up to 4 latest trust/audit events
  - fields: action, actor, time-ago

Data sources:
- `/api/v1/status`
- `/api/v1/audit?eventType=node-trust-action&kind=audit&limit=6`

### 7) Control Plane

Purpose: expose operator surfaces without dominating primary app launcher.

Cards:
- Dashboard
- Federation
- Identity

Behavior:
- Direct internal navigation

## App Card Contract

All cards in Continue and Ecosystem Apps follow this field contract.

Required fields:
- `id`: stable app identifier
- `name`: display name
- `category`: taxonomy bucket
- `description`: one-line product value
- `icon`: visual symbol
- `status`: one of `healthy|degraded|offline|unknown|cataloged`
- `lastUsedAt`: optional timestamp for Continue cards
- `pinned`: derived from user-local pin state

Computed/runtime fields:
- `launchTarget`: `iframe|internal-view|tools-fallback|offline-modal`
- `upstreamUrl`: when available from registry
- `integrationDepth`: optional descriptor (`Deep`, `Medium`, `Core`)

Visual footer fields:
- left: status dot
- center: status label
- right: category label (uppercased)
- trailing action: pin toggle button (`☆`/`★`)

## Click-Flow Map

### First-time User Flow

1. User signs in.
2. Home loads with empty Continue.
3. User clicks a Quick Action category.
4. Ecosystem Apps grid filters instantly.
5. User clicks an app card.
6. Decision:
- Registered + reachable: open app (embedded frame).
- Registered but offline: show offline modal with explanation.
- Cataloged only: navigate to Tools view so user can register/connect service.
7. On successful open, app id + timestamp written to `nc_last_used_apps`.
8. Next Home visit shows app under Continue.

### Returning User Flow

1. User signs in.
2. Home loads and reads `nc_last_used_apps`.
3. Continue section renders up to 6 recent apps.
4. User clicks Continue card.
5. Decision:
- If service healthy/degraded now: open directly.
- If service unavailable: offline modal or Tools fallback.
6. Live Ecosystem Pulse updates current health and recent trust events.

## Success Criteria

- Home defaults to app-first navigation with ecosystem framing.
- Operator controls remain one click away in Control Plane.
- First-time users are guided to viable actions without dead ends.
- Returning users can re-enter prior apps in one click.
- Pulse gives at-a-glance platform confidence without leaving Home.

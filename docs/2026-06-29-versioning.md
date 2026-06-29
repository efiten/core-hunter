# 2026-06-29 — Versioning and release automation

## Context

The project now has two contributors splitting by component: backend (`server/`, Go MQTT
ingestor) and frontend (`app/`, the PWA). The two components ship as separate Docker images on
independent deploy cadences. We need versioning that lets each side cut releases without dragging
the other along.

## Decision

**Independent, per-component semantic versions, produced automatically from conventional commits.**

- **Scope:** each component versions on its own. Tags are component-prefixed in the monorepo:
  `app-vX.Y.Z` and `server-vX.Y.Z`. A backend fix never forces an app version bump, and vice versa.
- **Mechanism:** [release-please](https://github.com/googleapis/release-please). On every push to
  `master` it scans conventional commits per path and opens a "release PR" per component that bumps
  the version and writes the changelog; merging that PR creates the tag. This builds directly on the
  `app:` / `server:`-scoped conventional commits already mandated by AGENTS.md §6.
- **Baseline:** both components start at `0.1.0` (pre-field-test, pre-1.0). `bootstrap-sha` is pinned
  to the master commit at setup time so release-please does not re-changelog historical commits.

## Source of truth and surfacing

| Component | Version source | Surfaced at |
|---|---|---|
| app | `app/package.json` (`version`) → `__APP_VERSION__` via Vite `define` | Settings sheet footer |
| server | `server/internal/version/version.go` (`Version` const, kept in sync by release-please) | startup log + `/healthz` JSON (`{"status","version"}`) |

## Configuration

- `release-please-config.json` — two packages: `app` (`node`), `server` (`go`, with
  `internal/version/version.go` as an `extra-files` target updated via the `x-release-please-version`
  annotation). `include-component-in-tag: true`, `separator: "-"`.
- `.release-please-manifest.json` — current versions per component.
- `.github/workflows/release-please.yml` — runs `googleapis/release-please-action@v4` on push to
  `master` (`contents: write`, `pull-requests: write`).

## How to cut a release

1. Land conventional commits on `master` (e.g. `feat(app): …`, `fix(server): …`).
2. release-please opens/updates a release PR for each affected component.
3. Review and merge the release PR → the `app-vX.Y.Z` / `server-vX.Y.Z` tag is created and the
   version files are bumped on `master`.
4. Build/deploy the Docker image for that component from the tag.

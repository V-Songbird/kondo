# Changelog

All notable changes to kondo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and kondo adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Engineering scaffold: README, ADRs, domain map, foundations, testing and
  release policies, agent operating manual.
- Read-only core: cross-platform store discovery and scanning of sessions,
  skills, plugins, hooks, and settings across the Claude Code user store,
  per-project `.claude` directories, and the Claude desktop app store.
- Electron shell with a context-isolated, typed preload bridge; the renderer
  has no filesystem access.
- Four jig guards enforcing renderer purity, the no-network promise, ids
  across the seam, and tests never touching a real store — blocking in CI via
  `npm run guards`.

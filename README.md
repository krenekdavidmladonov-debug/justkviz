# JustKvíz

Quiz authoring, team registrations, trusted scoring, projector presentation and printable materials.

## Local development

Use Node.js22, the pinned pnpm version and JDK21 for Firebase emulators. Install with pnpm install --frozen-lockfile, then run pnpm check and pnpm test:unit. Integration and Rules tests require explicitly configured demo-* Firebase emulators on loopback endpoints. Browser tests additionally require Playwright Chromium; PDF checks use Python/pypdf and Poppler. No production credentials or live data are required.

See [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [security](docs/SECURITY.md), [event management](docs/EVENT_MANAGEMENT.md) and [print center](docs/PRINT_CENTER.md) for the product contracts. Source/test preparation does not authorize a public push, merge or cloud deployment. Historical release notes are not current authorization.

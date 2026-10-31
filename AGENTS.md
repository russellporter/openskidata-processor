# OpenSkiData Processor Guidelines

## Docker Development Environment

This project runs in a containerized environment. All commands should be executed within the Docker container.

### Setup

- Start development environment: `docker compose up -d`
- Access container shell: `docker compose exec app bash`

### Build & Test Commands (run inside container)

- Build: `docker compose exec app npm run build`
- Format code: `docker compose exec app npm run format`
- Test all: `docker compose exec app npm test`
- Test single file: `docker compose exec app npx vitest run path/to/file.test.ts`
- Type check: `docker compose exec app npm run check-types`
- Update test snapshots: `docker compose exec app npm run record-tests`
- Install/change dependencies: `docker compose exec app npm install <pkg>` — **never on the
  host**. docker-compose bind-mounts the repo, so `node_modules` is shared; a host install
  replaces the Linux native binaries (better-sqlite3, sharp) with macOS ones.
- Run processor: `docker compose exec app ./run.sh`
- Processing scripts:
  - `docker compose exec app npm run download`
  - `docker compose exec app npm run prepare-geojson`

Run processing with a small BBOX for testing:

```bash
BBOX=[132.34,34.78,132.40,34.84]
```

Use a larger BBOX to test performance implications of a change:
`docker compose exec app bash -c "BBOX=[-125,49,-115,52] ./run.sh`

## Rust workspace (`rust/`)

A Cargo workspace in `rust/` is replacing `src/` stage by stage. Both pipelines coexist
until the port completes: the TypeScript one stays runnable as the golden-master oracle.
See `rust/README.md`.

- Check: `docker compose exec app sh -c "cd rust && cargo check --workspace"`
- Test: `docker compose exec app sh -c "cd rust && cargo test --workspace"`
- Format: `docker compose exec app sh -c "cd rust && cargo fmt --all"`
- Regenerate the generated format files after an `openskidata-format` bump:
  `docker compose exec app node rust/codegen/generate-format-enums.mjs` and
  `docker compose exec app node rust/codegen/generate-format-vectors.mjs`

`rust/crates/openskidata-format/src/generated/enums.rs` is generated and checked in — do
not edit it by hand. Its enum strings are the public wire contract, so they are derived
from the npm package rather than hand-typed. CI fails if it is stale.

Crate-level module docs carry the reasoning for the non-obvious design decisions
(especially in `osd-cluster` and `osd-normalize`). Read them before changing those
algorithms; several look like they can be simplified and cannot.

## Code Style & Conventions

- TypeScript with strict mode enabled
- Don't use `any` type. Be explicit with types.
- Interfaces with explicit typing for all data structures
- PascalCase for classes/interfaces, camelCase for functions/variables
- Test files named with patterns: `.unit.test.ts` or `.int.test.ts`
- Stream-based data processing with functional programming patterns
- Async/await for Promise-based operations
- Comprehensive test coverage for both unit and integration
- Uses Prettier for code formatting
- Tests run on Vitest with `globals: true`, serially (`fileParallelism: false`) because
  every test file shares the single `openskidata_test` database
- Heavy use of type annotations and generics for null-safety

# OpenSkiData Processor Guidelines

## Docker Development Environment

This project runs in a containerized environment. All commands should be executed within the Docker container.

### Setup

- Start development environment: `docker compose up -d`
- Access container shell: `docker compose exec app bash`

### Build & Test Commands (run inside container)

- Build: `docker compose exec app npm run build`
- Test all: `docker compose exec app npm test`
- Test single file: `docker compose exec app npx jest path/to/file.test.ts`
- Type check: `docker compose exec app npm run check-types`
- Update test snapshots: `docker compose exec app npm run record-tests`
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
- Heavy use of type annotations and generics for null-safety

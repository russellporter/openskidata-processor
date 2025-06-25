# OpenSkiData Processor Guidelines

## Docker Development Environment

This project runs in a containerized environment. All commands should be executed within the Docker container.

### Setup
- Start development environment: `docker compose up -d`
- Access container shell: `docker compose exec app bash`

### Build & Test Commands (run inside container)

- Build: `npm run build`
- Test all: `npm test`
- Test single file: `npx jest path/to/file.test.ts`
- Type check: `npm run check-types`
- Update test snapshots: `npm run record-tests`
- Run processor: `./run.sh`
- Processing scripts:
  - `npm run download`
  - `npm run prepare-geojson`

### Quick Docker Commands
- Run tests: `docker compose exec app npm test`
- Type check: `docker compose exec app npm run check-types`
- Build: `docker compose exec app npm run build`

Run processing with a small BBOX for testing:

```bash
BBOX=[132.34,34.78,132.40,34.84]
```

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

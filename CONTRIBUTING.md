# Contributing to Patch

Thanks for helping Patch grow.

## Contributor License Agreement

Patch is licensed under AGPL-3.0. To keep the option of relicensing in the future (for example to Apache-2.0), every contribution must be covered by a Contributor License Agreement (CLA). The CLA lets you keep the copyright to your work while granting the Patch maintainers the right to distribute it under other open source licenses.

When you open your first pull request, a bot will ask you to sign the CLA. Pull requests cannot be merged until it is signed.

## Development workflow

1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version: all business logic lives in `src/core`, and the REST API (and later MCP) only call into it.
2. Make your change, with tests in `test/`.
3. Run `pnpm typecheck` and `pnpm test`.
4. If you changed `src/db/schema.ts`, run `pnpm db:generate` and commit the generated migration.

## Ground rules for core services

- Every query on tenant data filters by `ctx.orgId`.
- Any id that comes from a client and points at another record goes through `assertInOrg` before it is stored.
- Every create, update and delete writes an audit event in the same transaction.

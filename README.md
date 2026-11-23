# Patch

Patch is an open source, lightweight catalog of the systems your business runs on. Like a garden patch, it is where your organization's tools, owners and use cases live and grow.

- **Systems**: every tool and application, with lifecycle, criticality and vendor
- **Owners**: business owners, technical owners, admins and champions. Anyone can be named before they join Patch; each person shows whether they're in Patch, invited, or not yet, and is linked automatically when they join with the same email
- **Use cases**: what the business actually uses each system for
- **Artifacts**: flows, apps, forms and agents built on platforms like Power Automate, Appian and Nintex, with direct links back to them
- **AI governance**: team members request AI tools, features and agents; your AI council reviews them through ordered stages chosen by risk tier; approved tools land in an AI inventory with capability rulings, usage and team adoption
- **Activity log**: every change, who made it, and when
- **Dark mode**: follows the system setting, or pick light or dark from the header
- **REST API** with personal API tokens

It is meant as a simple alternative to heavyweight enterprise architecture tools, easy enough for IT and business teams to keep up to date.

Coming next: an MCP server so assistants like Claude and Microsoft Copilot can query Patch, SSO, and license tracking. See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Self-hosting

You need Docker.

```bash
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export POSTGRES_PASSWORD=$(openssl rand -hex 24)
docker compose up -d
```

Open http://localhost:3000, create an account and name your organization. To stop strangers from registering after your team has signed up, set `PATCH_ALLOW_SIGNUP=false` and restart.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | | Postgres connection string |
| `BETTER_AUTH_SECRET` | | Session signing secret, at least 32 characters |
| `PATCH_BASE_URL` | `http://localhost:3000` | Public URL of the app |
| `PATCH_ALLOW_SIGNUP` | `true` | Allow new accounts |
| `PATCH_AUTO_MIGRATE` | `true` | Apply database migrations on startup |
| `PORT` | `3000` (`8080` in the image) | HTTP port |

## Development

Requires Node 22.18+ (the server runs TypeScript directly, no build step), pnpm and Postgres 16.

```bash
pnpm install
cp .env.example .env   # point DATABASE_URL at your local Postgres
pnpm dev               # API on :3000 (applies migrations)
pnpm dev:web           # UI with hot reload on :5173
```

| Command | What it does |
|---|---|
| `pnpm test` | Integration tests against a real Postgres (`TEST_DATABASE_URL`, default `patch_test`) |
| `pnpm typecheck` | TypeScript checks |
| `pnpm db:generate` | Create a migration after editing `src/db/schema.ts` |
| `pnpm build` | Build the web UI into `dist/web` |

## API

All endpoints live under `/api/v1` and accept either a browser session or `Authorization: Bearer <token>`. Create tokens under Settings.

```bash
curl -H "Authorization: Bearer $PATCH_TOKEN" https://your-patch/api/v1/systems
```

Resources: `systems` (plus `systems/:id/owners`), `use-cases`, `artifacts`, `people`, `teams`, `search?q=`, `activity`, `tokens`.

## License

[AGPL-3.0](LICENSE). Contributions require agreeing to the CLA described in [CONTRIBUTING.md](CONTRIBUTING.md).

# Operating the hosted Patch on Fly.io

| Fly app | What | Size |
|---|---|---|
| `palouse-patch` | Web app and API. Public at https://patch.palouse.ai (also https://palouse-patch.fly.dev) | shared-cpu-1x, 256MB, auto stop and start |
| `palouse-patch-db` | Postgres 16 (`postgres:16-alpine`), private only at `palouse-patch-db.internal:5432` | shared-cpu-1x, 256MB, 1GB volume `pg_data` |

Both live in the `palouse-patch` organization in region `sjc`.

## Secrets

| App | Secret |
|---|---|
| `palouse-patch` | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY` |
| `palouse-patch-db` | `POSTGRES_PASSWORD` |

Rotating `BETTER_AUTH_SECRET` signs everyone out. Rotating the database password means changing it in Postgres (`ALTER USER patch PASSWORD '...'`) and then updating both secrets.

## Domain and email

`patch.palouse.ai` is an A/AAAA record (DNS at Namecheap) pointing at the app's Fly IPs, with a Let's Encrypt certificate managed by Fly (`fly certs show patch.palouse.ai`). `PATCH_BASE_URL` in `fly.toml` must match the domain users visit, because Better Auth rejects sign-ins from other origins; signing in via `palouse-patch.fly.dev` will not work.

Email (password resets, organization invitations) goes through Resend, sending as `MAIL_FROM` (`patch@palouse.ai`). The `palouse.ai` domain is verified in Resend with DKIM at `resend._domainkey.palouse.ai` and SPF/MX on `send.palouse.ai`. Without `RESEND_API_KEY` the app logs emails instead of sending them, so `fly logs` shows the links. Failed sends are logged as `[mail] Resend rejected email`.

## Deploying

From the repository root:

```bash
fly deploy
```

Fly builds the Dockerfile on a remote builder and replaces the machine. Migrations run on startup.

To build locally instead (for example behind a TLS-inspecting proxy), build the image yourself, push it, and deploy by tag:

```bash
fly auth docker
docker build -t registry.fly.io/palouse-patch:$(git rev-parse --short HEAD) .
docker push registry.fly.io/palouse-patch:$(git rev-parse --short HEAD)
fly deploy --image registry.fly.io/palouse-patch:$(git rev-parse --short HEAD)
```

The database app rarely changes. To apply changes to `deploy/fly/db/fly.toml`:

```bash
cd deploy/fly/db && fly deploy
```

## Backups

Because the database is self-managed, backups are our job.

1. **Volume snapshots (automatic).** Fly snapshots the `pg_data` volume daily and keeps them for 5 days by default. List them with `fly volumes snapshots list <volume-id> -a palouse-patch-db`.
2. **Logical dumps (manual for now).** Take one before risky changes:

   ```bash
   fly ssh console -a palouse-patch-db -C "pg_dump -U patch -Fc patch" > patch-$(date +%F).dump
   ```

   Planned: a scheduled machine that runs `pg_dump` nightly to Tigris object storage.

## Restoring

From a dump:

```bash
fly proxy 15432:5432 -a palouse-patch-db
pg_restore --clean --if-exists -d postgres://patch:<password>@localhost:15432/patch patch-YYYY-MM-DD.dump
```

From a volume snapshot: create a new volume from the snapshot (`fly volumes create pg_data --snapshot-id <id> -a palouse-patch-db -r sjc`), then destroy the old machine and volume so the new one is attached on the next deploy.

## Useful commands

```bash
fly status -a palouse-patch
fly logs -a palouse-patch
fly ssh console -a palouse-patch-db -C "psql -U patch patch"
```

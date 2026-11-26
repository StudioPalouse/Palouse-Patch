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

Rotating `BETTER_AUTH_SECRET` signs everyone out, and also disconnects every MCP client connected by OAuth: the token signing keys in the `jwks` table are encrypted with it, so delete those rows after a rotation and new keys are made on the next sign-in. Rotating the database password means changing it in Postgres (`ALTER USER patch PASSWORD '...'`) and then updating both secrets.

## Domain and email

`patch.palouse.ai` is an A/AAAA record (DNS at Namecheap) pointing at the app's Fly IPs, with a Let's Encrypt certificate managed by Fly (`fly certs show patch.palouse.ai`). `PATCH_BASE_URL` in `fly.toml` must match the domain users visit, because Better Auth rejects sign-ins from other origins; signing in via `palouse-patch.fly.dev` will not work.

Email (password resets, organization invitations) goes through Resend, sending as `MAIL_FROM` (`patch@palouse.ai`). The `palouse.ai` domain is verified in Resend with DKIM at `resend._domainkey.palouse.ai` and SPF/MX on `send.palouse.ai`. Without `RESEND_API_KEY` the app logs emails instead of sending them, so `fly logs` shows the links. Failed sends are logged as `[mail] Resend rejected email`.

## Sign-up policy

`PATCH_REQUIRE_WORK_EMAIL=true` (in `fly.toml`) refuses sign-ups from personal email providers; the list lives in `src/shared/email-domains.ts` and covers subdomains. Add more with `PATCH_BLOCKED_EMAIL_DOMAINS=example.com,other.net` (`fly secrets set` or `[env]`). Anyone with a pending, unexpired invitation can sign up from any address, so admins can still bring in contractors on personal email. `PATCH_ALLOW_SIGNUP=false` closes sign-ups entirely.

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

Because the database is self-managed, backups are our job. There are three layers:

1. **Nightly logical dumps (automatic).** A scheduled machine in the `palouse-patch-backup` app runs [`deploy/fly/backup/backup.sh`](../deploy/fly/backup/backup.sh) once a day. It:
   - runs `pg_dump` (custom format) over the private network as the read-only `patch_backup` role,
   - **restores the dump into a throwaway local Postgres and checks it** (tables restored, migrations recorded), so every stored dump is known to restore,
   - uploads it to the private Tigris bucket `palouse-patch-backups` as `patch/patch-<UTC timestamp>.dump`,
   - prunes old dumps, keeping 30 days of dailies and a year of the dumps taken on the 1st of each month (`KEEP_DAILY_DAYS`, `KEEP_MONTHLY_DAYS`).

   Nothing is uploaded if any step fails. A failed run emails `ALERT_EMAIL` the log tail through Resend. Check recent runs with `fly logs -a palouse-patch-backup`.
2. **Volume snapshots (automatic).** Fly snapshots the `pg_data` volume daily and keeps them for 5 days by default. List them with `fly volumes snapshots list <volume-id> -a palouse-patch-db`.
3. **Manual dumps.** Take one before risky changes:

   ```bash
   fly ssh console -a palouse-patch-db -C "pg_dump -U patch -Fc patch" > patch-$(date +%F).dump
   ```

### Setting up the nightly backup

One time, from the repository root:

```bash
# 1. The app (no services, no always-on machines) and its private bucket.
#    `fly storage create` sets AWS_* and BUCKET_NAME as secrets on the app.
fly apps create palouse-patch-backup -o palouse-patch
fly storage create -a palouse-patch-backup -n palouse-patch-backups

# 2. A read-only database role for backups, so the job never holds the app's password.
BACKUP_PW=$(openssl rand -hex 24)
fly ssh console -a palouse-patch-db -C "psql -U patch patch -c \"create role patch_backup login password '$BACKUP_PW' in role pg_read_all_data\""
fly secrets set -a palouse-patch-backup --stage \
  DATABASE_URL="postgres://patch_backup:$BACKUP_PW@palouse-patch-db.internal:5432/patch" \
  RESEND_API_KEY="<same key as the app>" \
  ALERT_EMAIL="<who should hear about failed backups>"

# 3. Build the image and create the scheduled machine.
cd deploy/fly/backup
fly deploy --build-only --push --image-label latest
fly machine run registry.fly.io/palouse-patch-backup:latest -a palouse-patch-backup \
  --region sjc --vm-memory 512 --schedule daily --restart no
```

Then run it once by hand and read the log: `fly machine start <machine-id> -a palouse-patch-backup` and `fly logs -a palouse-patch-backup`. Look for `restore check: ok` and `done`.

To change the script later, rebuild and point the machine at the new image:

```bash
cd deploy/fly/backup
fly deploy --build-only --push --image-label latest
fly machine update <machine-id> -a palouse-patch-backup --image registry.fly.io/palouse-patch-backup:latest --schedule daily
```

To test changes locally, build the image and run it against any Postgres 16 and an S3-compatible store, passing `DATABASE_URL`, `BUCKET_NAME` and the `AWS_*` variables with `-e`.

## Restoring

From a nightly dump: download it from the bucket (`fly storage dashboard palouse-patch-backups` opens the Tigris console; or use `aws s3 ls s3://palouse-patch-backups/patch/` with the bucket credentials), then restore it as below. Every nightly dump has already been restored once by the backup job.

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

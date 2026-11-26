# Nightly backup job for the Patch database. Same Postgres major version as
# the database (pg_dump must not be older than the server), plus the tools to
# upload to object storage and send failure alerts.
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli curl jq
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
# initdb (for the restore check) refuses to run as root.
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]

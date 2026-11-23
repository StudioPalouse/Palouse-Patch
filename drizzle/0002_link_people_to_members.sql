-- Link existing members to the person with the same email in their org.
UPDATE "people" p SET "user_id" = u."id"
FROM "member" m JOIN "user" u ON u."id" = m."user_id"
WHERE p."user_id" IS NULL
  AND p."organization_id" = m."organization_id"
  AND p."email" = lower(u."email")
  AND NOT EXISTS (SELECT 1 FROM "people" x WHERE x."organization_id" = m."organization_id" AND x."user_id" = u."id");
--> statement-breakpoint
-- Add any member who has no person record yet to the directory.
INSERT INTO "people" ("id", "organization_id", "name", "email", "user_id")
SELECT gen_random_uuid()::text, m."organization_id", u."name", lower(u."email"), u."id"
FROM "member" m JOIN "user" u ON u."id" = m."user_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "people" p
  WHERE p."organization_id" = m."organization_id" AND (p."user_id" = u."id" OR p."email" = lower(u."email"))
);

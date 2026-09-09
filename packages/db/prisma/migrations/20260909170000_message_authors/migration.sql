ALTER TABLE "messages" ADD COLUMN "authorUserId" TEXT;

-- Ordinary prompts retain their authenticated sender on the run they created.
UPDATE "messages" AS message
SET "authorUserId" = attribution."userId"
FROM (
  SELECT DISTINCT ON ("sourceMessageId") "sourceMessageId", "userId"
  FROM "runs"
  WHERE "sourceMessageId" IS NOT NULL
    AND "trigger" IN ('user', 'follow_up')
  ORDER BY "sourceMessageId", "createdAt" ASC, "id" ASC
) AS attribution
WHERE message.id = attribution."sourceMessageId"
  AND message.role = 'user';

-- Prompts sent while an agent was already running retain their sender on the steering row.
UPDATE "messages" AS message
SET "authorUserId" = attribution."userId"
FROM (
  SELECT DISTINCT ON (steering."messageId") steering."messageId", steering."userId"
  FROM "steering_messages" AS steering
  JOIN "runs" AS run ON run.id = steering."runId"
  WHERE run."trigger" IN ('user', 'follow_up')
  ORDER BY steering."messageId", steering."createdAt" ASC, steering.id ASC
) AS attribution
WHERE message.id = attribution."messageId"
  AND message.role = 'user'
  AND message."authorUserId" IS NULL;

CREATE INDEX "messages_authorUserId_idx" ON "messages"("authorUserId");

ALTER TABLE "messages"
ADD CONSTRAINT "messages_authorUserId_fkey"
FOREIGN KEY ("authorUserId") REFERENCES "user"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

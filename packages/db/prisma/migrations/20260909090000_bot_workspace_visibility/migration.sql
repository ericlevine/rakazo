ALTER TABLE "bots" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

ALTER TABLE "bots"
ADD CONSTRAINT "bots_visibility_check"
CHECK ("visibility" IN ('private', 'workspace'));

CREATE INDEX "bots_spaceId_visibility_archivedAt_pinned_updatedAt_idx"
ON "bots"("spaceId", "visibility", "archivedAt", "pinned", "updatedAt");

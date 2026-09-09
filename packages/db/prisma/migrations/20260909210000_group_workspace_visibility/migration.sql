ALTER TABLE "chat_groups"
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

CREATE INDEX "chat_groups_spaceId_visibility_archivedAt_pinned_updatedAt_idx"
ON "chat_groups"("spaceId", "visibility", "archivedAt", "pinned", "updatedAt");

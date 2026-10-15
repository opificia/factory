-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "pr_state" TEXT;

-- Pull requests opened before this migration start as open; the poller then
-- records whether they were merged or closed.
UPDATE "runs" SET "pr_state" = 'open' WHERE "state" = 'pr_opened';

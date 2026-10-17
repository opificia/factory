-- The sandbox cap counts the sessions whose sandbox is not gone yet
-- (ended_at IS NULL) under a lock, on every admission.

-- CreateIndex
CREATE INDEX "sandbox_sessions_ended_at_idx" ON "sandbox_sessions"("ended_at");

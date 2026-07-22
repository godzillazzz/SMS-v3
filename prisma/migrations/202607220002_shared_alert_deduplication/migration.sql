CREATE TABLE "alert_deduplication_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_category" VARCHAR(64) NOT NULL,
    "dedup_key_hash" VARCHAR(64) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "last_occurrence_at" TIMESTAMP(3) NOT NULL,
    "delivery_status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "last_delivery_attempt_at" TIMESTAMP(3),
    "cooldown_until" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_deduplication_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "alert_deduplication_states_delivery_status_check"
      CHECK ("delivery_status" IN ('pending', 'suppressed', 'delivered', 'failed'))
);

CREATE UNIQUE INDEX "alert_deduplication_states_event_hash_window_key"
ON "alert_deduplication_states"("event_category", "dedup_key_hash", "window_start");

CREATE INDEX "alert_deduplication_states_expires_at_idx"
ON "alert_deduplication_states"("expires_at");

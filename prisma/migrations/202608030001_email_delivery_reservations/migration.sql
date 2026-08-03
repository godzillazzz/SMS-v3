CREATE TABLE "email_delivery_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_key" VARCHAR(255) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "retry_after" TIMESTAMP(3),
    "last_error_category" VARCHAR(64),
    "last_error_safe" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_delivery_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_delivery_reservations_status_check"
      CHECK ("status" IN ('RESERVED', 'SENT', 'FAILED'))
);

CREATE UNIQUE INDEX "email_delivery_reservations_event_key_key"
ON "email_delivery_reservations"("event_key");

CREATE INDEX "email_delivery_reservations_status_retry_after_idx"
ON "email_delivery_reservations"("status", "retry_after");

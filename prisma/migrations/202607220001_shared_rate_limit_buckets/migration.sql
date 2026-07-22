CREATE TABLE "rate_limit_buckets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope" VARCHAR(50) NOT NULL,
  "key_hash" VARCHAR(64) NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limit_buckets_scope_key_hash_window_start_key"
  ON "rate_limit_buckets"("scope", "key_hash", "window_start");

CREATE INDEX "rate_limit_buckets_expires_at_idx"
  ON "rate_limit_buckets"("expires_at");

CREATE TABLE "leave_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "leave_request_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "content" BYTEA NOT NULL,
  "uploaded_by_legacy_ref" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_attachments_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "leave_attachments_leave_request_id_key" ON "leave_attachments"("leave_request_id");
CREATE INDEX "leave_attachments_created_at_idx" ON "leave_attachments"("created_at");

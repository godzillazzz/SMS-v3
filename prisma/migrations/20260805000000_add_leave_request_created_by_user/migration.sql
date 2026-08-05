-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN "created_by_user_id" UUID;

-- CreateIndex
CREATE INDEX "leave_requests_created_by_user_id_idx" ON "leave_requests"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

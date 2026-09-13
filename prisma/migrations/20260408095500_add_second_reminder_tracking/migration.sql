-- AlterTable
ALTER TABLE "DeviceDose"
ADD COLUMN "lastReminderAt" TIMESTAMP(3),
ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;

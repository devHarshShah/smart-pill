-- CreateTable
CREATE TABLE "DeviceDose" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pillName" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "requiredPills" INTEGER NOT NULL DEFAULT 1,
    "alertTriggeredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "takenPills" INTEGER,
    "overdoseDetected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceDose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceDose_deviceId_scheduledAt_idx" ON "DeviceDose"("deviceId", "scheduledAt");

-- CreateIndex
CREATE INDEX "DeviceDose_deviceId_completedAt_idx" ON "DeviceDose"("deviceId", "completedAt");

-- AddForeignKey
ALTER TABLE "DeviceDose" ADD CONSTRAINT "DeviceDose_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

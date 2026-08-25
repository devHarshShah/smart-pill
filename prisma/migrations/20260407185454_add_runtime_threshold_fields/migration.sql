-- AlterTable
ALTER TABLE "DeviceRuntimeStatus" ADD COLUMN     "confirmReads" INTEGER,
ADD COLUMN     "detectedPills" INTEGER,
ADD COLUMN     "pillWeight" DOUBLE PRECISION,
ADD COLUMN     "setupMismatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "threshold" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceEvent_deviceId_createdAt_idx" ON "DeviceEvent"("deviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

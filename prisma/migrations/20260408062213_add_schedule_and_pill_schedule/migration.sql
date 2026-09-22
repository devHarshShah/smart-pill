-- CreateTable
CREATE TABLE "UserSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "breakfast" TEXT NOT NULL,
    "morningSnack" TEXT,
    "lunch" TEXT NOT NULL,
    "afternoonSnack" TEXT,
    "dinner" TEXT NOT NULL,
    "bedtime" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PillSchedule" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pillName" TEXT NOT NULL,
    "frequencyType" TEXT NOT NULL,
    "timesOfDay" TEXT[],
    "daysOfWeek" INTEGER[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PillSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSchedule_userId_key" ON "UserSchedule"("userId");

-- CreateIndex
CREATE INDEX "PillSchedule_deviceId_active_idx" ON "PillSchedule"("deviceId", "active");

-- AddForeignKey
ALTER TABLE "UserSchedule" ADD CONSTRAINT "UserSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PillSchedule" ADD CONSTRAINT "PillSchedule_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

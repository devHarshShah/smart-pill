-- DropForeignKey
ALTER TABLE "PairSession" DROP CONSTRAINT "PairSession_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "PairSession" DROP CONSTRAINT "PairSession_userId_fkey";

-- DropTable
DROP TABLE "PairSession";

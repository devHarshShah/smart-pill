import { Prisma } from '@prisma/client';

import { createUserToken, hashPassword, verifyPassword } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';

type SafeUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
};

type SafeDevice = {
  id: string;
  hardwareId: string;
  label: string | null;
  ownerUserId: string | null;
  lockedByUserId: string | null;
  pairedAt: Date | null;
  lastPhysicalResetAt: Date | null;
  createdAt: Date;
};

function sanitizeUser(user: { id: string; email: string; name: string | null; createdAt: Date }): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

function sanitizeDevice(device: {
  id: string;
  hardwareId: string;
  label: string | null;
  ownerUserId: string | null;
  lockedByUserId: string | null;
  pairedAt: Date | null;
  lastPhysicalResetAt: Date | null;
  createdAt: Date;
}): SafeDevice {
  return {
    id: device.id,
    hardwareId: device.hardwareId,
    label: device.label,
    ownerUserId: device.ownerUserId,
    lockedByUserId: device.lockedByUserId,
    pairedAt: device.pairedAt,
    lastPhysicalResetAt: device.lastPhysicalResetAt,
    createdAt: device.createdAt,
  };
}

export async function signup(input: { email: string; password: string; name?: string }) {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: 'Email already registered' as const };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || null,
      passwordHash: hashPassword(input.password),
    },
  });

  const token = createUserToken(user.id);
  return {
    token,
    user: sanitizeUser(user),
  };
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    return { error: 'Invalid email or password' as const };
  }

  const token = createUserToken(user.id);
  return {
    token,
    user: sanitizeUser(user),
  };
}

export async function registerDevice(input: { hardwareId: string; deviceSecret: string; label?: string }) {
  const hardwareId = input.hardwareId.trim();
  const deviceSecret = input.deviceSecret.trim();

  if (!hardwareId || !deviceSecret) {
    return { error: 'hardwareId and deviceSecret are required' as const };
  }

  const existing = await prisma.device.findUnique({ where: { hardwareId } });
  if (existing) {
    const updated = await prisma.device.update({
      where: { id: existing.id },
      data: {
        deviceSecret,
        label: input.label?.trim() || existing.label,
      },
    });

    return {
      device: sanitizeDevice(updated),
      updated: true,
    };
  }

  const device = await prisma.device.create({
    data: {
      hardwareId,
      deviceSecret,
      label: input.label?.trim() || null,
    },
  });

  return {
    device: sanitizeDevice(device),
    updated: false,
  };
}

export async function listDevicesForUser(userId: string) {
  const devices = await prisma.device.findMany({
    where: { ownerUserId: userId },
    include: {
      runtimeStatus: true,
      doses: {
        where: { completedAt: null },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    devices: devices.map((device) => ({
      ...sanitizeDevice(device),
      status: device.runtimeStatus
        ? {
            wifiConnected: device.runtimeStatus.wifiConnected,
            ip: device.runtimeStatus.ip,
            rssi: device.runtimeStatus.rssi,
            setupDone: device.runtimeStatus.setupDone,
            setupMismatch: device.runtimeStatus.setupMismatch,
            detectedPills: device.runtimeStatus.detectedPills,
            pillWeight: device.runtimeStatus.pillWeight,
            threshold: device.runtimeStatus.threshold,
            confirmReads: device.runtimeStatus.confirmReads,
            currentPills: device.runtimeStatus.currentPills,
            totalPills: device.runtimeStatus.totalPills,
            updatedAt: device.runtimeStatus.updatedAt,
          }
        : undefined,
      upcomingDoses: device.doses.map((dose) => ({
        id: dose.id,
        pillName: dose.pillName,
        scheduledAt: dose.scheduledAt,
        requiredPills: dose.requiredPills,
        alertTriggeredAt: dose.alertTriggeredAt,
        lastReminderAt: dose.lastReminderAt,
        reminderCount: dose.reminderCount,
      })),
    })),
  };
}

export async function updateDeviceRuntimeStatus(input: {
  hardwareId: string;
  deviceSecret: string;
  wifiConnected: boolean;
  ip?: string;
  rssi?: number;
  setupDone: boolean;
  setupMismatch?: boolean;
  detectedPills?: number;
  pillWeight?: number;
  threshold?: number;
  confirmReads?: number;
  currentPills?: number;
  totalPills?: number;
}) {
  const hardwareId = input.hardwareId.trim();
  const deviceSecret = input.deviceSecret.trim();

  const device = await prisma.device.findUnique({ where: { hardwareId } });
  if (!device) {
    return { error: 'Unknown hardwareId' as const };
  }

  if (device.deviceSecret !== deviceSecret) {
    return { error: 'Invalid device credentials' as const };
  }

  const status = await prisma.deviceRuntimeStatus.upsert({
    where: { deviceId: device.id },
    update: {
      hardwareId,
      wifiConnected: input.wifiConnected,
      ip: input.ip?.trim() || null,
      rssi: input.rssi,
      setupDone: input.setupDone,
      setupMismatch: input.setupMismatch ?? false,
      detectedPills: input.detectedPills,
      pillWeight: input.pillWeight,
      threshold: input.threshold,
      confirmReads: input.confirmReads,
      currentPills: input.currentPills,
      totalPills: input.totalPills,
    },
    create: {
      deviceId: device.id,
      hardwareId,
      wifiConnected: input.wifiConnected,
      ip: input.ip?.trim() || null,
      rssi: input.rssi,
      setupDone: input.setupDone,
      setupMismatch: input.setupMismatch ?? false,
      detectedPills: input.detectedPills,
      pillWeight: input.pillWeight,
      threshold: input.threshold,
      confirmReads: input.confirmReads,
      currentPills: input.currentPills,
      totalPills: input.totalPills,
    },
  });

  return {
    ok: true,
    status,
  };
}

export async function logDeviceEvent(input: {
  hardwareId: string;
  deviceSecret: string;
  type: string;
  payload?: unknown;
}) {
  const hardwareId = input.hardwareId.trim();
  const deviceSecret = input.deviceSecret.trim();
  const type = input.type.trim().toUpperCase();

  if (!type) {
    return { error: 'type is required' as const };
  }

  const device = await prisma.device.findUnique({ where: { hardwareId } });
  if (!device) {
    return { error: 'Unknown hardwareId' as const };
  }

  if (device.deviceSecret !== deviceSecret) {
    return { error: 'Invalid device credentials' as const };
  }

  const event = await prisma.deviceEvent.create({
    data: {
      deviceId: device.id,
      type,
      payload: (input.payload as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    },
  });

  const payload =
    input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? (input.payload as Record<string, unknown>)
      : null;
  const doseId = typeof payload?.doseId === 'string' ? payload.doseId : null;
  const takenPills = typeof payload?.takenPills === 'number' ? Math.floor(payload.takenPills) : null;

  if (doseId && (type === 'DOSE_COMPLETED' || type === 'DOSE_OVERDOSE')) {
    await prisma.deviceDose.updateMany({
      where: {
        id: doseId,
        deviceId: device.id,
        completedAt: null,
      },
      data: {
        completedAt: new Date(),
        takenPills: takenPills ?? undefined,
        overdoseDetected: type === 'DOSE_OVERDOSE',
      },
    });
  }

  return { ok: true, event };
}

export async function listDeviceEventsForUser(input: {
  userId: string;
  deviceId: string;
  limit?: number;
}) {
  const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
  if (!device) {
    return { error: 'Device not found' as const };
  }
  if (device.ownerUserId !== input.userId) {
    return { error: 'Device does not belong to user' as const };
  }

  const events = await prisma.deviceEvent.findMany({
    where: { deviceId: input.deviceId },
    orderBy: { createdAt: 'desc' },
    take: input.limit && input.limit > 0 ? Math.min(input.limit, 200) : 50,
  });

  return { events };
}

export async function createDoseForUser(input: {
  userId: string;
  deviceId: string;
  pillName: string;
  scheduledAt: Date;
  requiredPills: number;
}) {
  const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
  if (!device) {
    return { error: 'Device not found' as const };
  }
  if (device.ownerUserId !== input.userId) {
    return { error: 'Device does not belong to user' as const };
  }

  if (!input.pillName.trim()) {
    return { error: 'pillName is required' as const };
  }

  if (!Number.isFinite(input.requiredPills) || input.requiredPills <= 0) {
    return { error: 'requiredPills must be greater than 0' as const };
  }

  const dose = await prisma.deviceDose.create({
    data: {
      deviceId: input.deviceId,
      pillName: input.pillName.trim(),
      scheduledAt: input.scheduledAt,
      requiredPills: Math.floor(input.requiredPills),
    },
  });

  return { dose };
}

export async function listDosesForUser(input: {
  userId: string;
  deviceId: string;
  includeCompleted?: boolean;
}) {
  const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
  if (!device) {
    return { error: 'Device not found' as const };
  }
  if (device.ownerUserId !== input.userId) {
    return { error: 'Device does not belong to user' as const };
  }

  const doses = await prisma.deviceDose.findMany({
    where: {
      deviceId: input.deviceId,
      ...(input.includeCompleted ? {} : { completedAt: null }),
    },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
  });

  return { doses };
}

export async function enqueueCommand(input: {
  userId: string;
  deviceId: string;
  command: string;
  payload?: unknown;
}) {
  const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
  if (!device) {
    return { error: 'Device not found' as const };
  }

  if (device.ownerUserId !== input.userId) {
    return { error: 'Device does not belong to user' as const };
  }

  const command = await prisma.deviceCommand.create({
    data: {
      deviceId: input.deviceId,
      userId: input.userId,
      command: input.command,
      payload: (input.payload as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    },
  });

  return {
    accepted: true,
    queued: command,
  };
}

export async function pollDeviceCommands(input: { hardwareId: string; deviceSecret: string }) {
  const hardwareId = input.hardwareId.trim();
  const deviceSecret = input.deviceSecret.trim();

  const device = await prisma.device.findUnique({ where: { hardwareId } });
  if (!device) {
    return { error: 'Unknown hardwareId' as const };
  }

  if (device.deviceSecret !== deviceSecret) {
    return { error: 'Invalid device credentials' as const };
  }

  if (!device.ownerUserId) {
    return { error: 'Device is not paired yet' as const };
  }

  const commands = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const secondReminderThreshold = new Date(now.getTime() - 5 * 60 * 1000);

    const firstDueDose = await tx.deviceDose.findFirst({
      where: {
        deviceId: device.id,
        completedAt: null,
        alertTriggeredAt: null,
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    if (firstDueDose) {
      await tx.deviceCommand.create({
        data: {
          deviceId: device.id,
          userId: device.ownerUserId!,
          command: 'REMINDER_START',
          payload: {
            doseId: firstDueDose.id,
            pillName: firstDueDose.pillName,
            requiredPills: firstDueDose.requiredPills,
            scheduledAt: firstDueDose.scheduledAt.toISOString(),
            reminderNumber: 1,
          },
        },
      });

      await tx.deviceDose.update({
        where: { id: firstDueDose.id },
        data: {
          alertTriggeredAt: now,
          lastReminderAt: now,
          reminderCount: 1,
        },
      });
    } else {
      const secondDueDose = await tx.deviceDose.findFirst({
        where: {
          deviceId: device.id,
          completedAt: null,
          alertTriggeredAt: { not: null },
          reminderCount: 1,
          lastReminderAt: { lte: secondReminderThreshold },
        },
        orderBy: { scheduledAt: 'asc' },
      });

      if (secondDueDose) {
        await tx.deviceCommand.create({
          data: {
            deviceId: device.id,
            userId: device.ownerUserId!,
            command: 'REMINDER_START',
            payload: {
              doseId: secondDueDose.id,
              pillName: secondDueDose.pillName,
              requiredPills: secondDueDose.requiredPills,
              scheduledAt: secondDueDose.scheduledAt.toISOString(),
              reminderNumber: 2,
            },
          },
        });

        await tx.deviceDose.update({
          where: { id: secondDueDose.id },
          data: {
            lastReminderAt: now,
            reminderCount: { increment: 1 },
          },
        });
      }
    }

    const queued = await tx.deviceCommand.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: 'asc' },
    });

    if (queued.length > 0) {
      await tx.deviceCommand.deleteMany({ where: { deviceId: device.id } });
    }

    return queued;
  });

  return {
    deviceId: device.id,
    commands,
  };
}

export async function physicalResetDevice(input: { hardwareId: string; deviceSecret: string }) {
  const hardwareId = input.hardwareId.trim();
  const deviceSecret = input.deviceSecret.trim();

  const device = await prisma.device.findUnique({ where: { hardwareId } });
  if (!device) {
    return { error: 'Unknown hardwareId' as const };
  }

  if (device.deviceSecret !== deviceSecret) {
    return { error: 'Invalid device credentials' as const };
  }

  const updatedDevice = await prisma.$transaction(async (tx) => {
    await tx.deviceCommand.deleteMany({ where: { deviceId: device.id } });
    await tx.deviceRuntimeStatus.deleteMany({ where: { deviceId: device.id } });

    return tx.device.update({
      where: { id: device.id },
      data: {
        ownerUserId: null,
        lockedByUserId: null,
        pairedAt: null,
        lastPhysicalResetAt: new Date(),
      },
    });
  });

  return {
    reset: true,
    device: sanitizeDevice(updatedDevice),
  };
}

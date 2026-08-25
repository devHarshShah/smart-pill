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
    include: { runtimeStatus: true },
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

import { NextRequest } from 'next/server';

import { Prisma } from '@prisma/client';

import { badRequest, conflict, forbidden, json, readJson, requireUser, unauthorized } from '@/lib/http';
import { prisma } from '@/lib/prisma';

type UpdateDoseBody = {
  takenAt?: string;
  takenPills?: number;
  mark?: 'TAKEN' | 'MISSED';
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string; doseId: string }> },
) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const params = await context.params;
  const body = await readJson<UpdateDoseBody>(request);
  const mark = body?.mark ?? 'TAKEN';
  if (mark !== 'TAKEN' && mark !== 'MISSED') {
    return badRequest('mark must be TAKEN or MISSED');
  }

  const device = await prisma.device.findUnique({ where: { id: params.deviceId } });
  if (!device) return forbidden('Device not found');
  if (device.ownerUserId !== user.id) return forbidden('Device does not belong to user');

  const dose = await prisma.deviceDose.findUnique({ where: { id: params.doseId } });
  if (!dose || dose.deviceId !== params.deviceId) {
    return forbidden('Dose not found');
  }

  if (mark === 'MISSED') {
    const updated = await prisma.deviceDose.update({
      where: { id: dose.id },
      data: {
        completedAt: null,
        takenPills: null,
        overdoseDetected: false,
      },
    });
    return json({ dose: updated });
  }

  if (dose.completedAt) {
    return conflict('Dose is already marked as taken');
  }

  const takenAt = body?.takenAt ? new Date(body.takenAt) : new Date();
  if (Number.isNaN(takenAt.getTime())) {
    return badRequest('takenAt must be a valid ISO date string');
  }
  const takenPills = typeof body?.takenPills === 'number' ? Math.max(1, Math.floor(body.takenPills)) : dose.requiredPills;

  const verificationWindowStart = new Date(dose.scheduledAt.getTime() - 12 * 60 * 60 * 1000);
  const verificationWindowEnd = new Date(Math.max(takenAt.getTime(), Date.now()) + 5 * 60 * 1000);

  const illegalEvents = await prisma.deviceEvent.findMany({
    where: {
      deviceId: params.deviceId,
      type: 'ILLEGAL_PILL_REMOVAL',
      createdAt: {
        gte: verificationWindowStart,
        lte: verificationWindowEnd,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const matchedIllegal = illegalEvents.find((event) => {
    const payload =
      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : null;
    if (!payload) return false;
    if (typeof payload.matchedDoseId === 'string') return false;
    const removed = typeof payload.removedPills === 'number' ? Math.floor(payload.removedPills) : 0;
    return removed >= takenPills;
  });

  if (!matchedIllegal) {
    return conflict('Cannot verify this missed dose from pill-count reduction. No matching removal event found.');
  }

  const updated = await prisma.deviceDose.update({
    where: { id: dose.id },
    data: {
      completedAt: takenAt,
      takenPills,
      overdoseDetected: false,
    },
  });

  const illegalPayload =
    matchedIllegal.payload && typeof matchedIllegal.payload === 'object' && !Array.isArray(matchedIllegal.payload)
      ? (matchedIllegal.payload as Record<string, unknown>)
      : {};

  await prisma.deviceEvent.update({
    where: { id: matchedIllegal.id },
    data: {
      payload: {
        ...illegalPayload,
        matchedDoseId: dose.id,
        matchedTakenAt: takenAt.toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  await prisma.deviceEvent.create({
    data: {
      deviceId: params.deviceId,
      type: 'DOSE_MARKED_TAKEN',
      payload: {
        doseId: dose.id,
        pillName: dose.pillName,
        scheduledAt: dose.scheduledAt.toISOString(),
        takenAt: takenAt.toISOString(),
        takenPills,
        source: 'MANUAL',
        verification: {
          verified: true,
          method: 'ILLEGAL_PILL_REMOVAL',
          eventId: matchedIllegal.id,
          eventAt: matchedIllegal.createdAt.toISOString(),
        },
      },
    },
  });

  return json({
    dose: updated,
    verification: {
      verified: true,
      method: 'ILLEGAL_PILL_REMOVAL',
      eventId: matchedIllegal.id,
      eventAt: matchedIllegal.createdAt.toISOString(),
    },
  });
}

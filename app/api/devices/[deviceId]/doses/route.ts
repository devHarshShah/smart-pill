import { NextRequest } from 'next/server';

import { badRequest, forbidden, json, readJson, requireUser, unauthorized } from '@/lib/http';
import { prisma } from '@/lib/prisma';

type CreateDoseBody = {
  pillName?: string;
  scheduledAt?: string;
  requiredPills?: number;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string }> },
) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const params = await context.params;
  const includeCompleted = request.nextUrl.searchParams.get('includeCompleted') === 'true';

  const device = await prisma.device.findUnique({ where: { id: params.deviceId } });
  if (!device) {
    return forbidden('Device not found');
  }
  if (device.ownerUserId !== user.id) {
    return forbidden('Device does not belong to user');
  }

  const doses = await prisma.deviceDose.findMany({
    where: {
      deviceId: params.deviceId,
      ...(includeCompleted ? {} : { completedAt: null }),
    },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
  });

  return json({ doses });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string }> },
) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const body = await readJson<CreateDoseBody>(request);
  if (!body || typeof body.pillName !== 'string' || typeof body.scheduledAt !== 'string') {
    return badRequest('pillName and scheduledAt are required');
  }

  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return badRequest('scheduledAt must be a valid ISO date string');
  }

  const params = await context.params;
  const requiredPills = typeof body.requiredPills === 'number' ? Math.floor(body.requiredPills) : 1;
  if (!Number.isFinite(requiredPills) || requiredPills <= 0) {
    return badRequest('requiredPills must be greater than 0');
  }

  const device = await prisma.device.findUnique({ where: { id: params.deviceId } });
  if (!device) {
    return forbidden('Device not found');
  }
  if (device.ownerUserId !== user.id) {
    return forbidden('Device does not belong to user');
  }

  const dose = await prisma.deviceDose.create({
    data: {
      deviceId: params.deviceId,
      pillName: body.pillName.trim(),
      scheduledAt,
      requiredPills,
    },
  });

  return json({ dose }, 201);
}

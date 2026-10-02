import { NextRequest } from 'next/server';

import { json, requireUser, unauthorized, forbidden } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string }> },
) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const { deviceId } = await context.params;

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.ownerUserId !== user.id) {
    return forbidden('Device not found or does not belong to user');
  }

  const event = await prisma.deviceEvent.findFirst({
    where: {
      deviceId,
      type: 'CAL_STATUS',
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  });

  const payload = (event?.payload as {
    step?: string;
    expected?: number;
    detected?: number;
    current?: number;
    total?: number;
    message?: string;
  } | undefined) ?? {};

  const step = payload.step ?? null;
  const completed = step === 'DONE' || step === 'FAILED' || step === 'COUNT_VERIFIED' || step === 'COUNT_MISMATCH';
  const success = step === 'DONE' || step === 'COUNT_VERIFIED';

  return json({
    step,
    completed,
    success,
    createdAt: event?.createdAt?.toISOString() ?? null,
    expected: payload.expected,
    detected: payload.detected,
    current: payload.current,
    total: payload.total,
    message: payload.message,
  });
}

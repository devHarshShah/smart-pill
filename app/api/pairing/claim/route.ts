import { NextRequest } from 'next/server';

import { badRequest, forbidden, json, notFound, readJson, requireUser, unauthorized } from '@/lib/http';
import { prisma } from '@/lib/prisma';

type ClaimBody = {
  hardwareId?: string;
};

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const body = await readJson<ClaimBody>(request);
  if (!body || typeof body.hardwareId !== 'string' || !body.hardwareId.trim()) {
    return badRequest('hardwareId is required');
  }

  const hardwareId = body.hardwareId.trim();

  const device = await prisma.device.findUnique({ where: { hardwareId } });
  if (!device) {
    return notFound('Unknown hardwareId. Make sure device has booted and registered.');
  }

  if (device.lockedByUserId && device.lockedByUserId !== user.id) {
    return forbidden('Device is already claimed by another user. Physical reset required.');
  }

  const updated = await prisma.device.update({
    where: { id: device.id },
    data: {
      ownerUserId: user.id,
      lockedByUserId: user.id,
      pairedAt: new Date(),
    },
  });

  return json({ paired: true, device: { id: updated.id, hardwareId: updated.hardwareId, label: updated.label, pairedAt: updated.pairedAt } }, 200);
}

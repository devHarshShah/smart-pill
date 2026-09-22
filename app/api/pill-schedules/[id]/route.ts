import { NextRequest, NextResponse } from 'next/server';
import { verifyUserToken } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const verified = verifyUserToken(token);
  
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: scheduleId } = await params;

  const schedule = await prisma.pillSchedule.findUnique({
    where: { id: scheduleId },
    include: { device: true },
  });

  if (!schedule || schedule.device.ownerUserId !== verified.userId) {
    return NextResponse.json({ error: 'Schedule not found or not owned by user' }, { status: 404 });
  }

  await prisma.pillSchedule.update({
    where: { id: scheduleId },
    data: { active: false },
  });

  // Also remove future pending doses
  await prisma.deviceDose.deleteMany({
    where: {
      deviceId: schedule.deviceId,
      pillName: schedule.pillName,
      completedAt: null,
      scheduledAt: { gt: new Date() },
    },
  });

  return NextResponse.json({ success: true });
}

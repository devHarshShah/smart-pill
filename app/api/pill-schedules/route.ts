import { NextRequest, NextResponse } from 'next/server';
import { verifyUserToken } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const verified = verifyUserToken(token);
  
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const schedules = await prisma.pillSchedule.findMany({
    where: { device: { ownerUserId: verified.userId }, active: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ schedules });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const verified = verifyUserToken(token);
  
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    deviceId: string;
    pillName: string;
    totalPills: number;
    frequencyType: string;
    timesOfDay: string[];
    daysOfWeek: number[];
    startDate: string;
    daysCount: number;
  };

  if (!body.deviceId || !body.pillName || !body.timesOfDay?.length || !body.startDate || !body.daysCount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const device = await prisma.device.findUnique({ where: { id: body.deviceId } });
  if (!device || device.ownerUserId !== verified.userId) {
    return NextResponse.json({ error: 'Device not found or not owned by user' }, { status: 404 });
  }

  const runtime = await prisma.deviceRuntimeStatus.findUnique({ where: { deviceId: body.deviceId } });
  if (!runtime || !runtime.setupDone) {
    return NextResponse.json(
      { error: 'Please calibrate and load pills on the device before creating a schedule.' },
      { status: 409 },
    );
  }

  const expected = body.totalPills;
  const hasMismatch =
    runtime.setupMismatch ||
    (typeof runtime.detectedPills === 'number' && runtime.detectedPills !== expected) ||
    (typeof runtime.currentPills === 'number' && runtime.currentPills !== expected) ||
    (typeof runtime.totalPills === 'number' && runtime.totalPills !== expected);
  if (hasMismatch) {
    return NextResponse.json(
      {
        error: `Pill count mismatch. Expected ${expected}, detected ${runtime.detectedPills ?? '-'}, current ${runtime.currentPills ?? '-'}, total ${runtime.totalPills ?? '-'}.`,
      },
      { status: 409 },
    );
  }

  const startParts = body.startDate.split('-').map(Number);
  if (startParts.length !== 3 || startParts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
  }
  const [year, month, day] = startParts;
  const startLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(startLocal.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
  }

  const schedule = await prisma.pillSchedule.create({
    data: {
      deviceId: body.deviceId,
      pillName: body.pillName,
      frequencyType: body.frequencyType,
      timesOfDay: body.timesOfDay,
      daysOfWeek: body.daysOfWeek,
      startDate: startLocal,
    },
  });

  // Generate doses
  const dosesToCreate = [];
  const now = new Date();
  const start = new Date(startLocal);

  for (let i = 0; i < body.daysCount; i++) {
    const curDate = new Date(start);
    curDate.setDate(curDate.getDate() + i);
    const dayOfWeek = curDate.getDay();

    if (body.daysOfWeek.length > 0 && !body.daysOfWeek.includes(dayOfWeek)) {
      continue;
    }

    for (const timeStr of body.timesOfDay) {
      const [hh, mm] = timeStr.split(':').map(Number);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
      const doseTime = new Date(curDate);
      doseTime.setHours(hh, mm, 0, 0);
      if (doseTime <= now) {
        continue;
      }

      dosesToCreate.push({
        deviceId: body.deviceId,
        pillName: body.pillName,
        scheduledAt: doseTime,
        requiredPills: 1, // Assuming 1 per dose for now
      });
    }
  }

  if (dosesToCreate.length > 0) {
    await prisma.deviceDose.createMany({
      data: dosesToCreate,
    });
  }

  return NextResponse.json({ schedule, dosesCreated: dosesToCreate.length });
}

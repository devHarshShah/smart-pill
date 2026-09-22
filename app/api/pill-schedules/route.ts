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

  const schedule = await prisma.pillSchedule.create({
    data: {
      deviceId: body.deviceId,
      pillName: body.pillName,
      frequencyType: body.frequencyType,
      timesOfDay: body.timesOfDay,
      daysOfWeek: body.daysOfWeek,
      startDate: new Date(body.startDate),
    },
  });

  // Generate doses
  const dosesToCreate = [];
  const start = new Date(body.startDate);
  start.setHours(0, 0, 0, 0);

  for (let i = 0; i < body.daysCount; i++) {
    const curDate = new Date(start);
    curDate.setDate(curDate.getDate() + i);
    const dayOfWeek = curDate.getDay();

    if (body.daysOfWeek.length > 0 && !body.daysOfWeek.includes(dayOfWeek)) {
      continue;
    }

    for (const timeStr of body.timesOfDay) {
      const [hh, mm] = timeStr.split(':').map(Number);
      const doseTime = new Date(curDate);
      doseTime.setHours(hh, mm, 0, 0);

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

  // Update device total pills
  if (body.totalPills > 0) {
    await prisma.deviceRuntimeStatus.upsert({
      where: { deviceId: body.deviceId },
      update: { totalPills: body.totalPills, currentPills: body.totalPills },
      create: { 
        deviceId: body.deviceId, 
        hardwareId: device.hardwareId,
        wifiConnected: false,
        totalPills: body.totalPills,
        currentPills: body.totalPills,
        setupDone: true
      }
    });
  }

  return NextResponse.json({ schedule, dosesCreated: dosesToCreate.length });
}

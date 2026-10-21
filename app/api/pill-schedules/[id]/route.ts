import { NextRequest, NextResponse } from 'next/server';
import { verifyUserToken } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';

type UpdateScheduleBody = {
  applyRecommendation?: {
    sourceTime?: string;
    recommendedTime?: string;
    regenerateDays?: number;
  };
  timesOfDay?: string[];
  regenerateDays?: number;
};

function parseHHMM(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { hh: Number(match[1]), mm: Number(match[2]) };
}

function toMinutes(value: string) {
  const parsed = parseHHMM(value);
  if (!parsed) return null;
  return parsed.hh * 60 + parsed.mm;
}

function normalizeTimes(times: string[]) {
  const valid = times.filter((t) => parseHHMM(t) !== null);
  const unique = [...new Set(valid)];
  return unique.sort((a, b) => (toMinutes(a) ?? 0) - (toMinutes(b) ?? 0));
}

function replaceClosestTime(times: string[], source: string, target: string) {
  if (times.length === 0) return [target];
  const sourceMinutes = toMinutes(source);
  const targetMinutes = toMinutes(target);
  if (sourceMinutes === null || targetMinutes === null) return normalizeTimes(times);

  const exactIdx = times.findIndex((t) => t === source);
  if (exactIdx >= 0) {
    const copy = [...times];
    copy[exactIdx] = target;
    return normalizeTimes(copy);
  }

  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const mins = toMinutes(times[i]);
    if (mins === null) continue;
    const dist = Math.abs(mins - sourceMinutes);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  const copy = [...times];
  copy[bestIdx] = target;
  return normalizeTimes(copy);
}

function generatePendingDoses(
  input: {
    deviceId: string;
    pillName: string;
    timesOfDay: string[];
    daysOfWeek: number[];
    startDate: Date;
  },
  now: Date,
  horizonDays: number,
) {
  const doses: Array<{
    deviceId: string;
    pillName: string;
    scheduledAt: Date;
    requiredPills: number;
  }> = [];
  const startPoint = input.startDate > now ? input.startDate : now;
  const startLocal = new Date(
    startPoint.getFullYear(),
    startPoint.getMonth(),
    startPoint.getDate(),
    0,
    0,
    0,
    0,
  );

  for (let i = 0; i < horizonDays; i++) {
    const curDate = new Date(startLocal);
    curDate.setDate(curDate.getDate() + i);
    const dayOfWeek = curDate.getDay();
    if (input.daysOfWeek.length > 0 && !input.daysOfWeek.includes(dayOfWeek)) {
      continue;
    }

    for (const timeStr of input.timesOfDay) {
      const parsed = parseHHMM(timeStr);
      if (!parsed) continue;
      const doseTime = new Date(curDate);
      doseTime.setHours(parsed.hh, parsed.mm, 0, 0);
      if (doseTime <= now) continue;

      doses.push({
        deviceId: input.deviceId,
        pillName: input.pillName,
        scheduledAt: doseTime,
        requiredPills: 1,
      });
    }
  }

  return doses;
}

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

  // Also remove all pending doses for this medication on this device
  await prisma.deviceDose.deleteMany({
    where: {
      deviceId: schedule.deviceId,
      pillName: schedule.pillName,
      completedAt: null,
    },
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const verified = verifyUserToken(token);

  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: scheduleId } = await params;
  const body = (await req.json()) as UpdateScheduleBody;

  const schedule = await prisma.pillSchedule.findUnique({
    where: { id: scheduleId },
    include: { device: true },
  });

  if (!schedule || schedule.device.ownerUserId !== verified.userId) {
    return NextResponse.json({ error: 'Schedule not found or not owned by user' }, { status: 404 });
  }

  let nextTimes = normalizeTimes(schedule.timesOfDay);
  const regenerateDaysRaw = body?.applyRecommendation?.regenerateDays ?? body?.regenerateDays ?? 45;
  const regenerateDays = Number.isFinite(regenerateDaysRaw)
    ? Math.max(7, Math.min(120, Math.floor(regenerateDaysRaw)))
    : 45;

  if (body?.applyRecommendation?.sourceTime && body?.applyRecommendation?.recommendedTime) {
    const sourceTime = body.applyRecommendation.sourceTime;
    const recommendedTime = body.applyRecommendation.recommendedTime;
    if (!parseHHMM(sourceTime) || !parseHHMM(recommendedTime)) {
      return NextResponse.json({ error: 'Invalid recommendation times' }, { status: 400 });
    }
    nextTimes = replaceClosestTime(nextTimes, sourceTime, recommendedTime);
  } else if (body?.timesOfDay?.length) {
    nextTimes = normalizeTimes(body.timesOfDay);
  } else {
    return NextResponse.json({ error: 'No schedule update payload provided' }, { status: 400 });
  }

  if (nextTimes.length === 0) {
    return NextResponse.json({ error: 'timesOfDay must contain at least one valid HH:mm value' }, { status: 400 });
  }

  const now = new Date();

  const updatedSchedule = await prisma.pillSchedule.update({
    where: { id: scheduleId },
    data: {
      timesOfDay: nextTimes,
      updatedAt: now,
    },
  });

  await prisma.deviceDose.deleteMany({
    where: {
      deviceId: schedule.deviceId,
      pillName: schedule.pillName,
      completedAt: null,
      scheduledAt: { gte: now },
    },
  });

  const dosesToCreate = generatePendingDoses(
    {
      deviceId: schedule.deviceId,
      pillName: schedule.pillName,
      timesOfDay: nextTimes,
      daysOfWeek: schedule.daysOfWeek,
      startDate: schedule.startDate,
    },
    now,
    regenerateDays,
  );

  if (dosesToCreate.length > 0) {
    await prisma.deviceDose.createMany({ data: dosesToCreate });
  }

  return NextResponse.json({
    success: true,
    schedule: updatedSchedule,
    timesOfDay: nextTimes,
    dosesCreated: dosesToCreate.length,
    regeneratedDays: regenerateDays,
  });
}

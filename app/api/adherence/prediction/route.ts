import { NextRequest } from 'next/server';

import { badRequest, forbidden, json, requireUser, unauthorized } from '@/lib/http';
import { prisma } from '@/lib/prisma';

type DoseEventPayload = {
  doseId?: string;
};

type Sample = {
  doseId: string;
  deviceId: string;
  pillName: string;
  scheduledAt: Date;
  completedAt: Date;
  deltaMinutes: number;
  weekday: string;
};

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function mean(values: number[]) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function getWeekdayLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(date);
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const deviceId = request.nextUrl.searchParams.get('deviceId');
  if (!deviceId) {
    return badRequest('deviceId is required');
  }
  const pillName = request.nextUrl.searchParams.get('pillName')?.trim() || undefined;
  const timeZone = request.nextUrl.searchParams.get('timeZone') || 'Asia/Kolkata';
  const windowDays = Math.min(parsePositiveInt(request.nextUrl.searchParams.get('days'), 21), 90);

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.ownerUserId !== user.id) {
    return forbidden('Device not found or does not belong to user');
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const completedEvents = await prisma.deviceEvent.findMany({
    where: {
      deviceId,
      type: 'DOSE_COMPLETED',
      createdAt: { gte: windowStart, lte: now },
    },
    orderBy: { createdAt: 'asc' },
    take: 2000,
  });

  const doseIds = completedEvents
    .map((event) => {
      const payload = event.payload as DoseEventPayload | null;
      return payload?.doseId;
    })
    .filter((id): id is string => typeof id === 'string');

  const uniqueDoseIds = [...new Set(doseIds)];
  const doses = uniqueDoseIds.length
    ? await prisma.deviceDose.findMany({
        where: {
          id: { in: uniqueDoseIds },
          deviceId,
          ...(pillName ? { pillName } : {}),
        },
      })
    : [];

  const doseById = new Map(doses.map((dose) => [dose.id, dose]));
  const samples: Sample[] = [];

  for (const event of completedEvents) {
    const payload = event.payload as DoseEventPayload | null;
    const doseId = payload?.doseId;
    if (!doseId) continue;
    const dose = doseById.get(doseId);
    if (!dose) continue;

    const deltaMinutes = Math.round((event.createdAt.getTime() - dose.scheduledAt.getTime()) / 60000);
    if (!Number.isFinite(deltaMinutes)) continue;
    if (Math.abs(deltaMinutes) > 12 * 60) continue;

    samples.push({
      doseId,
      deviceId,
      pillName: dose.pillName,
      scheduledAt: dose.scheduledAt,
      completedAt: event.createdAt,
      deltaMinutes,
      weekday: getWeekdayLabel(dose.scheduledAt, timeZone),
    });
  }

  const byWeekday = new Map<string, number[]>();
  for (const sample of samples) {
    const bucket = byWeekday.get(sample.weekday) ?? [];
    bucket.push(sample.deltaMinutes);
    byWeekday.set(sample.weekday, bucket);
  }

  const weekdayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekdayStats = weekdayOrder.map((day) => {
    const values = byWeekday.get(day) ?? [];
    return {
      day,
      count: values.length,
      medianDeltaMinutes: median(values),
      meanDeltaMinutes: mean(values),
    };
  });

  const overallDeltas = samples.map((s) => s.deltaMinutes);
  const overallMedian = median(overallDeltas);
  const overallMean = mean(overallDeltas);

  const nextDose = await prisma.deviceDose.findFirst({
    where: {
      deviceId,
      completedAt: null,
      scheduledAt: { gte: now },
      ...(pillName ? { pillName } : {}),
    },
    orderBy: { scheduledAt: 'asc' },
  });

  let recommendation: {
    doseId: string;
    pillName: string;
    scheduledAt: string;
    predictedDeltaMinutes: number;
    predictedAt: string;
    model: string;
    confidence: 'low' | 'medium' | 'high';
  } | null = null;

  if (nextDose) {
    const weekday = getWeekdayLabel(nextDose.scheduledAt, timeZone);
    const weekdayValues = byWeekday.get(weekday) ?? [];
    const weekdayMedian = median(weekdayValues);
    const hasWeekdaySignal = weekdayValues.length >= 3 && weekdayMedian !== null;
    const hasGlobalSignal = overallDeltas.length >= 5 && overallMedian !== null;

    let predictedDeltaMinutes = 0;
    if (hasWeekdaySignal && hasGlobalSignal) {
      predictedDeltaMinutes = Math.round(0.7 * (weekdayMedian as number) + 0.3 * (overallMedian as number));
    } else if (hasWeekdaySignal) {
      predictedDeltaMinutes = weekdayMedian as number;
    } else if (hasGlobalSignal) {
      predictedDeltaMinutes = overallMedian as number;
    }

    const predictedAt = new Date(nextDose.scheduledAt.getTime() + predictedDeltaMinutes * 60000);
    recommendation = {
      doseId: nextDose.id,
      pillName: nextDose.pillName,
      scheduledAt: nextDose.scheduledAt.toISOString(),
      predictedDeltaMinutes,
      predictedAt: predictedAt.toISOString(),
      model: 'robust-median-blend-v1',
      confidence: overallDeltas.length >= 14 ? 'high' : overallDeltas.length >= 7 ? 'medium' : 'low',
    };
  }

  return json({
    deviceId,
    pillName: pillName ?? null,
    windowDays,
    timeZone,
    sampleCount: samples.length,
    overall: {
      medianDeltaMinutes: overallMedian,
      meanDeltaMinutes: overallMean,
    },
    weekdayStats,
    recommendation,
    samples: samples.map((sample) => ({
      doseId: sample.doseId,
      pillName: sample.pillName,
      scheduledAt: sample.scheduledAt.toISOString(),
      completedAt: sample.completedAt.toISOString(),
      deltaMinutes: sample.deltaMinutes,
      weekday: sample.weekday,
    })),
  });
}


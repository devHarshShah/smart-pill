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

  const schedule = await prisma.userSchedule.findUnique({
    where: { userId: verified.userId },
  });

  return NextResponse.json({ schedule });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const verified = verifyUserToken(token);
  
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    breakfast: string;
    morningSnack?: string;
    lunch: string;
    afternoonSnack?: string;
    dinner: string;
    bedtime?: string;
  };

  if (!body.breakfast || !body.lunch || !body.dinner) {
    return NextResponse.json({ error: 'Missing required meal times' }, { status: 400 });
  }

  const schedule = await prisma.userSchedule.upsert({
    where: { userId: verified.userId },
    update: {
      breakfast: body.breakfast,
      morningSnack: body.morningSnack || null,
      lunch: body.lunch,
      afternoonSnack: body.afternoonSnack || null,
      dinner: body.dinner,
      bedtime: body.bedtime || null,
    },
    create: {
      userId: verified.userId,
      breakfast: body.breakfast,
      morningSnack: body.morningSnack || null,
      lunch: body.lunch,
      afternoonSnack: body.afternoonSnack || null,
      dinner: body.dinner,
      bedtime: body.bedtime || null,
    },
  });

  return NextResponse.json({ schedule });
}

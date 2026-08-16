import { NextRequest } from 'next/server';

import { badRequest, json, readJson } from '@/lib/http';
import { pollDeviceCommands } from '@/lib/services';

type PollBody = {
  hardwareId?: string;
  deviceSecret?: string;
};

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await readJson<PollBody>(request);
  if (!body || typeof body.hardwareId !== 'string' || typeof body.deviceSecret !== 'string') {
    return badRequest('hardwareId and deviceSecret are required');
  }

  const hardwareId = body.hardwareId;
  const deviceSecret = body.deviceSecret;

  const result = await pollDeviceCommands({
    hardwareId,
    deviceSecret,
  });

  if ('error' in result) {
    return badRequest(result.error ?? 'Polling failed');
  }

  return json(result);
}

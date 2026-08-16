import { NextRequest } from 'next/server';

import { badRequest, json, readJson } from '@/lib/http';
import { physicalResetDevice } from '@/lib/services';

type ResetBody = {
  hardwareId?: string;
  deviceSecret?: string;
};

export async function POST(request: NextRequest) {
  const body = await readJson<ResetBody>(request);
  if (!body || typeof body.hardwareId !== 'string' || typeof body.deviceSecret !== 'string') {
    return badRequest('hardwareId and deviceSecret are required');
  }

  const hardwareId = body.hardwareId;
  const deviceSecret = body.deviceSecret;

  const result = await physicalResetDevice({
    hardwareId,
    deviceSecret,
  });

  if ('error' in result) {
    return badRequest(result.error ?? 'Reset failed');
  }

  return json(result);
}

import { NextRequest } from 'next/server';

import { badRequest, json, readJson } from '@/lib/http';
import { registerDevice } from '@/lib/services';

type RegisterDeviceBody = {
  hardwareId?: string;
  deviceSecret?: string;
  label?: string;
};

export async function POST(request: NextRequest) {
  const body = await readJson<RegisterDeviceBody>(request);
  if (!body) {
    return badRequest('Invalid JSON body');
  }

  if (typeof body.hardwareId !== 'string' || typeof body.deviceSecret !== 'string') {
    return badRequest('hardwareId and deviceSecret are required');
  }

  const hardwareId = body.hardwareId;
  const deviceSecret = body.deviceSecret;

  const result = await registerDevice({
    hardwareId,
    deviceSecret,
    label: body.label,
  });

  if ('error' in result) {
    return badRequest(result.error ?? 'Device registration failed');
  }

  return json(result, result.updated ? 200 : 201);
}

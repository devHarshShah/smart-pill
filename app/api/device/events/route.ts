import { NextRequest } from 'next/server';

import { badRequest, json, readJson } from '@/lib/http';
import { logDeviceEvent } from '@/lib/services';

type DeviceEventBody = {
  hardwareId?: string;
  deviceSecret?: string;
  type?: string;
  payload?: unknown;
};

export async function POST(request: NextRequest) {
  const body = await readJson<DeviceEventBody>(request);
  if (!body) {
    return badRequest('Invalid JSON body');
  }

  if (
    typeof body.hardwareId !== 'string' ||
    typeof body.deviceSecret !== 'string' ||
    typeof body.type !== 'string'
  ) {
    return badRequest('hardwareId, deviceSecret, type are required');
  }

  const result = await logDeviceEvent({
    hardwareId: body.hardwareId,
    deviceSecret: body.deviceSecret,
    type: body.type,
    payload: body.payload,
  });

  if ('error' in result) {
    return badRequest(result.error ?? 'Event logging failed');
  }

  return json(result, 201);
}

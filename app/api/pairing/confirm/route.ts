import { NextRequest } from 'next/server';

import { badRequest, conflict, json, readJson } from '@/lib/http';
import { confirmPairing } from '@/lib/services';

type ConfirmBody = {
  hardwareId?: string;
  deviceSecret?: string;
  pairCode?: string;
};

export async function POST(request: NextRequest) {
  const body = await readJson<ConfirmBody>(request);
  if (!body) {
    return badRequest('Invalid JSON body');
  }

  if (
    typeof body.hardwareId !== 'string' ||
    typeof body.deviceSecret !== 'string' ||
    typeof body.pairCode !== 'string'
  ) {
    return badRequest('hardwareId, deviceSecret and pairCode are required');
  }

  const hardwareId = body.hardwareId;
  const deviceSecret = body.deviceSecret;
  const pairCode = body.pairCode;

  const result = await confirmPairing({
    hardwareId,
    deviceSecret,
    pairCode,
  });

  if ('error' in result) {
    return conflict(result.error ?? 'Pair confirmation failed');
  }

  return json(result);
}

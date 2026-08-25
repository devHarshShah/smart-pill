import { NextRequest } from 'next/server';

import { badRequest, conflict, json, readJson, requireUser, unauthorized } from '@/lib/http';
import { createPairSession } from '@/lib/services';

type PairSessionBody = {
  hardwareId?: string;
};

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const body = await readJson<PairSessionBody>(request);
  if (!body || typeof body.hardwareId !== 'string') {
    return badRequest('hardwareId is required');
  }

  const hardwareId = body.hardwareId;

  const result = await createPairSession(user.id, {
    hardwareId,
  });

  if ('error' in result) {
    return conflict(result.error ?? 'Pair session failed');
  }

  return json(result, 201);
}

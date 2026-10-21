import { NextRequest } from 'next/server';

import { badRequest, forbidden, json, requireUser, unauthorized } from '@/lib/http';
import { listDeviceEventsForUser } from '@/lib/services';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string }> },
) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const params = await context.params;
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : 30;
  if (!Number.isFinite(limit) || limit <= 0) {
    return badRequest('limit must be a positive number');
  }

  const result = await listDeviceEventsForUser({
    userId: user.id,
    deviceId: params.deviceId,
    limit,
  });
  if ('error' in result) {
    return forbidden(result.error ?? 'Not allowed');
  }

  return json(result);
}


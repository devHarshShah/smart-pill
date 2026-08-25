import { NextRequest } from 'next/server';

import { json, requireUser, unauthorized } from '@/lib/http';
import { listDevicesForUser } from '@/lib/services';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const result = await listDevicesForUser(user.id);
  return json(result);
}

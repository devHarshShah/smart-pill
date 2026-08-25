import { NextRequest } from 'next/server';

import { badRequest, forbidden, json, readJson, requireUser, unauthorized } from '@/lib/http';
import { enqueueCommand } from '@/lib/services';

type CommandBody = {
  command?: string;
  payload?: unknown;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string }> },
) {
  const user = await requireUser(request);
  if (!user) {
    return unauthorized('Missing or invalid token');
  }

  const body = await readJson<CommandBody>(request);
  if (!body || typeof body.command !== 'string' || body.command.trim().length === 0) {
    return badRequest('command is required');
  }

  const params = await context.params;
  const result = await enqueueCommand({
    userId: user.id,
    deviceId: params.deviceId,
    command: body.command,
    payload: body.payload,
  });

  if ('error' in result) {
    return forbidden(result.error ?? 'Command enqueue failed');
  }

  return json(result, 202);
}

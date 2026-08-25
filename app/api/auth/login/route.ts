import { NextRequest } from 'next/server';

import { badRequest, json, readJson, unauthorized } from '@/lib/http';
import { login } from '@/lib/services';

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: NextRequest) {
  const body = await readJson<LoginBody>(request);
  if (!body) {
    return badRequest('Invalid JSON body');
  }

  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return badRequest('email and password are required');
  }

  const result = await login({
    email: body.email,
    password: body.password,
  });

  if ('error' in result) {
    return unauthorized(result.error ?? 'Login failed');
  }

  return json(result);
}

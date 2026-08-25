import { NextRequest } from 'next/server';

import { badRequest, conflict, json, readJson } from '@/lib/http';
import { signup } from '@/lib/services';

type SignupBody = {
  email?: string;
  password?: string;
  name?: string;
};

export async function POST(request: NextRequest) {
  const body = await readJson<SignupBody>(request);
  if (!body) {
    return badRequest('Invalid JSON body');
  }

  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return badRequest('email and password are required');
  }

  const email = body.email;
  const password = body.password;

  if (password.length < 8) {
    return badRequest('password must be at least 8 characters');
  }

  const result = await signup({
    email,
    password,
    name: body.name,
  });

  if ('error' in result) {
    return conflict(result.error ?? 'Signup failed');
  }

  return json(result, 201);
}

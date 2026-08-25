import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { verifyUserToken } from '@/lib/crypto';
import type { User } from '@prisma/client';

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string) {
  return json({ error: message }, 400);
}

export function unauthorized(message = 'Unauthorized') {
  return json({ error: message }, 401);
}

export function forbidden(message = 'Forbidden') {
  return json({ error: message }, 403);
}

export function notFound(message = 'Not found') {
  return json({ error: message }, 404);
}

export function conflict(message: string) {
  return json({ error: message }, 409);
}

export async function readJson<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function getBearerToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

export async function requireUser(request: NextRequest): Promise<User | null> {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const decoded = verifyUserToken(token);
  if (!decoded) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: decoded.userId },
  });
}

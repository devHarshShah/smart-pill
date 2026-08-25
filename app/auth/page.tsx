'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setStoredToken } from '@/lib/client/auth';

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { token?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? 'Request failed');
  }

  return data;
}

export default function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initialMode = params.get('mode') === 'signup' ? 'signup' : 'login';

  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('pilot@medilink.local');
  const [password, setPassword] = useState('medilink123');
  const [name, setName] = useState('Pilot User');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const title = useMemo(() => (mode === 'signup' ? 'Create account' : 'Login to dashboard'), [mode]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const result = await postJson(endpoint, {
        email,
        password,
        ...(mode === 'signup' ? { name } : {}),
      });

      const token = result.token ?? '';
      if (!token) {
        throw new Error('Token not returned by server');
      }

      setStoredToken(token);
      router.push('/dashboard');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Link href="/" className="text-sm text-cyan-300 hover:text-cyan-200">Back to landing</Link>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Use your account to access device pairing and setup dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-md bg-slate-800 p-1">
              <Button variant={mode === 'login' ? 'default' : 'ghost'} onClick={() => setMode('login')}>Login</Button>
              <Button variant={mode === 'signup' ? 'default' : 'ghost'} onClick={() => setMode('signup')}>Sign Up</Button>
            </div>
            <form className="space-y-3" onSubmit={onSubmit}>
              {mode === 'signup' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Login'}
              </Button>
              {message ? <p className="text-sm text-amber-300">{message}</p> : null}
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950 p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">MediLink MVP</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">Closed-Loop Smart Pill Reminder</h1>
          <p className="mt-4 max-w-3xl text-slate-300">
            Onboard users, pair ESP32 pill devices, push setup remotely, and run command/control from one dashboard.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/auth?mode=signup">
              <Button className="h-11 px-6">Sign Up</Button>
            </Link>
            <Link href="/auth?mode=login">
              <Button variant="outline" className="h-11 px-6">Login</Button>
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Step 1</CardTitle>
              <CardDescription>User Auth</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-300">
              Signup/login with token-based auth to access a secure device dashboard.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Step 2</CardTitle>
              <CardDescription>Pair Device</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-300">
              Register ESP32 hardware identity, generate pair code, and lock device to user.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Step 3</CardTitle>
              <CardDescription>Remote Setup</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-300">
              Configure pill-monitor parameters and trigger device commands from UI.
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

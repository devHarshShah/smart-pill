'use client';

import { useEffect, useState } from 'react';
import { Cpu, Pill, TrendingUp, CalendarClock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getStoredToken, getStoredUser } from '@/lib/client/auth';

type DeviceStatus = {
  wifiConnected?: boolean;
  currentPills?: number;
  totalPills?: number;
  setupDone?: boolean;
  updatedAt?: string;
};

type DeviceItem = {
  id: string;
  hardwareId: string;
  label?: string;
  status?: DeviceStatus;
  upcomingDoses?: Array<{ id: string; pillName: string; scheduledAt: string; requiredPills: number }>;
};

function isOnline(updatedAt?: string) {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < 30_000;
}

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json() as T;
  return data;
}

export default function OverviewPage() {
  const [token] = useState(() => getStoredToken());
  const [userName] = useState(() => getStoredUser()?.name ?? 'there');
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ devices: DeviceItem[] }>('/api/devices', token)
      .then((r) => setDevices(r.devices ?? []))
      .finally(() => setLoading(false));
  }, [token]);

  const onlineDevices = devices.filter((d) => isOnline(d.status?.updatedAt));
  const totalDosesToday = devices.flatMap((d) => d.upcomingDoses ?? []).filter((dose) => {
    const dt = new Date(dose.scheduledAt);
    const now = new Date();
    return dt.toDateString() === now.toDateString();
  });

  const stats = [
    {
      title: 'Devices Online',
      value: loading ? '—' : `${onlineDevices.length} / ${devices.length}`,
      icon: Cpu,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-400/10',
    },
    {
      title: "Today's Doses",
      value: loading ? '—' : String(totalDosesToday.length),
      icon: Pill,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Active Schedules',
      value: loading ? '—' : String(devices.reduce((a, d) => a + (d.upcomingDoses?.length ?? 0), 0)),
      icon: CalendarClock,
      color: 'text-amber-400',
      bgColor: 'bg-amber-400/10',
    },
    {
      title: 'Adherence (7d)',
      value: '—',
      icon: TrendingUp,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-400/10',
    },
  ];

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, {userName} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s an overview of your medication monitoring system.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.title} className="border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">{s.title}</p>
                <div className={`rounded-lg p-2 ${s.bgColor}`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Devices summary */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Device Status</CardTitle>
            <CardDescription>Real-time status of your paired pill monitors</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : devices.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Cpu className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No devices paired yet.</p>
                <a href="/dashboard/devices" className="text-xs text-primary hover:underline">
                  Pair your first device →
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map((d) => {
                  const online = isOnline(d.status?.updatedAt);
                  const pct =
                    d.status?.totalPills && d.status.currentPills != null
                      ? Math.round((d.status.currentPills / d.status.totalPills) * 100)
                      : null;
                  return (
                    <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-3">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]' : 'bg-muted-foreground/40'}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{d.label ?? d.hardwareId}</p>
                        {pct !== null && (
                          <div className="mt-1 flex items-center gap-2">
                            <Progress
                              value={pct}
                              className="h-1.5 flex-1"
                            />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{pct}%</span>
                          </div>
                        )}
                      </div>
                      <Badge variant={online ? 'default' : 'secondary'} className="shrink-0 text-xs">
                        {online ? 'Online' : 'Offline'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Upcoming Doses Today</CardTitle>
            <CardDescription>Medications scheduled for today</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : totalDosesToday.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400/60" />
                <p className="text-sm text-muted-foreground">No doses scheduled for today.</p>
                <a href="/dashboard/pills" className="text-xs text-primary hover:underline">
                  Add a medication →
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                {totalDosesToday.slice(0, 6).map((dose) => {
                  const t = new Date(dose.scheduledAt);
                  const isPast = t < now;
                  return (
                    <div key={dose.id} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2">
                      {isPast ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                      ) : (
                        <Pill className="h-4 w-4 shrink-0 text-primary" />
                      )}
                      <p className="flex-1 text-sm font-medium">{dose.pillName}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { href: '/dashboard/pills', icon: Pill, label: 'Add Medication', desc: 'Set up a new pill schedule' },
              { href: '/dashboard/schedule', icon: CalendarClock, label: 'Edit Schedule', desc: 'Update meal & dose times' },
              { href: '/dashboard/devices', icon: Cpu, label: 'Pair Device', desc: 'Connect a new pill monitor' },
            ].map((a) => (
              <a
                key={a.href}
                href={a.href}
                className="flex items-start gap-3 rounded-xl border border-border/50 p-4 hover:bg-accent/50 hover:border-primary/30 transition-all duration-150 group"
              >
                <div className="rounded-lg bg-primary/10 p-2 group-hover:bg-primary/20 transition-colors">
                  <a.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{a.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                </div>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle, Clock, Pill } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStoredToken } from '@/lib/client/auth';

type Dose = {
  id: string; pillName: string; scheduledAt: string; requiredPills: number;
  completedAt?: string; takenPills?: number; overdoseDetected?: boolean;
  alertTriggeredAt?: string;
};
type DeviceItem = { id: string; hardwareId: string; label?: string };

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  return await res.json() as T;
}

export default function AdherencePage() {
  const [token, setToken] = useState('');
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [doses, setDoses] = useState<Dose[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    if (!t) return;
    apiFetch<{ devices: DeviceItem[] }>('/api/devices', t).then(r => {
      setDevices(r.devices ?? []);
      if (r.devices?.[0]) setSelectedDevice(r.devices[0].id);
    });
  }, []);

  useEffect(() => {
    if (!token || !selectedDevice) return;
    setLoading(true);
    apiFetch<{ doses: Dose[] }>(`/api/devices/${selectedDevice}/doses?includeCompleted=true`, token)
      .then(r => setDoses(r.doses ?? []))
      .finally(() => setLoading(false));
  }, [token, selectedDevice]);

  const completed = doses.filter(d => d.completedAt);
  const missed = doses.filter(d => !d.completedAt && new Date(d.scheduledAt) < new Date());
  const upcoming = doses.filter(d => !d.completedAt && new Date(d.scheduledAt) >= new Date());
  const adherencePct = doses.length > 0
    ? Math.round((completed.length / Math.max(1, completed.length + missed.length)) * 100)
    : null;

  const grouped = doses.reduce<Record<string, Dose[]>>((acc, dose) => {
    const day = new Date(dose.scheduledAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    (acc[day] ??= []).push(dose);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Adherence History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track medication compliance across all your pill boxes.</p>
      </div>

      {devices.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {devices.map(d => (
            <button
              key={d.id}
              onClick={() => setSelectedDevice(d.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${selectedDevice === d.id ? 'border-primary/50 bg-primary/10 text-primary font-medium' : 'border-border/50 text-muted-foreground hover:border-border'}`}
            >
              {d.label ?? d.hardwareId}
            </button>
          ))}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Adherence', value: adherencePct !== null ? `${adherencePct}%` : '—', icon: Activity, color: 'text-primary' },
          { label: 'Completed', value: String(completed.length), icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Missed', value: String(missed.length), icon: XCircle, color: 'text-destructive' },
          { label: 'Upcoming', value: String(upcoming.length), icon: Clock, color: 'text-amber-400' },
        ].map(s => (
          <Card key={s.label} className="border-border/50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Timeline */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Dose Timeline</CardTitle>
          <CardDescription>Complete history of scheduled and taken doses</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : doses.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Pill className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No dose history yet. Add medications to start tracking.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(grouped).reverse().map(([day, dayDoses]) => (
                <div key={day}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{day}</p>
                  <div className="space-y-2">
                    {dayDoses.map(dose => {
                      const isPast = new Date(dose.scheduledAt) < new Date();
                      const status = dose.completedAt ? 'taken' : isPast ? 'missed' : 'upcoming';
                      return (
                        <div key={dose.id} className={`flex items-center gap-3 rounded-lg border p-3 ${status === 'taken' ? 'border-emerald-500/20 bg-emerald-500/5' : status === 'missed' ? 'border-destructive/20 bg-destructive/5' : 'border-border/40'}`}>
                          {status === 'taken' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                          ) : status === 'missed' ? (
                            <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                          ) : (
                            <Clock className="h-4 w-4 shrink-0 text-amber-400" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{dose.pillName}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(dose.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {dose.completedAt && ` · Taken at ${new Date(dose.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                          </div>
                          <Badge
                            variant={status === 'taken' ? 'default' : 'secondary'}
                            className={`text-xs shrink-0 ${status === 'missed' ? 'border-destructive/30 text-destructive' : status === 'upcoming' ? 'text-amber-400 border-amber-500/30' : ''}`}
                          >
                            {status === 'taken' ? `${dose.takenPills ?? dose.requiredPills} taken` : status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

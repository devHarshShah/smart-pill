'use client';

import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle, Clock, Pill } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStoredToken } from '@/lib/client/auth';

type Dose = {
  id: string; pillName: string; scheduledAt: string; requiredPills: number;
  completedAt?: string; takenPills?: number; overdoseDetected?: boolean;
  alertTriggeredAt?: string;
};
type DeviceItem = { id: string; hardwareId: string; label?: string };
type PillScheduleItem = {
  id: string;
  deviceId: string;
  pillName: string;
  timesOfDay: string[];
  active: boolean;
};
type MarkTakenResponse = {
  dose: Dose;
  verification?: {
    verified?: boolean;
    method?: string;
    eventId?: string;
    eventAt?: string;
  };
};
type PredictionResponse = {
  sampleCount: number;
  overall: {
    medianDeltaMinutes: number | null;
    meanDeltaMinutes: number | null;
  };
  recommendation: {
    doseId: string;
    pillName: string;
    scheduledAt: string;
    predictedDeltaMinutes: number;
    predictedAt: string;
    confidence: 'low' | 'medium' | 'high';
    model: string;
  } | null;
};

function toLocalHHMM(iso: string) {
  const dt = new Date(iso);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtDelta(deltaMinutes: number | null) {
  if (deltaMinutes === null) return '—';
  if (deltaMinutes === 0) return 'On time';
  return deltaMinutes > 0 ? `+${deltaMinutes} min` : `${deltaMinutes} min`;
}

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Error ${res.status}`);
  }
  return data;
}

export default function AdherencePage() {
  const [token, setToken] = useState('');
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [doses, setDoses] = useState<Dose[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingDoseId, setUpdatingDoseId] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionErr, setPredictionErr] = useState('');
  const [schedules, setSchedules] = useState<PillScheduleItem[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [regenerateDays, setRegenerateDays] = useState(45);
  const [applyingSchedule, setApplyingSchedule] = useState(false);

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

  useEffect(() => {
    if (!token || !selectedDevice) return;
    setPredictionLoading(true);
    setPredictionErr('');
    Promise.all([
      apiFetch<PredictionResponse>(`/api/adherence/prediction?deviceId=${selectedDevice}&days=21&timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata')}`, token),
      apiFetch<{ schedules: PillScheduleItem[] }>('/api/pill-schedules', token),
    ])
      .then(([pred, schedulesRes]) => {
        setPrediction(pred);
        setSchedules((schedulesRes.schedules ?? []).filter((s) => s.deviceId === selectedDevice && s.active));
      })
      .catch((e) => {
        setPredictionErr(e instanceof Error ? e.message : 'Failed to load prediction');
        setPrediction(null);
      })
      .finally(() => setPredictionLoading(false));
  }, [token, selectedDevice]);

  const matchingSchedules = schedules.filter((s) => s.pillName === prediction?.recommendation?.pillName);

  useEffect(() => {
    if (matchingSchedules.length === 0) {
      setSelectedScheduleId('');
      return;
    }
    if (!matchingSchedules.some((s) => s.id === selectedScheduleId)) {
      setSelectedScheduleId(matchingSchedules[0].id);
    }
  }, [matchingSchedules, selectedScheduleId]);

  async function markDoseTaken(dose: Dose, mode: 'scheduled' | 'now') {
    if (!token || !selectedDevice) return;
    setActionErr('');
    setActionMsg('');
    setUpdatingDoseId(dose.id);
    const takenAt = mode === 'scheduled' ? dose.scheduledAt : new Date().toISOString();
    try {
      const result = await apiFetch<MarkTakenResponse>(`/api/devices/${selectedDevice}/doses/${dose.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ mark: 'TAKEN', takenAt, takenPills: dose.requiredPills }),
      });
      if (result.verification?.verified && result.verification.eventAt) {
        setActionMsg(`Verified by pill-removal event at ${new Date(result.verification.eventAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
      } else {
        setActionMsg('Dose marked as taken.');
      }
      const refreshed = await apiFetch<{ doses: Dose[] }>(`/api/devices/${selectedDevice}/doses?includeCompleted=true`, token);
      setDoses(refreshed.doses ?? []);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to mark dose');
    } finally {
      setUpdatingDoseId('');
    }
  }

  async function applyRecommendationToSchedule() {
    if (!token || !prediction?.recommendation || !selectedScheduleId) return;
    setActionErr('');
    setActionMsg('');
    setApplyingSchedule(true);
    try {
      const sourceTime = toLocalHHMM(prediction.recommendation.scheduledAt);
      const recommendedTime = toLocalHHMM(prediction.recommendation.predictedAt);
      const result = await apiFetch<{ dosesCreated: number }>(`/api/pill-schedules/${selectedScheduleId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          applyRecommendation: { sourceTime, recommendedTime, regenerateDays },
        }),
      });
      setActionMsg(`Schedule updated to ${recommendedTime}. Regenerated ${result.dosesCreated} upcoming doses.`);
      const refreshedPrediction = await apiFetch<PredictionResponse>(`/api/adherence/prediction?deviceId=${selectedDevice}&days=21&timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata')}`, token);
      setPrediction(refreshedPrediction);
      const refreshedDoses = await apiFetch<{ doses: Dose[] }>(`/api/devices/${selectedDevice}/doses?includeCompleted=true`, token);
      setDoses(refreshedDoses.doses ?? []);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to apply recommendation');
    } finally {
      setApplyingSchedule(false);
    }
  }

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
      {actionMsg && <p className="text-sm text-emerald-400">{actionMsg}</p>}
      {actionErr && <p className="text-sm text-destructive">{actionErr}</p>}

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

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Schedule Optimization</CardTitle>
          <CardDescription>Prediction cards and one-click apply to active schedule</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {predictionLoading ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : predictionErr ? (
            <p className="text-sm text-destructive">{predictionErr}</p>
          ) : !prediction?.recommendation ? (
            <p className="text-sm text-muted-foreground">Not enough adherence history yet to suggest a schedule update.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Samples (21d)</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{prediction.sampleCount}</p>
                </div>
                <div className="rounded-lg border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Median Delta</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{fmtDelta(prediction.overall.medianDeltaMinutes)}</p>
                </div>
                <div className="rounded-lg border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Recommended Time</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {new Date(prediction.recommendation.predictedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>

              {matchingSchedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active schedule found for <span className="font-medium">{prediction.recommendation.pillName}</span> on this device.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground">Apply to schedule</span>
                    <select
                      value={selectedScheduleId}
                      onChange={(e) => setSelectedScheduleId(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      {matchingSchedules.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.pillName} ({s.timesOfDay.join(', ')})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground">Regenerate</span>
                    <select
                      value={String(regenerateDays)}
                      onChange={(e) => setRegenerateDays(Number(e.target.value))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="21">21 days</option>
                      <option value="45">45 days</option>
                      <option value="90">90 days</option>
                    </select>
                  </label>
                  <Button
                    onClick={() => { void applyRecommendationToSchedule(); }}
                    disabled={applyingSchedule || !selectedScheduleId}
                  >
                    {applyingSchedule ? 'Applying...' : 'Apply to Schedule'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
                          {status === 'missed' && (
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={updatingDoseId === dose.id}
                                onClick={() => { void markDoseTaken(dose, 'scheduled'); }}
                              >
                                Mark @ Scheduled
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={updatingDoseId === dose.id}
                                onClick={() => { void markDoseTaken(dose, 'now'); }}
                              >
                                Mark Now
                              </Button>
                            </div>
                          )}
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

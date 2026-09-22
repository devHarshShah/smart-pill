'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Pill, ArrowLeft, ArrowRight, Calendar, Clock, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getStoredToken } from '@/lib/client/auth';

type DeviceItem = { id: string; hardwareId: string; label?: string };
type Schedule = { breakfast?: string; lunch?: string; dinner?: string; morningSnack?: string; afternoonSnack?: string; bedtime?: string };

type FrequencyType = 'daily_once' | 'twice_101' | 'thrice' | 'weekly' | 'custom';

const FREQUENCY_OPTIONS: { id: FrequencyType; label: string; desc: string; emoji: string }[] = [
  { id: 'daily_once', label: 'Once Daily', desc: 'One dose per day', emoji: '1️⃣' },
  { id: 'twice_101', label: 'Twice Daily (1-0-1)', desc: 'Morning & evening (with meals)', emoji: '💊' },
  { id: 'thrice', label: 'Three Times Daily', desc: 'Breakfast, lunch & dinner', emoji: '3️⃣' },
  { id: 'weekly', label: 'Once a Week', desc: 'Select a day of the week', emoji: '📅' },
  { id: 'custom', label: 'Custom Times', desc: 'Manually set specific times', emoji: '⚙️' },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addMins(timeStr: string, mins: number): string {
  if (!timeStr) return '';
  const [hh, mm] = timeStr.split(':').map(Number);
  const total = hh * 60 + mm + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function deriveTimes(freq: FrequencyType, schedule: Schedule, weekDay: number, customTimes: string[]): string[] {
  const buf = 15;
  switch (freq) {
    case 'daily_once':
      return [addMins(schedule.breakfast ?? '08:00', buf)];
    case 'twice_101':
      return [addMins(schedule.breakfast ?? '08:00', buf), addMins(schedule.dinner ?? '20:00', buf)];
    case 'thrice':
      return [
        addMins(schedule.breakfast ?? '08:00', buf),
        addMins(schedule.lunch ?? '13:30', buf),
        addMins(schedule.dinner ?? '20:00', buf),
      ];
    case 'weekly':
      return [addMins(schedule.breakfast ?? '08:00', buf)];
    case 'custom':
      return customTimes.filter(Boolean);
  }
}

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data;
}

export default function PillsPage() {
  const [token, setToken] = useState('');
  const [step, setStep] = useState(0);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [showWizard, setShowWizard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 1
  const [pillName, setPillName] = useState('');
  const [totalPills, setTotalPills] = useState('30');
  const [selectedDevice, setSelectedDevice] = useState('');

  // Step 2
  const [frequency, setFrequency] = useState<FrequencyType>('twice_101');
  const [weekDay, setWeekDay] = useState(1);
  const [customTimes, setCustomTimes] = useState(['09:00', '21:00']);

  // Step 3
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [daysCount, setDaysCount] = useState('7');

  const derivedTimes = deriveTimes(frequency, schedule, weekDay, customTimes);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    if (!t) return;
    Promise.all([
      apiFetch<{ devices: DeviceItem[] }>('/api/devices', t),
      apiFetch<{ schedule: Schedule | null }>('/api/schedule', t),
    ])
      .then(([devRes, schRes]) => {
        setDevices(devRes.devices ?? []);
        if (schRes.schedule) setSchedule(schRes.schedule);
        if (devRes.devices?.[0]) setSelectedDevice(devRes.devices[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  async function submit() {
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/pill-schedules', token, {
        method: 'POST',
        body: JSON.stringify({
          deviceId: selectedDevice,
          pillName,
          totalPills: Number(totalPills),
          frequencyType: frequency,
          timesOfDay: derivedTimes,
          daysOfWeek: frequency === 'weekly' ? [weekDay] : [],
          startDate,
          daysCount: Number(daysCount),
        }),
      });
      setSuccess(`✓ ${pillName} schedule created! Doses generated for ${daysCount} days.`);
      setShowWizard(false);
      setStep(0);
      setPillName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creating schedule');
    } finally {
      setSaving(false);
    }
  }

  const steps = ['Pill Info', 'Frequency', 'Confirm'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Medications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your pill schedules and reminders.</p>
        </div>
        {!showWizard && (
          <Button onClick={() => { setShowWizard(true); setStep(0); setSuccess(''); }} className="gap-2">
            <Pill className="h-4 w-4" />
            Add Medication
          </Button>
        )}
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">{success}</p>
        </div>
      )}

      {showWizard && (
        <Card className="border-primary/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Pill className="h-4 w-4 text-primary" />
                  Add New Medication
                </CardTitle>
                <CardDescription>Step {step + 1} of {steps.length}: {steps[step]}</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setShowWizard(false); setStep(0); }}>Cancel</Button>
            </div>

            {/* Progress */}
            <div className="space-y-2 mt-2">
              <Progress value={((step + 1) / steps.length) * 100} className="h-1.5" />
              <div className="flex justify-between text-xs text-muted-foreground">
                {steps.map((s, i) => (
                  <span key={s} className={i === step ? 'text-primary font-medium' : ''}>{s}</span>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Step 1 – Pill Info */}
            {step === 0 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pillName">Medication name</Label>
                  <Input id="pillName" placeholder="e.g. Metformin 500mg" value={pillName} onChange={(e) => setPillName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="totalPills">Total pills in box</Label>
                  <Input id="totalPills" type="number" min="1" value={totalPills} onChange={(e) => setTotalPills(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Device</Label>
                  {loading ? (
                    <div className="h-10 rounded-lg bg-muted animate-pulse" />
                  ) : devices.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border/50 p-3 text-sm text-muted-foreground">
                      <Cpu className="h-4 w-4" />
                      No devices paired yet. <a href="/dashboard/devices" className="text-primary hover:underline">Pair one first →</a>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {devices.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setSelectedDevice(d.id)}
                          className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${selectedDevice === d.id ? 'border-primary/50 bg-primary/10' : 'border-border/50 hover:border-border'}`}
                        >
                          <Cpu className={`h-4 w-4 ${selectedDevice === d.id ? 'text-primary' : 'text-muted-foreground'}`} />
                          <span className="text-sm font-medium">{d.label ?? d.hardwareId}</span>
                          {selectedDevice === d.id && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2 – Frequency */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="grid gap-2">
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setFrequency(opt.id)}
                      className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-all ${frequency === opt.id ? 'border-primary/50 bg-primary/10' : 'border-border/50 hover:border-border/80'}`}
                    >
                      <span className="text-2xl">{opt.emoji}</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                      {frequency === opt.id && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>

                {frequency === 'weekly' && (
                  <div className="space-y-1.5">
                    <Label>Day of week</Label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map((day, i) => (
                        <button
                          key={day}
                          onClick={() => setWeekDay(i)}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${weekDay === i ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border/50 text-muted-foreground hover:border-border'}`}
                        >
                          {day.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {frequency === 'custom' && (
                  <div className="space-y-2">
                    <Label>Custom times</Label>
                    {customTimes.map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input type="time" value={t} onChange={(e) => setCustomTimes((prev) => prev.map((v, j) => j === i ? e.target.value : v))} className="w-32" />
                        {customTimes.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => setCustomTimes((prev) => prev.filter((_, j) => j !== i))}>Remove</Button>
                        )}
                      </div>
                    ))}
                    {customTimes.length < 4 && (
                      <Button variant="outline" size="sm" onClick={() => setCustomTimes((prev) => [...prev, '09:00'])}>+ Add time</Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 3 – Confirm */}
            {step === 2 && (
              <div className="space-y-5">
                <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Pill className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{pillName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Cpu className="h-4 w-4" />
                    <span>{devices.find((d) => d.id === selectedDevice)?.label ?? selectedDevice}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{FREQUENCY_OPTIONS.find((f) => f.id === frequency)?.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {derivedTimes.map((t) => (
                      <Badge key={t} variant="secondary" className="font-mono text-xs">{t}</Badge>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="startDate">Start date</Label>
                    <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="daysCount">Generate doses for (days)</Label>
                    <Input id="daysCount" type="number" min="1" max="90" value={daysCount} onChange={(e) => setDaysCount(e.target.value)} />
                  </div>
                </div>

                {derivedTimes.length === 0 && (
                  <p className="text-sm text-destructive">No times derived. Please check your schedule or add custom times.</p>
                )}

                {error && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <Button
                variant="ghost"
                onClick={() => step === 0 ? setShowWizard(false) : setStep(s => s - 1)}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                {step === 0 ? 'Cancel' : 'Back'}
              </Button>
              {step < 2 ? (
                <Button
                  onClick={() => setStep(s => s + 1)}
                  disabled={step === 0 && (!pillName.trim() || !selectedDevice)}
                  className="gap-2"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={submit}
                  disabled={saving || derivedTimes.length === 0}
                  className="gap-2"
                >
                  {saving ? 'Creating…' : 'Create Schedule'}
                  <Calendar className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pill schedules list placeholder */}
      {!showWizard && !loading && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Active Medications</CardTitle>
            <CardDescription>Your current pill schedules</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Pill className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No medications added yet</p>
              <p className="text-xs text-muted-foreground/70">Click &quot;Add Medication&quot; above to get started.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

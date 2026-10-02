'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Pill, ArrowLeft, ArrowRight, Clock, Cpu, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getStoredToken } from '@/lib/client/auth';

type DeviceItem = {
  id: string;
  hardwareId: string;
  label?: string;
  status?: {
    setupDone?: boolean;
    setupMismatch?: boolean;
    detectedPills?: number;
    currentPills?: number;
    totalPills?: number;
    updatedAt?: string;
  };
};
type Schedule = { breakfast?: string; lunch?: string; dinner?: string; morningSnack?: string; afternoonSnack?: string; bedtime?: string };

type FrequencyType = 'daily_once' | 'twice_101' | 'thrice' | 'weekly' | 'custom';

type PillSchedule = {
  id: string;
  pillName: string;
  frequencyType: string;
  timesOfDay: string[];
  daysOfWeek: number[];
  startDate: string;
  createdAt: string;
  deviceId: string;
};

type CalStatusResponse = {
  step: string | null;
  completed: boolean;
  success: boolean;
  createdAt: string | null;
  expected?: number;
  detected?: number;
  current?: number;
  total?: number;
  message?: string;
};

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
  const [schedules, setSchedules] = useState<PillSchedule[]>([]);
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

  // Step 4 – calibration + verify
  const [calStep, setCalStep] = useState<'IDLE' | 'CLEAR_BOX' | 'PLACE_PILL' | 'DONE' | 'FAILED' | 'COUNT_VERIFIED' | 'COUNT_MISMATCH'>('IDLE');
  const [verifyState, setVerifyState] = useState<'IDLE' | 'CHECKING' | 'OK' | 'MISMATCH' | 'ERROR'>('IDLE');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [calFlowStartedAt, setCalFlowStartedAt] = useState<number>(0);
  const calPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const derivedTimes = deriveTimes(frequency, schedule, weekDay, customTimes);

  // Auto-compute daysCount from totalPills / dosesPerDay
  useEffect(() => {
    const n = Number(totalPills);
    if (!n || !derivedTimes.length) return;
    const days = frequency === 'weekly'
      ? n * 7
      : Math.floor(n / derivedTimes.length);
    setDaysCount(String(days));
  }, [totalPills, frequency, derivedTimes.length]);

  const fetchSchedules = (t: string) =>
    apiFetch<{ schedules: PillSchedule[] }>('/api/pill-schedules', t)
      .then((r) => setSchedules(r.schedules ?? []))
      .catch(() => {});

  function stopCalPolling() {
    if (calPollRef.current) {
      clearInterval(calPollRef.current);
      calPollRef.current = null;
    }
  }

  function handleCalStatus(status: CalStatusResponse) {
    if (!status.step) return;
    if (status.createdAt) {
      const eventTs = Date.parse(status.createdAt);
      if (Number.isFinite(eventTs) && eventTs < calFlowStartedAt) {
        return;
      }
    }
    const step = status.step as typeof calStep;
    if (
      step !== 'CLEAR_BOX' &&
      step !== 'PLACE_PILL' &&
      step !== 'DONE' &&
      step !== 'FAILED' &&
      step !== 'COUNT_VERIFIED' &&
      step !== 'COUNT_MISMATCH'
    ) {
      return;
    }

    setCalStep(step);

    if (step === 'DONE') {
      setVerifyState('IDLE');
      setVerifyMessage('Calibration completed: Yes. Load all pills, then verify.');
      return;
    }
    if (step === 'FAILED') {
      setVerifyState('ERROR');
      setVerifyMessage(status.message ?? 'Calibration completed: No. Retry calibration.');
      stopCalPolling();
      return;
    }
    if (step === 'COUNT_VERIFIED') {
      setVerifyState('OK');
      setVerifyMessage(
        status.message ??
        `Completed: Yes. Count verified: expected ${status.expected ?? '-'}, detected ${status.detected ?? '-'}. Proceed.`,
      );
      stopCalPolling();
      return;
    }
    if (step === 'COUNT_MISMATCH') {
      setVerifyState('MISMATCH');
      setVerifyMessage(
        status.message ??
        `Pill count mismatch. Expected ${status.expected ?? '-'}, detected ${status.detected ?? '-'}, current ${status.current ?? '-'}, total ${status.total ?? '-'}.`,
      );
      stopCalPolling();
    }
  }

  function startCalPolling() {
    if (!selectedDevice || !token) return;
    stopCalPolling();
    calPollRef.current = setInterval(async () => {
      try {
        const status = await apiFetch<CalStatusResponse>(`/api/devices/${selectedDevice}/cal-status`, token);
        handleCalStatus(status);
      } catch {
        // ignore polling failures
      }
    }, 1200);
  }

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    if (!t) return;
    Promise.all([
      apiFetch<{ devices: DeviceItem[] }>('/api/devices', t),
      apiFetch<{ schedule: Schedule | null }>('/api/schedule', t),
      apiFetch<{ schedules: PillSchedule[] }>('/api/pill-schedules', t),
    ])
      .then(([devRes, schRes, schListRes]) => {
        setDevices(devRes.devices ?? []);
        if (schRes.schedule) setSchedule(schRes.schedule);
        if (devRes.devices?.[0]) setSelectedDevice(devRes.devices[0].id);
        setSchedules(schListRes.schedules ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => () => stopCalPolling(), []);

  async function deleteSchedule(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/pill-schedules/${id}`, token, { method: 'DELETE' });
      await fetchSchedules(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error deleting schedule');
    }
  }

  async function submitSchedule() {
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
      closeWizardSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creating schedule');
    } finally {
      setSaving(false);
    }
  }

  function startCalibration() {
    if (!selectedDevice || !token) return;
    setCalFlowStartedAt(Date.now());
    setCalStep('CLEAR_BOX');
    setVerifyState('IDLE');
    setVerifyMessage('');
    startCalPolling();
    apiFetch(`/api/devices/${selectedDevice}/commands`, token, {
      method: 'POST',
      body: JSON.stringify({ command: 'CALIBRATE_ONE_PILL' }),
    })
      .then(() => {
        // wait for CAL_STATUS state machine updates from device
      })
      .catch(() => {
        setVerifyState('ERROR');
        setVerifyMessage('Failed to send calibration command to device.');
        stopCalPolling();
      });
  }

  async function verifyLoadedPills() {
    if (!selectedDevice || !token) return;
    const expected = Number(totalPills);
    if (!Number.isFinite(expected) || expected <= 0) {
      setVerifyState('ERROR');
      setVerifyMessage('Please enter a valid total pill count.');
      return;
    }

    setVerifyState('CHECKING');
    setVerifyMessage('Verifying loaded pill count...');
    setCalFlowStartedAt(Date.now());
    startCalPolling();

    try {
      await apiFetch(`/api/devices/${selectedDevice}/commands`, token, {
        method: 'POST',
        body: JSON.stringify({
          command: 'SET_CALIBRATION',
          payload: { pillWeight: 1, pillUnitMode: true, totalPills: expected, currentPills: expected },
        }),
      });
    } catch (e) {
      setVerifyState('ERROR');
      setVerifyMessage(e instanceof Error ? e.message : 'Verification failed');
      stopCalPolling();
    }
  }

  function resetWizardState() {
    setShowWizard(false);
    setStep(0);
    setPillName('');
    setTotalPills('30');
    setCalStep('IDLE');
    setVerifyState('IDLE');
    setVerifyMessage('');
    stopCalPolling();
  }

  function closeWizardSuccess() {
    setSuccess(`✓ ${pillName} schedule created! Doses generated for ${daysCount} days.`);
    resetWizardState();
    fetchSchedules(token);
  }

  function closeWizardWithoutSave() {
    setSuccess('');
    resetWizardState();
  }

  const steps = ['Pill Info', 'Frequency', 'Confirm', 'Load Pills'];

  const dosesPerDay = frequency === 'weekly' ? '1/7' : `${derivedTimes.length}`;

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
              {step < 3 && (
                  <Button variant="ghost" size="sm" onClick={closeWizardWithoutSave}>Cancel</Button>
              )}
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
                    {Number(totalPills) > 0 && derivedTimes.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Auto-computed from {totalPills} pills ÷ {dosesPerDay} dose/day
                      </p>
                    )}
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

            {/* Step 4 – Load Pills (calibration) */}
            {step === 3 && (
              <div className="space-y-5">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold">Load your pills</h3>
                  <p className="text-sm text-muted-foreground">
                    Calibrate the scale, then fill your box with all {totalPills} pills.
                  </p>
                </div>

                {calStep === 'IDLE' && (
                  <Button onClick={startCalibration} className="gap-2">
                    Start Calibration
                  </Button>
                )}

                {calStep === 'CLEAR_BOX' && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <Loader2 className="h-4 w-4 text-amber-400 mt-0.5 animate-spin shrink-0" />
                    <div>
                      <p className="text-sm text-amber-300">Calibration step: clear the box/scale.</p>
                      <p className="text-xs text-amber-200/90 mt-1">Completed: No</p>
                    </div>
                  </div>
                )}

                {calStep === 'PLACE_PILL' && (
                  <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                    <Loader2 className="h-4 w-4 text-blue-400 mt-0.5 animate-spin shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm text-blue-300">Place exactly 1 pill on the scale to calibrate.</p>
                      <p className="text-xs text-blue-200/90">Completed: No</p>
                    </div>
                  </div>
                )}

                {calStep === 'DONE' && (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm text-emerald-300">Calibration completed: Yes. Fill the box with all {totalPills} pills.</p>
                      <p className="text-xs text-emerald-200/90">Next: press Verify Loaded Pills.</p>
                      <Button onClick={verifyLoadedPills} className="gap-2" disabled={verifyState === 'CHECKING'}>
                        {verifyState === 'CHECKING' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Verify Loaded Pills
                      </Button>
                    </div>
                  </div>
                )}

                {calStep === 'FAILED' && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm text-destructive">Calibration completed: No.</p>
                        <p className="text-xs text-destructive/80 mt-1">{verifyMessage || 'Retry calibration.'}</p>
                      </div>
                    </div>
                    <Button variant="outline" onClick={startCalibration}>Retry Calibration</Button>
                  </div>
                )}

                {verifyState === 'MISMATCH' && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-300">{verifyMessage}</p>
                  </div>
                )}

                {verifyState === 'ERROR' && (
                  <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <p className="text-sm text-destructive">{verifyMessage}</p>
                  </div>
                )}

                {verifyState === 'OK' && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-emerald-300">{verifyMessage}</p>
                    </div>
                    <Button onClick={submitSchedule} className="gap-2" disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Create Schedule
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Navigation */}
            {step < 3 && (
              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <Button
                  variant="ghost"
                  onClick={() => step === 0 ? closeWizardWithoutSave() : setStep(s => s - 1)}
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
                  <Button onClick={() => setStep(3)} disabled={derivedTimes.length === 0} className="gap-2">
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Medications list */}
      {!showWizard && !loading && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Active Medications</CardTitle>
            <CardDescription>Your current pill schedules</CardDescription>
          </CardHeader>
          <CardContent>
            {schedules.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Pill className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">No medications added yet</p>
                <p className="text-xs text-muted-foreground/70">Click &quot;Add Medication&quot; above to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {schedules.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border/50 p-4">
                    <Pill className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{s.pillName}</p>
                      <p className="text-xs text-muted-foreground">
                        {FREQUENCY_OPTIONS.find((f) => f.id === s.frequencyType)?.label ?? s.frequencyType}
                        {' · '}
                        {devices.find((d) => d.id === s.deviceId)?.label ?? s.deviceId}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.timesOfDay.map((t) => (
                          <Badge key={t} variant="secondary" className="font-mono text-xs">{t}</Badge>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => deleteSchedule(s.id)}>
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

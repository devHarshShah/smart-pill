'use client';

import { useEffect, useState } from 'react';
import { Clock, Save, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getStoredToken } from '@/lib/client/auth';

type Schedule = {
  breakfast: string;
  morningSnack: string;
  lunch: string;
  afternoonSnack: string;
  dinner: string;
  bedtime: string;
};

const defaultSchedule: Schedule = {
  breakfast: '08:00',
  morningSnack: '10:30',
  lunch: '13:30',
  afternoonSnack: '16:00',
  dinner: '20:00',
  bedtime: '22:00',
};

const meals = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅', required: true, desc: 'Morning meal to start the day' },
  { key: 'morningSnack', label: 'Morning Snack', emoji: '🍎', required: false, desc: 'Optional mid-morning snack' },
  { key: 'lunch', label: 'Lunch', emoji: '☀️', required: true, desc: 'Midday meal' },
  { key: 'afternoonSnack', label: 'Afternoon Snack', emoji: '🫐', required: false, desc: 'Optional afternoon snack' },
  { key: 'dinner', label: 'Dinner', emoji: '🌙', required: true, desc: 'Evening meal' },
  { key: 'bedtime', label: 'Bedtime', emoji: '😴', required: false, desc: 'Optional bedtime routine' },
] as const;

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data;
}

export default function SchedulePage() {
  const [token, setToken] = useState('');
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    if (!t) return;
    apiFetch<{ schedule: Schedule | null }>('/api/schedule', t)
      .then((r) => {
        if (r.schedule) setSchedule({ ...defaultSchedule, ...r.schedule });
      })
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false));
  }, []);

  function set(key: keyof Schedule, value: string) {
    setSchedule((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/schedule', token, {
        method: 'POST',
        body: JSON.stringify(schedule),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily Schedule</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set your meal times so MediLink can automatically schedule medications for you.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          These times are used when adding medications with frequency presets like <strong className="text-foreground">1-0-1</strong> or <strong className="text-foreground">Twice daily</strong>. Dose times will be set to your meal time + 15 min buffer.
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" />
            Meal Times
          </CardTitle>
          <CardDescription>Set the times for each meal. Optional fields can be left empty.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {meals.map((meal) => (
                <div key={meal.key} className="flex items-center gap-4 rounded-lg border border-border/40 p-4 hover:border-border/70 transition-colors">
                  <span className="text-2xl">{meal.emoji}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{meal.label}</p>
                      {!meal.required && (
                        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">Optional</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{meal.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={meal.key} className="sr-only">{meal.label} time</Label>
                    <Input
                      id={meal.key}
                      type="time"
                      value={schedule[meal.key as keyof Schedule]}
                      onChange={(e) => set(meal.key as keyof Schedule, e.target.value)}
                      className="w-32 text-center"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={save} disabled={saving || loading} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save Schedule'}
            </Button>
            {saved && (
              <p className="text-sm text-emerald-400">✓ Schedule saved successfully</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clearStoredToken, getStoredToken } from '@/lib/client/auth';

type DeviceStatus = {
  wifiConnected?: boolean;
  ip?: string;
  rssi?: number;
  setupDone?: boolean;
  setupMismatch?: boolean;
  detectedPills?: number;
  pillWeight?: number;
  threshold?: number;
  confirmReads?: number;
  currentPills?: number;
  totalPills?: number;
  updatedAt?: string;
};

type DeviceItem = {
  id: string;
  hardwareId: string;
  label?: string;
  pairedAt?: string;
  status?: DeviceStatus;
};

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data;
}

function isOnline(updatedAt?: string): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < 30_000;
}

function PillBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const color = pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-400' : 'bg-emerald-500';
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-end justify-between">
        <span className="text-4xl font-bold tabular-nums text-slate-100">{current}</span>
        <span className="mb-1 text-sm text-slate-400">/ {total} pills</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-1 text-xs font-medium ${pct < 20 ? 'text-red-400' : pct < 50 ? 'text-yellow-400' : 'text-emerald-400'}`}>
        {pct}% remaining
      </p>
    </div>
  );
}

function DeviceCard({ device, token, onRefresh }: { device: DeviceItem; token: string; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [totalPills, setTotalPills] = useState('15');
  const [currentPills, setCurrentPills] = useState('15');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const online = isOnline(device.status?.updatedAt);
  const hasPillData = device.status?.currentPills != null && device.status?.totalPills != null;

  async function sendCommand(command: string, payload?: unknown) {
    setBusy(true);
    setMsg('');
    try {
      await apiFetch(`/api/devices/${device.id}/commands`, token, {
        method: 'POST',
        body: JSON.stringify({ command, payload }),
      });
      setMsg(`${command} queued.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function queueCalibration() {
    await sendCommand('SET_CALIBRATION', {
      pillWeight: 1,
      pillUnitMode: true,
      totalPills: Number(totalPills),
      currentPills: Number(currentPills),
    });
    onRefresh();
  }

  const updatedLabel = device.status?.updatedAt
    ? new Date(device.status.updatedAt).toLocaleTimeString()
    : null;

  return (
    <Card className="overflow-hidden border-slate-700 bg-slate-900">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-500'}`} />
            <CardTitle className="text-lg">{device.label ?? device.hardwareId}</CardTitle>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={online ? 'success' : undefined}>{online ? 'Online' : 'Offline'}</Badge>
            {device.status && !device.status.setupDone && (
              <Badge tone="warn">Setup needed</Badge>
            )}
            {device.status?.setupMismatch && (
              <Badge tone="warn">Count mismatch</Badge>
            )}
          </div>
        </div>
        {updatedLabel && (
          <p className="text-xs text-slate-500">Last update: {updatedLabel}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {hasPillData ? (
          <PillBar current={device.status!.currentPills!} total={device.status!.totalPills!} />
        ) : (
          <p className="text-sm text-slate-500">No pill data yet. Push calibration to get started.</p>
        )}

        <button
          className="flex w-full items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="select-none">{expanded ? '▾' : '▸'}</span>
          Setup &amp; Commands
        </button>

        {expanded && (
          <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-950 p-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Calibration</p>
              <p className="mb-3 text-xs text-slate-500">Step 1: place exactly 1 pill on the scale and click Calibrate. Step 2: set pill counts and click Apply. Do Step 1 first on a new device or after a physical reset.</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Total pills</Label>
                  <Input value={totalPills} onChange={(e) => setTotalPills(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Current pills</Label>
                  <Input value={currentPills} onChange={(e) => setCurrentPills(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button className="h-8 px-3 text-xs" variant="outline" onClick={() => sendCommand('CALIBRATE_ONE_PILL')} disabled={busy}>
                  Step 1: Calibrate (1 pill on scale)
                </Button>
                <Button className="h-8 px-3 text-xs" onClick={queueCalibration} disabled={busy}>
                  Step 2: Apply counts
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Quick Commands</p>
              <div className="flex flex-wrap gap-2">
                <Button className="h-8 px-3 text-xs" variant="outline" onClick={() => sendCommand('BUZZER_TEST', { times: 2 })} disabled={busy}>
                  Buzzer test
                </Button>
                <Button className="h-8 px-3 text-xs" variant="outline" onClick={() => sendCommand('LED_ON')} disabled={busy}>
                  LED on
                </Button>
                <Button className="h-8 px-3 text-xs" variant="outline" onClick={() => sendCommand('LED_OFF')} disabled={busy}>
                  LED off
                </Button>
              </div>
            </div>

            {msg && <p className="text-xs text-cyan-300">{msg}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [token, setToken] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [claimId, setClaimId] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    if (t) {
      // Decode email from JWT payload (base64)
      try {
        const payload = JSON.parse(atob(t.split('.')[1])) as { email?: string };
        setUserEmail(payload.email ?? '');
      } catch {}
    }
  }, []);

  async function fetchDevices(t: string) {
    try {
      const result = await apiFetch<{ devices: DeviceItem[] }>('/api/devices', t);
      setDevices(result.devices ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load devices');
    }
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchDevices(token).finally(() => setLoading(false));

    pollRef.current = setInterval(() => {
      void fetchDevices(token);
    }, 10_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token]);

  function logout() {
    clearStoredToken();
    setToken('');
    setDevices([]);
  }

  async function claimDevice() {
    if (!claimId.trim()) return;
    setClaiming(true);
    setClaimError('');
    try {
      await apiFetch('/api/pairing/claim', token, {
        method: 'POST',
        body: JSON.stringify({ hardwareId: claimId.trim() }),
      });
      setClaimId('');
      await fetchDevices(token);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Failed to pair device');
    } finally {
      setClaiming(false);
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-center">
          <p className="text-lg text-slate-400">Not logged in.</p>
          <a href="/auth?mode=login" className="mt-2 block text-cyan-400 hover:underline">Sign in →</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">MediLink</p>
            <h1 className="mt-0.5 text-2xl font-bold">Pill Monitor</h1>
            {userEmail && <p className="text-sm text-slate-400">{userEmail}</p>}
          </div>
          <Button variant="ghost" onClick={logout}>Logout</Button>
        </header>

        {error && <p className="rounded-lg bg-red-950 px-4 py-2 text-sm text-red-300">{error}</p>}

        {/* Devices */}
        {loading && devices.length === 0 ? (
          <p className="text-sm text-slate-400">Loading devices…</p>
        ) : devices.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
            <p className="text-lg font-semibold">No devices paired yet</p>
            <p className="mt-1 text-sm text-slate-400">Boot your ESP32 then enter its hardware ID below.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} token={token} onRefresh={() => fetchDevices(token)} />
            ))}
          </div>
        )}

        {/* Claim form */}
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
          <p className="mb-3 text-sm font-semibold text-slate-300">
            {devices.length === 0 ? 'Pair your device' : 'Pair another device'}
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Hardware ID (e.g. esp32-pillbox-001)"
              value={claimId}
              onChange={(e) => setClaimId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void claimDevice(); }}
              className="flex-1"
            />
            <Button onClick={() => void claimDevice()} disabled={claiming || !claimId.trim()}>
              {claiming ? 'Pairing…' : 'Pair Device'}
            </Button>
          </div>
          {claimError && <p className="mt-2 text-xs text-red-400">{claimError}</p>}
        </div>

      </div>
    </main>
  );
}

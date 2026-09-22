'use client';

import { useEffect, useRef, useState } from 'react';
import { Cpu, Plus, RefreshCw, Settings2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { getStoredToken } from '@/lib/client/auth';

type DeviceStatus = {
  wifiConnected?: boolean; ip?: string; rssi?: number;
  setupDone?: boolean; setupMismatch?: boolean;
  detectedPills?: number; pillWeight?: number; threshold?: number;
  confirmReads?: number; currentPills?: number; totalPills?: number;
  updatedAt?: string;
};
type DeviceItem = {
  id: string; hardwareId: string; label?: string; pairedAt?: string;
  status?: DeviceStatus;
  upcomingDoses?: Array<{ id: string; pillName: string; scheduledAt: string; requiredPills: number; alertTriggeredAt?: string | null }>;
};

function isOnline(updatedAt?: string) {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < 30_000;
}

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data;
}

function PillBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-end justify-between">
        <span className="text-3xl font-bold tabular-nums">{current}</span>
        <span className="mb-1 text-xs text-muted-foreground">/ {total} pills</span>
      </div>
      <Progress value={pct} className="h-2" />
      <p className={`text-xs font-medium ${pct < 20 ? 'text-destructive' : pct < 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
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
    setBusy(true); setMsg('');
    try {
      await apiFetch(`/api/devices/${device.id}/commands`, token, { method: 'POST', body: JSON.stringify({ command, payload }) });
      setMsg(`✓ ${command} queued`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  async function queueCalibration() {
    await sendCommand('SET_CALIBRATION', { pillWeight: 1, pillUnitMode: true, totalPills: Number(totalPills), currentPills: Number(currentPills) });
    onRefresh();
  }

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${online ? 'bg-emerald-400 shadow-[0_0_8px_theme(colors.emerald.400)]' : 'bg-muted-foreground/40'}`} />
            <CardTitle className="text-base">{device.label ?? device.hardwareId}</CardTitle>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={online ? 'default' : 'secondary'}>{online ? 'Online' : 'Offline'}</Badge>
            {device.status && !device.status.setupDone && <Badge variant="outline" className="border-amber-500/50 text-amber-400">Setup needed</Badge>}
            {device.status?.setupMismatch && <Badge variant="outline" className="border-amber-500/50 text-amber-400">Count mismatch</Badge>}
          </div>
        </div>
        {device.status?.updatedAt && (
          <p className="text-xs text-muted-foreground">Last seen: {new Date(device.status.updatedAt).toLocaleTimeString()}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {hasPillData ? (
          <PillBar current={device.status!.currentPills!} total={device.status!.totalPills!} />
        ) : (
          <p className="text-sm text-muted-foreground">No pill data. Push calibration to start.</p>
        )}

        <button
          className="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(v => !v)}
        >
          <Settings2 className="h-3 w-3" />
          <span>{expanded ? 'Hide' : 'Show'} Setup & Commands</span>
        </button>

        {expanded && (
          <div className="space-y-4 rounded-xl border border-border/50 bg-muted/20 p-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Calibration</p>
              <p className="mb-3 text-xs text-muted-foreground">Step 1: place 1 pill on scale → Calibrate. Step 2: set counts → Apply.</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="space-y-1">
                  <Label className="text-xs">Total pills</Label>
                  <Input value={totalPills} onChange={e => setTotalPills(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Current pills</Label>
                  <Input value={currentPills} onChange={e => setCurrentPills(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => sendCommand('CALIBRATE_ONE_PILL')} disabled={busy}>Step 1: Calibrate</Button>
                <Button size="sm" onClick={queueCalibration} disabled={busy}>Step 2: Apply counts</Button>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Commands</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => sendCommand('BUZZER_TEST', { times: 2 })} disabled={busy}><Zap className="h-3 w-3 mr-1" />Buzzer</Button>
                <Button size="sm" variant="outline" onClick={() => sendCommand('LED_ON')} disabled={busy}>LED On</Button>
                <Button size="sm" variant="outline" onClick={() => sendCommand('LED_OFF')} disabled={busy}>LED Off</Button>
              </div>
            </div>

            {msg && <p className="text-xs text-primary">{msg}</p>}
          </div>
        )}

        {(device.upcomingDoses?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upcoming doses</p>
            {device.upcomingDoses!.slice(0, 3).map(dose => (
              <div key={dose.id} className="flex items-center gap-2 rounded-lg border border-border/30 px-3 py-1.5">
                <span className="text-xs font-medium flex-1">{dose.pillName}</span>
                <span className="text-xs text-muted-foreground">{new Date(dose.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {dose.alertTriggeredAt && <span className="text-xs text-amber-400">alert sent</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DevicesPage() {
  const [token, setToken] = useState('');
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimId, setClaimId] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchDevices(t: string) {
    try {
      const result = await apiFetch<{ devices: DeviceItem[] }>('/api/devices', t);
      setDevices(result.devices ?? []);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    if (!t) return;
    fetchDevices(t).finally(() => setLoading(false));
    pollRef.current = setInterval(() => void fetchDevices(t), 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function claimDevice() {
    if (!claimId.trim()) return;
    setClaiming(true); setClaimError('');
    try {
      await apiFetch('/api/pairing/claim', token, { method: 'POST', body: JSON.stringify({ hardwareId: claimId.trim() }) });
      setClaimId('');
      await fetchDevices(token);
    } catch (e) { setClaimError(e instanceof Error ? e.message : 'Failed to pair'); }
    finally { setClaiming(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your paired ESP32 pill monitors.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchDevices(token)} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : devices.length === 0 ? (
        <Card className="border-border/50 border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Cpu className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-base font-semibold">No devices paired yet</p>
            <p className="text-sm text-muted-foreground">Boot your ESP32 and enter its Hardware ID below to pair.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {devices.map(d => <DeviceCard key={d.id} device={d} token={token} onRefresh={() => fetchDevices(token)} />)}
        </div>
      )}

      {/* Pair new device */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-primary" />
            {devices.length === 0 ? 'Pair Your Device' : 'Pair Another Device'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Hardware ID (e.g. esp32-pillbox-001)"
              value={claimId}
              onChange={e => setClaimId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void claimDevice(); }}
              className="flex-1"
            />
            <Button onClick={() => void claimDevice()} disabled={claiming || !claimId.trim()}>
              {claiming ? 'Pairing…' : 'Pair Device'}
            </Button>
          </div>
          {claimError && <p className="mt-2 text-xs text-destructive">{claimError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

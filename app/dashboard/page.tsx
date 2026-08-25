'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { clearStoredToken, getStoredToken } from '@/lib/client/auth';

type DeviceItem = {
  id: string;
  hardwareId: string;
  label?: string;
  pairedAt?: string;
  status?: {
    wifiConnected?: boolean;
    ip?: string;
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
};

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  return data;
}

export default function DashboardPage() {
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState('pilot@medilink.local');
  const [deviceSecret, setDeviceSecret] = useState('esp32-secret-001');
  const [hardwareId, setHardwareId] = useState('esp32-pillbox-001');
  const [label, setLabel] = useState('Kitchen Pill Box');

  const [pairCode, setPairCode] = useState('');
  const [pairCodeGenerated, setPairCodeGenerated] = useState('');

  const [command, setCommand] = useState('BUZZER_TEST');
  const [commandPayload, setCommandPayload] = useState('{"times":2}');

  const [pillWeight, setPillWeight] = useState('0.52');
  const [totalPills, setTotalPills] = useState('15');
  const [currentPills, setCurrentPills] = useState('15');

  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    const nextToken = getStoredToken();
    setToken(nextToken);
  }, []);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function autoLoadDevices() {
      setLoading(true);
      try {
        const result = await requestJson<{ devices: DeviceItem[] }>('/api/devices', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (cancelled) return;
        setDevices(result.devices ?? []);
        if ((result.devices?.length ?? 0) > 0 && !activeDeviceId) {
          setActiveDeviceId(result.devices[0].id);
        }
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : 'Failed to load devices');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void autoLoadDevices();

    return () => {
      cancelled = true;
    };
  }, [token, activeDeviceId]);

  async function runAction(action: () => Promise<void>) {
    setLoading(true);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  async function refreshDevices() {
    if (!token) {
      setMessage('Please login first.');
      return;
    }

    await runAction(async () => {
      const result = await requestJson<{ devices: DeviceItem[] }>('/api/devices', {
        method: 'GET',
        headers: authHeaders,
      });

      setDevices(result.devices ?? []);
      if ((result.devices?.length ?? 0) > 0 && !activeDeviceId) {
        setActiveDeviceId(result.devices[0].id);
      }
      setMessage(`Loaded ${result.devices?.length ?? 0} device(s).`);
    });
  }

  async function registerDevice() {
    await runAction(async () => {
      await requestJson('/api/devices/register', {
        method: 'POST',
        body: JSON.stringify({ hardwareId, deviceSecret, label }),
      });
      setMessage('Device identity registered.');
    });
  }

  async function createPairCode() {
    if (!token) {
      setMessage('Please login first.');
      return;
    }

    await runAction(async () => {
      const result = await requestJson<{ pairSession: { code: string } }>('/api/pairing/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ hardwareId }),
      });

      setPairCodeGenerated(result.pairSession.code);
      setPairCode(result.pairSession.code);
      setMessage('Pair code generated.');
    });
  }

  async function confirmPairing() {
    await runAction(async () => {
      await requestJson('/api/pairing/confirm', {
        method: 'POST',
        body: JSON.stringify({ hardwareId, deviceSecret, pairCode }),
      });
      setMessage('Pairing confirmed for this device.');
      await refreshDevices();
    });
  }

  async function queueSetupCommand() {
    if (!token || !activeDeviceId) {
      setMessage('Select a paired device first.');
      return;
    }

    await runAction(async () => {
      await requestJson(`/api/devices/${activeDeviceId}/commands`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          command: 'SET_CALIBRATION',
          payload: {
            pillWeight: Number(pillWeight),
            pillUnitMode: true,
            totalPills: Number(totalPills),
            currentPills: Number(currentPills),
          },
        }),
      });
      setMessage('Setup command queued. Device will apply on next poll.');
    });
  }

  async function queueOnePillCalibration() {
    if (!token || !activeDeviceId) {
      setMessage('Select a paired device first.');
      return;
    }

    await runAction(async () => {
      await requestJson(`/api/devices/${activeDeviceId}/commands`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          command: 'CALIBRATE_ONE_PILL',
        }),
      });
      setMessage('CALIBRATE_ONE_PILL queued. Place exactly one pill on the scale.');
    });
  }

  async function queueCustomCommand() {
    if (!token || !activeDeviceId) {
      setMessage('Select a paired device first.');
      return;
    }

    await runAction(async () => {
      let payload: unknown = undefined;
      if (commandPayload.trim()) {
        payload = JSON.parse(commandPayload);
      }

      await requestJson(`/api/devices/${activeDeviceId}/commands`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ command, payload }),
      });
      setMessage('Command queued.');
    });
  }

  function logout() {
    clearStoredToken();
    setToken('');
    setMessage('Logged out.');
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">MediLink Dashboard</p>
            <h1 className="mt-1 text-2xl font-semibold">Pairing + Remote Setup</h1>
            <p className="mt-1 text-sm text-slate-400">Configure device onboarding and pill monitor settings without serial setup prompts.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/auth?mode=login"><Button variant="outline">Auth</Button></Link>
            <Button variant="secondary" onClick={refreshDevices} disabled={loading || !token}>Refresh Devices</Button>
            <Button variant="ghost" onClick={logout}>Logout</Button>
          </div>
        </section>

        {message ? <p className="text-sm text-cyan-300">{message}</p> : null}

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Device Identity</CardTitle>
              <CardDescription>Register the hardware ID and secret used by ESP32 firmware.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5"><Label>Email (for reference)</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Hardware ID</Label><Input value={hardwareId} onChange={(e) => setHardwareId(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Device Secret</Label><Input value={deviceSecret} onChange={(e) => setDeviceSecret(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
              <Button onClick={registerDevice} disabled={loading}>Register Device</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Pairing</CardTitle>
              <CardDescription>Generate and confirm pair code to lock device to your user.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={createPairCode} disabled={loading || !token}>Generate Pair Code</Button>
              <div className="rounded-md border border-cyan-700/50 bg-cyan-950/30 p-3 text-cyan-200">
                Latest pair code: <span className="font-semibold">{pairCodeGenerated || '-'}</span>
              </div>
              <div className="space-y-1.5"><Label>Pair Code</Label><Input value={pairCode} onChange={(e) => setPairCode(e.target.value.toUpperCase())} /></div>
              <Button onClick={confirmPairing} disabled={loading}>Confirm Pairing</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Device Setup (UI-Driven)</CardTitle>
              <CardDescription>Push calibration setup over server command queue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5"><Label>Active Device ID</Label><Input value={activeDeviceId} onChange={(e) => setActiveDeviceId(e.target.value)} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5"><Label>Pill Weight</Label><Input value={pillWeight} onChange={(e) => setPillWeight(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Total Pills</Label><Input value={totalPills} onChange={(e) => setTotalPills(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Current Pills</Label><Input value={currentPills} onChange={(e) => setCurrentPills(e.target.value)} /></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={queueOnePillCalibration} disabled={loading || !token}>Queue CALIBRATE_ONE_PILL</Button>
                <Button onClick={queueSetupCommand} disabled={loading || !token}>Queue SET_CALIBRATION</Button>
              </div>
              <p className="text-xs text-slate-400">
                Recommended flow: first queue <code>CALIBRATE_ONE_PILL</code> with one pill on scale, then set <code>pillWeight</code> to <code>1</code>.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Commands</CardTitle>
              <CardDescription>Send control commands like BUZZER_TEST, LED_ON, LED_OFF.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5"><Label>Command</Label><Input value={command} onChange={(e) => setCommand(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Payload JSON</Label><Textarea value={commandPayload} onChange={(e) => setCommandPayload(e.target.value)} /></div>
              <Button onClick={queueCustomCommand} disabled={loading || !token}>Queue Command</Button>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Paired Devices</CardTitle>
            <CardDescription>Current device list and latest runtime status reported by ESP32.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {devices.length === 0 ? (
                <p className="text-sm text-slate-400">No paired devices found yet.</p>
              ) : (
                devices.map((device) => (
                  <div key={device.id} className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-100">{device.label ?? device.hardwareId}</span>
                      <Badge>{device.id}</Badge>
                      <Badge tone={device.status?.wifiConnected ? 'success' : 'warn'}>
                        {device.status?.wifiConnected ? 'Wi-Fi online' : 'Wi-Fi offline'}
                      </Badge>
                      <Badge tone={device.status?.setupDone ? 'success' : 'warn'}>
                        {device.status?.setupDone ? 'Setup done' : 'Setup pending'}
                      </Badge>
                      {device.status?.setupMismatch ? <Badge tone="warn">Count mismatch</Badge> : null}
                    </div>
                    <p className="mt-1 text-slate-400">
                      hardwareId: {device.hardwareId} | current/total: {device.status?.currentPills ?? '-'} / {device.status?.totalPills ?? '-'}
                    </p>
                    <p className="text-slate-500">
                      detected: {device.status?.detectedPills ?? '-'} | pillWeight: {device.status?.pillWeight ?? '-'} | threshold: {device.status?.threshold ?? '-'} | confirmReads: {device.status?.confirmReads ?? '-'}
                    </p>
                    <p className="text-slate-500">last update: {device.status?.updatedAt ?? '-'}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

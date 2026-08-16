import { NextRequest } from 'next/server';

import { badRequest, json, readJson } from '@/lib/http';
import { updateDeviceRuntimeStatus } from '@/lib/services';

type DeviceStatusBody = {
  hardwareId?: string;
  deviceSecret?: string;
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
};

export async function POST(request: NextRequest) {
  const body = await readJson<DeviceStatusBody>(request);
  if (!body) {
    return badRequest('Invalid JSON body');
  }

  if (
    typeof body.hardwareId !== 'string' ||
    typeof body.deviceSecret !== 'string' ||
    typeof body.wifiConnected !== 'boolean' ||
    typeof body.setupDone !== 'boolean'
  ) {
    return badRequest('hardwareId, deviceSecret, wifiConnected, setupDone are required');
  }

  const result = await updateDeviceRuntimeStatus({
    hardwareId: body.hardwareId,
    deviceSecret: body.deviceSecret,
    wifiConnected: body.wifiConnected,
    ip: typeof body.ip === 'string' ? body.ip : undefined,
    rssi: typeof body.rssi === 'number' ? body.rssi : undefined,
    setupDone: body.setupDone,
    setupMismatch: typeof body.setupMismatch === 'boolean' ? body.setupMismatch : undefined,
    detectedPills: typeof body.detectedPills === 'number' ? body.detectedPills : undefined,
    pillWeight: typeof body.pillWeight === 'number' ? body.pillWeight : undefined,
    threshold: typeof body.threshold === 'number' ? body.threshold : undefined,
    confirmReads: typeof body.confirmReads === 'number' ? body.confirmReads : undefined,
    currentPills: typeof body.currentPills === 'number' ? body.currentPills : undefined,
    totalPills: typeof body.totalPills === 'number' ? body.totalPills : undefined,
  });

  if ('error' in result) {
    return badRequest(result.error ?? 'Status update failed');
  }

  return json(result);
}

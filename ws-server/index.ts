import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import http from 'http';

config({ path: '.env' });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PORT = 8070;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('MediLink WebSocket Server\n');
});

const wss = new WebSocketServer({ server });

interface DeviceClient extends WebSocket {
  deviceId?: string;
  hardwareId?: string;
  deviceSecret?: string;
  commandsSyncing?: boolean;
}

const clients = new Map<string, DeviceClient>(); // hardwareId -> WebSocket

async function getAndConsumeDeviceCommands(deviceId: string, ownerUserId: string) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const secondReminderThreshold = new Date(now.getTime() - 5 * 60 * 1000);

    const firstDueDose = await tx.deviceDose.findFirst({
      where: {
        deviceId,
        completedAt: null,
        alertTriggeredAt: null,
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    if (firstDueDose) {
      await tx.deviceCommand.create({
        data: {
          deviceId,
          userId: ownerUserId,
          command: 'REMINDER_START',
          payload: {
            doseId: firstDueDose.id,
            pillName: firstDueDose.pillName,
            requiredPills: firstDueDose.requiredPills,
            scheduledAt: firstDueDose.scheduledAt.toISOString(),
            reminderNumber: 1,
          },
        },
      });

      await tx.deviceDose.update({
        where: { id: firstDueDose.id },
        data: {
          alertTriggeredAt: now,
          lastReminderAt: now,
          reminderCount: 1,
        },
      });
    } else {
      const secondDueDose = await tx.deviceDose.findFirst({
        where: {
          deviceId,
          completedAt: null,
          alertTriggeredAt: { not: null },
          reminderCount: 1,
          lastReminderAt: { lte: secondReminderThreshold },
        },
        orderBy: { scheduledAt: 'asc' },
      });

      if (secondDueDose) {
        await tx.deviceCommand.create({
          data: {
            deviceId,
            userId: ownerUserId,
            command: 'REMINDER_START',
            payload: {
              doseId: secondDueDose.id,
              pillName: secondDueDose.pillName,
              requiredPills: secondDueDose.requiredPills,
              scheduledAt: secondDueDose.scheduledAt.toISOString(),
              reminderNumber: 2,
            },
          },
        });

        await tx.deviceDose.update({
          where: { id: secondDueDose.id },
          data: {
            lastReminderAt: now,
            reminderCount: { increment: 1 },
          },
        });
      }
    }

    const queued = await tx.deviceCommand.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'asc' },
    });

    if (queued.length > 0) {
      await tx.deviceCommand.deleteMany({ where: { deviceId } });
    }

    return queued;
  });
}

async function deliverPendingCommands(ws: DeviceClient) {
  if (!ws.deviceId || !ws.hardwareId || !ws.deviceSecret) return;
  if (ws.commandsSyncing) return;
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.commandsSyncing = true;
  try {
    const device = await prisma.device.findUnique({ where: { id: ws.deviceId } });
    if (!device) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Device not found' }));
      return;
    }
    if (device.deviceSecret !== ws.deviceSecret) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid device credentials' }));
      return;
    }
    if (!device.ownerUserId) return;

    const queued = await getAndConsumeDeviceCommands(device.id, device.ownerUserId);

    if (queued.length === 0) return;

    for (const command of queued) {
      ws.send(
        JSON.stringify({
          type: 'COMMAND',
          id: command.id,
          command: command.command,
          payload: command.payload,
        }),
      );
      console.log(`[WS] sent command ${command.command} to ${ws.hardwareId}`);
    }
  } catch (error) {
    console.error('Failed to deliver commands:', error);
  } finally {
    ws.commandsSyncing = false;
  }
}

wss.on('connection', (ws: DeviceClient) => {
  console.log('New WebSocket connection');

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('Received:', msg);

      if (msg.type === 'AUTH') {
        const { hardwareId, deviceSecret } = msg;
        const device = await prisma.device.findUnique({ where: { hardwareId } });
        if (device && device.deviceSecret === deviceSecret) {
          ws.deviceId = device.id;
          ws.hardwareId = hardwareId;
          ws.deviceSecret = deviceSecret;
          clients.set(hardwareId, ws);
          ws.send(JSON.stringify({ type: 'AUTH_OK' }));

          await deliverPendingCommands(ws);
        } else {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Auth failed' }));
          ws.close();
        }
      } 
      else if (msg.type === 'STATUS' && ws.deviceId) {
        await prisma.deviceRuntimeStatus.upsert({
          where: { deviceId: ws.deviceId },
          update: { 
            wifiConnected: !!msg.wifiConnected,
            ip: typeof msg.ip === 'string' ? msg.ip : null,
            rssi: typeof msg.rssi === 'number' ? msg.rssi : null,
            setupMismatch: !!msg.setupMismatch,
            detectedPills: typeof msg.detectedPills === 'number' ? msg.detectedPills : null,
            pillWeight: typeof msg.pillWeight === 'number' ? msg.pillWeight : null,
            threshold: typeof msg.threshold === 'number' ? msg.threshold : null,
            confirmReads: typeof msg.confirmReads === 'number' ? msg.confirmReads : null,
            currentPills: msg.currentPills,
            totalPills: msg.totalPills,
            setupDone: !!msg.setupDone,
            hardwareId: ws.hardwareId!,
          },
          create: {
            deviceId: ws.deviceId,
            hardwareId: ws.hardwareId!,
            wifiConnected: !!msg.wifiConnected,
            ip: typeof msg.ip === 'string' ? msg.ip : null,
            rssi: typeof msg.rssi === 'number' ? msg.rssi : null,
            setupMismatch: !!msg.setupMismatch,
            detectedPills: typeof msg.detectedPills === 'number' ? msg.detectedPills : null,
            pillWeight: typeof msg.pillWeight === 'number' ? msg.pillWeight : null,
            threshold: typeof msg.threshold === 'number' ? msg.threshold : null,
            confirmReads: typeof msg.confirmReads === 'number' ? msg.confirmReads : null,
            currentPills: msg.currentPills,
            totalPills: msg.totalPills,
            setupDone: !!msg.setupDone,
          }
        });
        await deliverPendingCommands(ws);
      }
      else if (msg.type === 'DOSE_EVENT' && ws.deviceId) {
        const payload = msg.payload || {};
        const doseId = payload.doseId;
        if (doseId) {
          await prisma.deviceDose.updateMany({
            where: { id: doseId, deviceId: ws.deviceId, completedAt: null },
            data: { completedAt: new Date(), takenPills: payload.takenPills },
          });
        }
        await prisma.deviceEvent.create({
          data: {
            deviceId: ws.deviceId,
            type: msg.event || 'DOSE_EVENT',
            payload: payload
          }
        });
        await deliverPendingCommands(ws);
      }
      else if (msg.type === 'CAL_STATUS' && ws.deviceId) {
        const payload: Record<string, Prisma.InputJsonValue> = { step: String(msg.step) };
        if (typeof msg.expected === 'number') payload.expected = msg.expected;
        if (typeof msg.detected === 'number') payload.detected = msg.detected;
        if (typeof msg.current === 'number') payload.current = msg.current;
        if (typeof msg.total === 'number') payload.total = msg.total;
        if (typeof msg.message === 'string') payload.message = msg.message;

        await prisma.deviceEvent.create({
          data: {
            deviceId: ws.deviceId,
            type: 'CAL_STATUS',
            payload: payload as Prisma.InputJsonValue,
          },
        });
      }
    } catch (e) {
      console.error('WebSocket Error:', e);
    }
  });

  ws.on('close', async () => {
    if (ws.hardwareId) {
      clients.delete(ws.hardwareId);
      if (ws.deviceId) {
        await prisma.deviceRuntimeStatus.updateMany({
          where: { deviceId: ws.deviceId },
          data: { wifiConnected: false }
        });
      }
      console.log(`Device ${ws.hardwareId} disconnected`);
    }
  });
});

setInterval(() => {
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      c.ping();
    }
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`WebSocket Server listening on port ${PORT}`);
});

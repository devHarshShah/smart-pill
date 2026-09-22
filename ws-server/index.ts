import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import http from 'http';

config({ path: '.env' });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PORT = 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('MediLink WebSocket Server\n');
});

const wss = new WebSocketServer({ server });

interface DeviceClient extends WebSocket {
  deviceId?: string;
  hardwareId?: string;
}

const clients = new Map<string, DeviceClient>(); // hardwareId -> WebSocket

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
          clients.set(hardwareId, ws);
          ws.send(JSON.stringify({ type: 'AUTH_OK' }));
          
          // Polling pending commands immediately upon auth
          const pending = await prisma.deviceCommand.findMany({ where: { deviceId: device.id }, orderBy: { createdAt: 'asc' } });
          const commands = pending.map(c => ({ id: c.id, command: c.command, payload: c.payload }));
          if (commands.length > 0) {
            ws.send(JSON.stringify({ type: 'COMMANDS', commands }));
            await prisma.deviceCommand.deleteMany({ where: { deviceId: device.id } });
          }
        } else {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Auth failed' }));
          ws.close();
        }
      } 
      else if (msg.type === 'STATUS' && ws.deviceId) {
        await prisma.deviceRuntimeStatus.upsert({
          where: { deviceId: ws.deviceId },
          update: { 
            wifiConnected: true,
            currentPills: msg.currentPills,
            totalPills: msg.totalPills,
            setupDone: msg.setupDone,
          },
          create: {
            deviceId: ws.deviceId,
            hardwareId: ws.hardwareId!,
            wifiConnected: true,
            currentPills: msg.currentPills,
            totalPills: msg.totalPills,
            setupDone: msg.setupDone,
          }
        });
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

setInterval(async () => {
  // Push pending commands logic could go here, or handled via API triggers
  // For simplicity, we just broadcast ping
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.ping();
    }
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`WebSocket Server listening on port ${PORT}`);
});

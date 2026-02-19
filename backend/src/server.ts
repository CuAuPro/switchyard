import http from 'http';
import { WebSocketServer } from 'ws';

import app from './app.js';
import { env } from './config/env.js';
import { bootstrapHealthMonitor } from './jobs/healthMonitor.js';
import { regenerateCaddyfile } from './lib/caddyfile.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';
import { eventBus } from './utils/eventBus.js';

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  const listener = (event: unknown) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  };
  eventBus.on('message', listener);
  socket.on('close', () => {
    eventBus.off('message', listener);
  });
});

server.listen(env.port, () => {
  console.log(`Switchyard API running on port ${env.port}`);
  bootstrapHealthMonitor();
  regenerateCaddyfile()
    .then(() => console.log('[CADDY] Router synchronized on startup'))
    .catch((error) => console.error('[CADDY] Failed to push router on startup', error));
});

const shutdown = async () => {
  console.log('Shutting down Switchyard API');
  server.close();
  wss.close();
  await disconnectPrisma();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

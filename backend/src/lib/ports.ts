import net from 'net';

import { env } from '../config/env.js';

const checkPort = (port: number) =>
  new Promise<boolean>((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => {
      tester.close();
      resolve(false);
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '0.0.0.0');
  });

export const isPortAvailable = (port: number) => checkPort(port);

export const findAvailablePort = async (used: Set<number>) => {
  const start = env.portRangeStart;
  const end = env.portRangeEnd;
  for (let port = start; port <= end; port += 1) {
    if (used.has(port)) continue;
    // skip reserved ports outside positive range
    if (port < 1 || port > 65535) continue;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports in range ${start}-${end}`);
};

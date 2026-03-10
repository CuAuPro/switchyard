import { execFile } from 'child_process';
import os from 'os';
import { promisify } from 'util';

import { parseEnvironmentMetadata } from '../lib/environmentMetadata.js';
import { prisma } from '../lib/prisma.js';

const execFileAsync = promisify(execFile);

type ContainerRuntimeState = 'running' | 'stopped' | 'missing';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const toNumber = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePercent = (value: string | undefined) => {
  if (!value) return null;
  return toNumber(value.replace('%', '').trim());
};

const sampleCpuUsagePercent = async () => {
  const start = os.cpus();
  await sleep(150);
  const end = os.cpus();

  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < Math.min(start.length, end.length); i += 1) {
    const a = start[i]?.times;
    const b = end[i]?.times;
    if (!a || !b) continue;
    const idle = b.idle - a.idle;
    const total =
      b.user +
      b.nice +
      b.sys +
      b.irq +
      b.idle -
      (a.user + a.nice + a.sys + a.irq + a.idle);
    idleDelta += idle;
    totalDelta += total;
  }
  if (totalDelta <= 0) return null;
  return Number((((totalDelta - idleDelta) / totalDelta) * 100).toFixed(2));
};

const readDiskUsage = async () => {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', '/']);
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const data = lines[1];
    if (!data) {
      return { totalBytes: null, usedBytes: null, availableBytes: null };
    }
    const cols = data.split(/\s+/);
    const totalKb = toNumber(cols[1]);
    const usedKb = toNumber(cols[2]);
    const availableKb = toNumber(cols[3]);
    if (totalKb === null || usedKb === null || availableKb === null) {
      return { totalBytes: null, usedBytes: null, availableBytes: null };
    }
    return {
      totalBytes: totalKb * 1024,
      usedBytes: usedKb * 1024,
      availableBytes: availableKb * 1024,
    };
  } catch {
    return { totalBytes: null, usedBytes: null, availableBytes: null };
  }
};

const inspectContainerState = async (containerName: string): Promise<ContainerRuntimeState> => {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{.State.Status}}', containerName]);
    const status = stdout.trim().toLowerCase();
    if (status === 'running') return 'running';
    return 'stopped';
  } catch {
    return 'missing';
  }
};

const readDockerStats = async (containerName: string) => {
  try {
    const { stdout } = await execFileAsync('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}',
      containerName,
    ]);
    const line = stdout.trim().split('\n')[0] ?? '';
    const [cpuRaw, memUsage = '', memPercRaw, netIo = '', blockIo = '', pidsRaw] = line.split('|');
    return {
      cpuPercent: parsePercent(cpuRaw),
      memUsage: memUsage.trim() || null,
      memPercent: parsePercent(memPercRaw),
      netIO: netIo.trim() || null,
      blockIO: blockIo.trim() || null,
      pids: toNumber(pidsRaw?.trim()),
    };
  } catch {
    return {
      cpuPercent: null,
      memUsage: null,
      memPercent: null,
      netIO: null,
      blockIO: null,
      pids: null,
    };
  }
};

const sanitizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
const buildContainerName = (serviceName: string, label: string) =>
  `switchyard-${sanitizeName(serviceName)}-${sanitizeName(label)}`;

export const getSystemStats = async () => {
  const [cpuUsagePercent, diskUsage] = await Promise.all([sampleCpuUsagePercent(), readDiskUsage()]);
  const services = await prisma.service.findMany({
    select: {
      id: true,
      name: true,
      environments: {
        select: {
          id: true,
          label: true,
          dockerImage: true,
          metadata: true,
        },
      },
    },
  });

  const containers = await Promise.all(
    services.flatMap((service) =>
      service.environments.map(async (environment) => {
        const metadata = parseEnvironmentMetadata(environment.metadata);
        const containerName = metadata.containerName ?? buildContainerName(service.name, environment.label);
        const runtimeState = await inspectContainerState(containerName);
        const dockerStats =
          runtimeState === 'running'
            ? await readDockerStats(containerName)
            : {
                cpuPercent: null,
                memUsage: null,
                memPercent: null,
                netIO: null,
                blockIO: null,
                pids: null,
              };
        return {
          serviceId: service.id,
          serviceName: service.name,
          environmentId: environment.id,
          environmentLabel: environment.label,
          containerName,
          dockerImage: environment.dockerImage,
          state: runtimeState,
          ...dockerStats,
        };
      }),
    ),
  );

  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
  const memoryUsagePercent =
    totalMemoryBytes > 0 ? Number(((usedMemoryBytes / totalMemoryBytes) * 100).toFixed(2)) : null;

  return {
    timestamp: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      uptimeSeconds: Math.floor(os.uptime()),
      cpu: {
        cores: os.cpus().length,
        usagePercent: cpuUsagePercent,
        loadAverage: {
          oneMinute: os.loadavg()[0] ?? 0,
          fiveMinutes: os.loadavg()[1] ?? 0,
          fifteenMinutes: os.loadavg()[2] ?? 0,
        },
      },
      memory: {
        totalBytes: totalMemoryBytes,
        usedBytes: usedMemoryBytes,
        freeBytes: freeMemoryBytes,
        usagePercent: memoryUsagePercent,
      },
      disk: diskUsage,
    },
    docker: {
      containers,
    },
  };
};


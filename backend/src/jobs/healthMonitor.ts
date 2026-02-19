import { EnvironmentStatus, Prisma } from '@prisma/client';
import fetch from 'node-fetch';

import { env as config } from '../config/env.js';
import { parseEnvironmentMetadata } from '../lib/environmentMetadata.js';
import { prisma } from '../lib/prisma.js';
import { recordHealth, switchEnvironment } from '../services/serviceRegistry.js';

const SYSTEM_ACTOR = { id: 'system', role: 'admin' as const };

const normalizeHealthPath = (healthEndpoint?: string | null) => {
  if (!healthEndpoint) return null;
  if (/^https?:\/\//i.test(healthEndpoint)) {
    return healthEndpoint;
  }
  return healthEndpoint.startsWith('/') ? healthEndpoint : `/${healthEndpoint}`;
};

const resolveHealthTargets = (
  environment: { targetUrl: string; metadata: Prisma.JsonValue | null },
  serviceHealthEndpoint?: string | null,
) => {
  const normalized = normalizeHealthPath(serviceHealthEndpoint);
  if (!normalized) {
    return [];
  }

  if (/^https?:\/\//i.test(normalized)) {
    return [normalized];
  }

  const metadata = parseEnvironmentMetadata(environment.metadata);
  const targets: string[] = [];
  const hostBase = config.routerTargetHost.replace(/\/$/, '');
  const normalizedTargetUrl = environment.targetUrl?.replace(/\/$/, '');

  if (config.healthUseContainerTargets && metadata.containerName && metadata.appPort) {
    targets.push(`http://${metadata.containerName}:${metadata.appPort}${normalized}`);
  }

  if (metadata.hostPort) {
    targets.push(`${hostBase}:${metadata.hostPort}${normalized}`);
  }

  if (normalizedTargetUrl) {
    targets.push(`${normalizedTargetUrl}${normalized}`);
  }

  return Array.from(new Set(targets));
};

const checkEnvironment = async (
  environment: { id: string; targetUrl: string; metadata: Prisma.JsonValue | null },
  serviceHealthEndpoint?: string | null,
) => {
  const urls = resolveHealthTargets(environment, serviceHealthEndpoint);
  if (urls.length === 0) {
    await recordHealth(environment.id, EnvironmentStatus.unknown, undefined);
    return false;
  }

  let lastLatency: number | undefined;
  let lastStatus: EnvironmentStatus | null = null;

  for (const url of urls) {
    const start = Date.now();
    try {
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      lastLatency = Date.now() - start;
      if (response.ok) {
        await recordHealth(environment.id, EnvironmentStatus.healthy, lastLatency);
        return true;
      }
      lastStatus = EnvironmentStatus.degraded;
    } catch {
      lastStatus = EnvironmentStatus.unhealthy;
    }
  }

  await recordHealth(environment.id, lastStatus ?? EnvironmentStatus.unhealthy, lastLatency);
  return false;
};

const run = async () => {
  const services = await prisma.service.findMany({
    include: { environments: true },
  });
  for (const service of services) {
    for (const environment of service.environments) {
      const metadata = (environment.metadata as Prisma.JsonObject | null) ?? null;
      const containerState =
        metadata?.containerState === 'running' ? 'running' : 'stopped';
      if (containerState !== 'running') {
        await recordHealth(environment.id, EnvironmentStatus.unknown, undefined);
        continue;
      }
      const healthy = await checkEnvironment(environment, service.healthEndpoint);
      if (!healthy && environment.isActive) {
        const fallback = service.environments.find((env) => env.id !== environment.id && env.status === EnvironmentStatus.healthy);
        if (fallback) {
          await switchEnvironment(
            { serviceId: service.id, toLabel: fallback.label, reason: 'Automated health failover', initiatedBy: SYSTEM_ACTOR.id },
            SYSTEM_ACTOR,
          );
        }
      }
    }
  }
};

export const bootstrapHealthMonitor = () => {
  const tick = () => {
    void run().catch((error) => console.error('Health monitor error', error));
  };
  tick();
  setInterval(tick, config.healthCheckIntervalMs);
};

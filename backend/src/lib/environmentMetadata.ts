import type { Prisma } from '@prisma/client';

export type ContainerState = 'running' | 'stopped';

export type EnvironmentMetadata = {
  hostPort?: number;
  appPort?: number;
  containerState?: ContainerState;
  containerName?: string;
  envVars?: Record<string, string>;
};

export const parseEnvironmentMetadata = (
  metadata: Prisma.JsonValue | null | undefined,
): EnvironmentMetadata => {
  const value = (metadata as Prisma.JsonObject | null) ?? null;
  const hostPort = typeof value?.hostPort === 'number' ? value.hostPort : undefined;
  const appPort = typeof value?.appPort === 'number' ? value.appPort : undefined;
  const containerState =
    value?.containerState === 'running' || value?.containerState === 'stopped'
      ? value.containerState
      : undefined;
  const containerName = typeof value?.containerName === 'string' ? value.containerName : undefined;
  let envVars: Record<string, string> | undefined;
  if (value?.envVars && typeof value.envVars === 'object' && !Array.isArray(value.envVars)) {
    const parsed: Record<string, string> = {};
    for (const [key, envValue] of Object.entries(value.envVars as Record<string, unknown>)) {
      if (key && typeof envValue === 'string') {
        parsed[key] = envValue;
      }
    }
    if (Object.keys(parsed).length > 0) {
      envVars = parsed;
    }
  }
  return { hostPort, appPort, containerState, containerName, envVars };
};

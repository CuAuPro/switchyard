import type { Prisma } from '@prisma/client';

export type ContainerState = 'running' | 'stopped';

export type EnvironmentMetadata = {
  hostPort?: number;
  appPort?: number;
  containerState?: ContainerState;
  containerName?: string;
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
  return { hostPort, appPort, containerState, containerName };
};

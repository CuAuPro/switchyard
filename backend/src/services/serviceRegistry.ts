import prismaPkg from '@prisma/client';
import type {
  ActivityEvent,
  Deployment as DeploymentModel,
  EnvironmentStatus as EnvironmentStatusType,
  Prisma,
  Role,
  Service as ServiceModel,
  ServiceEnvironment,
  SwitchEvent,
  User,
} from '@prisma/client';

import { env as envConfig } from '../config/env.js';
import { regenerateCaddyfile } from '../lib/caddyfile.js';
import {
  ensureDockerContainer,
  getDockerContainerState,
  removeDockerContainer,
  stopDockerContainer,
} from '../lib/docker.js';
import { parseEnvironmentMetadata, ContainerState } from '../lib/environmentMetadata.js';
import { findAvailablePort, isPortAvailable } from '../lib/ports.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/errorHandler.js';
import { eventBus } from '../utils/eventBus.js';

const { DeploymentStatus, EnvironmentStatus } = prismaPkg;
type ServiceInput = {
  name: string;
  description?: string;
  repositoryUrl?: string;
  healthEndpoint?: string;
  environments: Array<{
    label: string;
    dockerImage: string;
    appPort?: number;
    weightPercent?: number;
  }>;
};

type DeploymentInput = {
  serviceId: string;
  environmentLabel: string;
  version: string;
  dockerImage: string;
  metadata?: Record<string, unknown>;
  initiatedById?: string;
};

type SwitchInput = {
  serviceId: string;
  toLabel: string;
  reason?: string;
  initiatedBy?: string;
};

type EnvironmentUpdateInput = {
  label: string;
  dockerImage?: string;
  appPort?: number;
};

type UpdateServiceInput = {
  serviceId: string;
  description?: string;
  repositoryUrl?: string;
  healthEndpoint?: string;
  environments?: EnvironmentUpdateInput[];
};

type EnvironmentToggleInput = {
  serviceId: string;
  environmentLabel: string;
};

const activityInclude = {
  environment: { select: { id: true, label: true } },
} as const;

const serviceInclude = {
  environments: true,
  deployments: {
    take: 10,
    orderBy: { createdAt: 'desc' as const },
  },
  activities: {
    take: 25,
    orderBy: { createdAt: 'desc' as const },
    include: activityInclude,
  },
} satisfies Prisma.ServiceInclude;

type ActivityEventWithRelations = Prisma.ActivityEventGetPayload<{ include: typeof activityInclude }>;
type ServiceWithRelations = Prisma.ServiceGetPayload<{ include: typeof serviceInclude }>;

type ActivityActor = { id?: string; role?: Role };

type ActorUser = Pick<User, 'id' | 'role'> & Partial<Pick<User, 'email' | 'name'>>;

type LogActivityInput = {
  serviceId: string;
  environmentId?: string;
  actor?: ActivityActor;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
};

const logActivity = async ({ serviceId, environmentId, actor, type, message, metadata }: LogActivityInput) => {
  try {
    await prisma.activityEvent.create({
      data: {
        serviceId,
        environmentId,
        actorId: actor?.id,
        actorRole: actor?.role,
        type,
        message,
        metadata: metadata ? (metadata as Prisma.JsonObject) : prismaPkg.Prisma.DbNull,
      },
    });
  } catch (error) {
    console.error('[ACTIVITY] Failed to record event', { serviceId, type, error });
  }
};

const requireRole = (role: Role, allowed: Role[]) => {
  if (!allowed.includes(role)) {
    throw new HttpError(403, 'Insufficient permissions');
  }
};

const safeRegenerateCaddy = async (context: string) => {
  try {
    await regenerateCaddyfile();
  } catch (error) {
    console.error(`[CADDY] Failed to regenerate after ${context}`, error);
  }
};

const sanitizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, '-');

const buildContainerName = (serviceName: string, label: string) =>
  `switchyard-${sanitizeName(serviceName)}-${sanitizeName(label)}`;


const parseMetadata = parseEnvironmentMetadata;

const cloneMetadata = (metadata: Prisma.JsonValue | null | undefined): Prisma.JsonObject => {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return { ...(metadata as Prisma.JsonObject) };
  }
  return {};
};

const mergeMetadata = (
  metadata: Prisma.JsonValue | null | undefined,
  patch: Record<string, Prisma.JsonValue | undefined>,
): Prisma.JsonObject => {
  const base = cloneMetadata(metadata);
  return { ...base, ...patch };
};

const reserveHostPort = async (preferred: number | undefined, usedPorts: Set<number>) => {
  if (preferred && !usedPorts.has(preferred) && (await isPortAvailable(preferred))) {
    usedPorts.add(preferred);
    return preferred;
  }
  const port = await findAvailablePort(usedPorts);
  usedPorts.add(port);
  return port;
};

const gatherUsedPorts = async (excludeEnvironmentId?: string) => {
  const environments = await prisma.serviceEnvironment.findMany({ select: { id: true, metadata: true } });
  const used = new Set<number>();
  for (const env of environments) {
    if (excludeEnvironmentId && env.id === excludeEnvironmentId) continue;
    const { hostPort } = parseMetadata(env.metadata);
    if (hostPort) {
      used.add(hostPort);
    }
  }
  return used;
};

const routerHost = envConfig.routerTargetHost.replace(/\/$/, '');

const buildTargetUrl = (hostPort: number, metadata: Prisma.JsonValue | null) => {
  const meta = parseMetadata(metadata);
  if (envConfig.dockerNetwork && meta.containerName && meta.appPort) {
    return `http://${meta.containerName}:${meta.appPort}`;
  }
  return `${routerHost}:${hostPort}`;
};

const resolveDockerImage = (envInput: ServiceInput['environments'][number], existing?: string | null) =>
  envInput.dockerImage ?? existing ?? null;

const buildEnvRecord = async ({
  serviceName,
  label,
  input,
  existing,
  usedPorts,
  isActive,
}: {
  serviceName: string;
  label: string;
  input: ServiceInput['environments'][number];
  existing?: ServiceEnvironment;
  usedPorts: Set<number>;
  isActive: boolean;
}) => {
  const existingMeta = parseMetadata(existing?.metadata);
  const { hostPort: existingHostPort, appPort: existingAppPort } = existingMeta;
  const hostPort = await reserveHostPort(existingHostPort, usedPorts);
  const appPort = input.appPort ?? existingAppPort ?? 4000;
  const dockerImage = resolveDockerImage(input, existing?.dockerImage);
  const containerName = buildContainerName(serviceName, label);

  if (!dockerImage) {
    throw new HttpError(400, `Environment ${label} requires a docker image`);
  }

  const metadata = mergeMetadata(existing?.metadata, {
    hostPort,
    appPort,
    containerName,
  });

  if (metadata.containerState !== 'running' && metadata.containerState !== 'stopped') {
    metadata.containerState = 'stopped';
  }

  return {
    label,
    targetUrl: buildTargetUrl(hostPort, metadata),
    weightPercent: input.weightPercent ?? (isActive ? 100 : 0),
    isActive,
    dockerImage,
    metadata,
  };
};

const serializeService = (service: ServiceWithRelations) => {
  const envRecords = service.environments ?? [];
  const activityRecords = service.activities ?? [];

  return {
    id: service.id,
    name: service.name,
    description: service.description,
    repositoryUrl: service.repositoryUrl,
    healthEndpoint: service.healthEndpoint,
    activeTrafficId: service.activeTrafficId,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    environments: envRecords.map((env) => {
      const meta = parseMetadata(env.metadata);
      return {
        id: env.id,
        label: env.label,
        targetUrl: env.targetUrl,
        dockerImage: env.dockerImage,
        weightPercent: env.weightPercent,
        isActive: env.isActive,
        status: env.status,
        lastLatencyMs: env.lastLatencyMs,
        lastCheckAt: env.lastCheckAt,
        hostPort: meta.hostPort ?? null,
        appPort: meta.appPort ?? null,
        containerState: meta.containerState ?? 'stopped',
        containerName: meta.containerName ?? buildContainerName(service.name, env.label),
      };
    }),
    deployments: service.deployments,
    activities: activityRecords.map((activity) => ({
      id: activity.id,
      type: activity.type,
      message: activity.message,
      createdAt: activity.createdAt,
      actorId: activity.actorId,
      actorRole: activity.actorRole,
      environmentId: activity.environmentId,
      environmentLabel: activity.environment?.label ?? null,
      metadata: activity.metadata ?? null,
    })),
  };
};

const syncServiceRuntimeState = async (service: ServiceWithRelations) => {
  for (const environment of service.environments) {
    const meta = parseMetadata(environment.metadata);
    if (!meta.containerName) continue;
    const dockerState = await getDockerContainerState(meta.containerName);
    const normalized: ContainerState = dockerState === 'running' ? 'running' : 'stopped';
    if (normalized !== meta.containerState) {
      const metadata = mergeMetadata(environment.metadata, { containerState: normalized });
      await prisma.serviceEnvironment.update({
        where: { id: environment.id },
        data: { metadata },
      });
      environment.metadata = metadata;
    }
  }
  return service;
};

const requireAllStopped = (service: { environments: { metadata: Prisma.JsonValue | null; label: string }[] }) => {
  const runningEnv = service.environments.find((env) => parseMetadata(env.metadata).containerState === 'running');
  if (runningEnv) {
    throw new HttpError(400, `Stop ${runningEnv.label} and the other slot before editing service metadata`);
  }
};

const normalizeEnvs = (input: ServiceInput) => {
  const envMap = new Map(input.environments.map((env) => [env.label.toLowerCase(), env]));
  const staging = envMap.get('staging');
  const prod = envMap.get('prod');
  if (!staging || !prod) {
    throw new HttpError(400, "Service must include 'staging' and 'prod' environments");
  }
  return { staging, prod };
};

const provisionDocker = async (serviceName: string, environments: ServiceEnvironment[]) => {
  if (!envConfig.dockerAutostart) return;

  for (const env of environments) {
    if (!env.dockerImage) continue;
    const parsed = parseMetadata(env.metadata);
    const { hostPort, appPort } = parsed;
    if (!hostPort || !appPort) continue;
    const containerName = parsed.containerName ?? buildContainerName(serviceName, env.label);
    const envVars = {
      PORT: `${appPort}`,
      APP_PORT: `${appPort}`,
      APP_COLOR: env.label,
      APP_VERSION: `bootstrap-${new Date().toISOString()}`,
    };
    await ensureDockerContainer({
      name: containerName,
      image: env.dockerImage,
      hostPort,
      containerPort: appPort,
      env: envVars,
      network: envConfig.dockerNetwork || undefined,
    }).catch((error) => {
      console.error(`[DOCKER] Failed to start ${containerName}`, error);
      throw new HttpError(500, `Failed to start docker container for ${env.label}`);
    });

    const updatedMetadata = mergeMetadata(env.metadata, {
      hostPort,
      appPort,
      containerState: 'running',
      containerName,
    });

    await prisma.serviceEnvironment.update({
      where: { id: env.id },
      data: {
        metadata: updatedMetadata,
        targetUrl: buildTargetUrl(hostPort, updatedMetadata),
      },
    });
  }
};

const reloadServiceOrThrow = async (serviceId: string) => {
  const next = await prisma.service.findUnique({
    where: { id: serviceId },
    include: serviceInclude,
  });
  if (!next) {
    throw new HttpError(500, 'Failed to reload service state');
  }
  return syncServiceRuntimeState(next as ServiceWithRelations);
};

export const registerService = async (input: ServiceInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const { staging, prod } = normalizeEnvs(input);
  const existing = await prisma.service.findFirst({ include: { environments: true } });

  if (!existing) {
    const usedPorts = new Set<number>();
    const stagingRecord = await buildEnvRecord({
      serviceName: input.name,
      label: 'staging',
      input: staging,
      usedPorts,
      isActive: false,
    });
    const prodRecord = await buildEnvRecord({
      serviceName: input.name,
      label: 'prod',
      input: prod,
      usedPorts,
      isActive: true,
    });

    const service = await prisma.service.create({
      data: {
        name: input.name,
        description: input.description,
        repositoryUrl: input.repositoryUrl,
        healthEndpoint: input.healthEndpoint,
        environments: { create: [stagingRecord, prodRecord] },
        activeTrafficId: undefined,
      },
      include: serviceInclude,
    });

    await provisionDocker(service.name, service.environments);
    const hydrated = await reloadServiceOrThrow(service.id);
    eventBus.emitEvent({ type: 'service.updated', payload: hydrated });
    void safeRegenerateCaddy(`service register (${service.name})`);
    return serializeService(hydrated);
  }

  const usedPorts = new Set<number>();
  const [stagingEnv, prodEnv] = existing.environments;

  const stagingRecord = await buildEnvRecord({
    serviceName: existing.name,
    label: 'staging',
    input: staging,
    existing: stagingEnv,
    usedPorts,
    isActive: stagingEnv?.isActive ?? false,
  });
  const prodRecord = await buildEnvRecord({
    serviceName: existing.name,
    label: 'prod',
    input: prod,
    existing: prodEnv,
    usedPorts,
    isActive: true,
  });

  await prisma.$transaction([
    prisma.serviceEnvironment.update({
      where: { id: stagingEnv.id },
      data: stagingRecord,
    }),
    prisma.serviceEnvironment.update({
      where: { id: prodEnv.id },
      data: prodRecord,
    }),
    prisma.service.update({
      where: { id: existing.id },
      data: { activeTrafficId: prodEnv.id },
    }),
  ]);

  const updated = await reloadServiceOrThrow(existing.id);
  await provisionDocker(updated.name, updated.environments);
  const finalService = await reloadServiceOrThrow(existing.id);
  eventBus.emitEvent({ type: 'service.updated', payload: finalService });
  void safeRegenerateCaddy(`service update (${finalService.name})`);
  await logActivity({
    serviceId: finalService.id,
    actor,
    type: 'service.reseeded',
    message: `Reinitialized ${finalService.name} registration`,
  });
  return serializeService(finalService);
};

export const listServices = async () => {
  const services = (await prisma.service.findMany({ include: serviceInclude })) as ServiceWithRelations[];
  await Promise.all(services.map((service) => syncServiceRuntimeState(service)));
  return services.map(serializeService);
};

export const updateServiceConfig = async (input: UpdateServiceInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { environments: true },
  });
  if (!service) throw new HttpError(404, 'Service not found');

  const tx: Prisma.PrismaPromise<unknown>[] = [];
  const serviceUpdateData: Prisma.ServiceUpdateInput = {};
  const serviceMetadataChanges: string[] = [];
  const envChangeLogs: Array<{
    environmentId: string;
    label: string;
    details: string[];
    metadata: Record<string, unknown>;
  }> = [];

  if (typeof input.description !== 'undefined' && input.description !== service.description) {
    serviceUpdateData.description = input.description;
    serviceMetadataChanges.push('description');
  }
  if (typeof input.repositoryUrl !== 'undefined' && input.repositoryUrl !== service.repositoryUrl) {
    serviceUpdateData.repositoryUrl = input.repositoryUrl;
    serviceMetadataChanges.push('repositoryUrl');
  }
  if (typeof input.healthEndpoint !== 'undefined' && input.healthEndpoint !== service.healthEndpoint) {
    serviceUpdateData.healthEndpoint = input.healthEndpoint;
    serviceMetadataChanges.push('healthEndpoint');
  }
  const hasServiceMetadataUpdate = serviceMetadataChanges.length > 0;
  if (hasServiceMetadataUpdate) {
    requireAllStopped(service);
    tx.push(prisma.service.update({ where: { id: service.id }, data: serviceUpdateData }));
  }

  if (input.environments) {
    for (const envInput of input.environments) {
      const target = service.environments.find((env) => env.label === envInput.label);
      if (!target) {
        throw new HttpError(404, `Environment ${envInput.label} not found`);
      }

      const metadataPatch: Record<string, Prisma.JsonValue | undefined> = {};
      const parsed = parseMetadata(target.metadata);
      const envChangeDetails: string[] = [];
      const envMetadata: Record<string, unknown> = {};

      if (typeof envInput.appPort === 'number' && envInput.appPort !== parsed.appPort) {
        if (parsed.containerState === 'running') {
          throw new HttpError(400, `Stop ${envInput.label} before changing APP_PORT`);
        }
        metadataPatch.appPort = envInput.appPort;
        envChangeDetails.push(`APP_PORT ${parsed.appPort ?? 'n/a'} -> ${envInput.appPort}`);
        envMetadata.appPort = envInput.appPort;
      }

      const envUpdateData: Prisma.ServiceEnvironmentUpdateInput = {};
      if (
        typeof envInput.dockerImage === 'string' &&
        envInput.dockerImage.length > 0 &&
        envInput.dockerImage !== target.dockerImage
      ) {
        envUpdateData.dockerImage = envInput.dockerImage;
        envChangeDetails.push(`image -> ${envInput.dockerImage}`);
        envMetadata.dockerImage = envInput.dockerImage;
      }
      if (Object.keys(metadataPatch).length > 0) {
        envUpdateData.metadata = mergeMetadata(target.metadata, metadataPatch);
      }

      if (envChangeDetails.length > 0 && Object.keys(envUpdateData).length > 0) {
        tx.push(prisma.serviceEnvironment.update({ where: { id: target.id }, data: envUpdateData }));
        envChangeLogs.push({
          environmentId: target.id,
          label: target.label,
          details: envChangeDetails,
          metadata: envMetadata,
        });
      }
    }
  }

  if (tx.length > 0) {
    await prisma.$transaction(tx);
  }

  if (serviceMetadataChanges.length > 0) {
    await logActivity({
      serviceId: service.id,
      actor,
      type: 'service.metadata.updated',
      message: `Updated ${serviceMetadataChanges.join(', ')}`,
      metadata: { fields: serviceMetadataChanges },
    });
  }

  for (const change of envChangeLogs) {
    await logActivity({
      serviceId: service.id,
      environmentId: change.environmentId,
      actor,
      type: 'environment.config.updated',
      message: `Updated ${change.label} slot (${change.details.join(', ')})`,
      metadata: { fields: change.details, ...change.metadata },
    });
  }

  const updated = await reloadServiceOrThrow(service.id);
  eventBus.emitEvent({ type: 'service.updated', payload: updated });
  void safeRegenerateCaddy(`service config update (${updated.name})`);
  return serializeService(updated);
};

export const deployVersion = async (input: DeploymentInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { environments: true },
  });
  if (!service) throw new HttpError(404, 'Service not found');

  const environment = service.environments.find((env) => env.label === input.environmentLabel);
  if (!environment) throw new HttpError(404, 'Environment not found');
  if (environment.label !== 'staging') {
    throw new HttpError(400, 'Deployments may only target the staging slot');
  }

  const metadataValue = input.metadata ? (input.metadata as Prisma.JsonObject) : prismaPkg.Prisma.DbNull;

  await prisma.deployment.create({
    data: {
      serviceId: service.id,
      environmentId: environment.id,
      version: input.version,
      status: DeploymentStatus.deploying,
      dockerImage: input.dockerImage,
      metadata: metadataValue,
      initiatedById: actor.id,
    },
  });

  console.log(
    `[DEPLOY] STARTING DOCKER IMAGE: ${input.dockerImage} (service=${service.name}, env=${environment.label}, version=${input.version})`,
  );

  eventBus.emitEvent({
    type: 'deployment.created',
    payload: { serviceId: service.id, environmentId: environment.id, version: input.version, dockerImage: input.dockerImage },
  });

  await logActivity({
    serviceId: service.id,
    environmentId: environment.id,
    actor,
    type: 'deployment.queued',
    message: `Queued deployment ${input.version} on ${environment.label}`,
    metadata: { dockerImage: input.dockerImage },
  });
};

export const startEnvironment = async (input: EnvironmentToggleInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = await reloadServiceOrThrow(input.serviceId);
  const environment = service.environments.find((env) => env.label === input.environmentLabel);
  if (!environment) throw new HttpError(404, 'Environment not found');
  const parsed = parseMetadata(environment.metadata);
  if (parsed.containerState === 'running') {
    throw new HttpError(400, `${environment.label} is already running`);
  }
  if (!environment.dockerImage) {
    throw new HttpError(400, `Environment ${environment.label} is missing a docker image`);
  }
  if (!parsed.appPort) {
    throw new HttpError(400, `Set APP_PORT for ${environment.label} before starting`);
  }

  const usedPorts = await gatherUsedPorts(environment.id);
  const hostPort = await reserveHostPort(parsed.hostPort, usedPorts);
  const containerName = parsed.containerName ?? buildContainerName(service.name, environment.label);

  const envVars = {
    PORT: `${parsed.appPort}`,
    APP_PORT: `${parsed.appPort}`,
    APP_COLOR: environment.label,
    APP_VERSION: `manual-${new Date().toISOString()}`,
  };

  await ensureDockerContainer({
    name: containerName,
    image: environment.dockerImage,
    hostPort,
    containerPort: parsed.appPort,
    env: envVars,
    network: envConfig.dockerNetwork || undefined,
  });

  const updatedMetadata = mergeMetadata(environment.metadata, {
    hostPort,
    appPort: parsed.appPort,
    containerState: 'running' as ContainerState,
    containerName,
  });

  await prisma.serviceEnvironment.update({
    where: { id: environment.id },
    data: {
      targetUrl: buildTargetUrl(hostPort, updatedMetadata),
      metadata: updatedMetadata,
    },
  });
  await logActivity({
    serviceId: service.id,
    environmentId: environment.id,
    actor,
    type: 'environment.started',
    message: `Started ${environment.label} slot (host ${hostPort} -> app ${parsed.appPort})`,
    metadata: { hostPort, appPort: parsed.appPort, dockerImage: environment.dockerImage },
  });

  const updated = await reloadServiceOrThrow(service.id);
  eventBus.emitEvent({ type: 'service.updated', payload: updated });
  void safeRegenerateCaddy(`start ${service.name} (${environment.label})`);
  return serializeService(updated);
};

export const stopEnvironment = async (input: EnvironmentToggleInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = await reloadServiceOrThrow(input.serviceId);
  const environment = service.environments.find((env) => env.label === input.environmentLabel);
  if (!environment) throw new HttpError(404, 'Environment not found');
  const parsed = parseMetadata(environment.metadata);
  if (parsed.containerState === 'stopped') {
    return serializeService(service);
  }

  const containerName = parsed.containerName ?? buildContainerName(service.name, environment.label);
  await stopDockerContainer(containerName).catch(() => undefined);
  await removeDockerContainer(containerName).catch(() => undefined);

  await prisma.serviceEnvironment.update({
    where: { id: environment.id },
    data: {
      metadata: mergeMetadata(environment.metadata, { containerState: 'stopped' as ContainerState }),
    },
  });
  await logActivity({
    serviceId: service.id,
    environmentId: environment.id,
    actor,
    type: 'environment.stopped',
    message: `Stopped ${environment.label} slot and removed container ${containerName}`,
  });

  const updated = await reloadServiceOrThrow(service.id);
  eventBus.emitEvent({ type: 'service.updated', payload: updated });
  void safeRegenerateCaddy(`stop ${service.name} (${environment.label})`);
  return serializeService(updated);
};

export const switchEnvironment = async (input: SwitchInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = await prisma.service.findUnique({ where: { id: input.serviceId }, include: { environments: true } });
  if (!service) throw new HttpError(404, 'Service not found');

  const targetEnv = service.environments.find((env) => env.label === input.toLabel);
  if (!targetEnv) throw new HttpError(404, 'Target environment not found');
  const targetMeta = parseMetadata(targetEnv.metadata);
  if (targetMeta.containerState !== 'running') {
    throw new HttpError(400, `Start ${targetEnv.label} before routing traffic`);
  }
  const previousActive = service.environments.find((env) => env.isActive)?.label;

  await prisma.serviceEnvironment.updateMany({
    where: { serviceId: service.id },
    data: { isActive: false },
  });

  await prisma.serviceEnvironment.update({
    where: { id: targetEnv.id },
    data: { isActive: true, weightPercent: 100 },
  });

  const updated = (await prisma.service.update({
    where: { id: service.id },
    data: { activeTrafficId: targetEnv.id },
    include: serviceInclude,
  })) as ServiceWithRelations;

  await prisma.switchEvent.create({
    data: {
      serviceId: service.id,
      fromLabel: previousActive,
      toLabel: targetEnv.label,
      reason: input.reason,
      initiatedBy: actor.id,
    },
  });

  eventBus.emitEvent({
    type: 'service.switched',
    payload: { serviceId: service.id, fromLabel: previousActive, toLabel: targetEnv.label, reason: input.reason },
  });

  await logActivity({
    serviceId: service.id,
    environmentId: targetEnv.id,
    actor,
    type: 'service.switched',
    message: `Routed traffic to ${targetEnv.label} slot${previousActive ? ` (from ${previousActive})` : ''}`,
    metadata: { from: previousActive, reason: input.reason ?? null },
  });

  void safeRegenerateCaddy(`switch ${service.name} to ${targetEnv.label}`);

  return serializeService(updated);
};

export const recordHealth = async (environmentId: string, status: EnvironmentStatusType, latencyMs?: number) => {
  const environment = await prisma.serviceEnvironment.update({
    where: { id: environmentId },
    data: { status, lastLatencyMs: latencyMs ?? null, lastCheckAt: new Date() },
  });

  eventBus.emitEvent({
    type: 'environment.health',
    payload: { serviceId: environment.serviceId, environmentId, status, latencyMs },
  });

  return environment;
};

export const deleteService = async (serviceId: string, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: { environments: true },
  });
  if (!service) throw new HttpError(404, 'Service not found');

  for (const environment of service.environments) {
    const containerName = buildContainerName(service.name, environment.label);
    await stopDockerContainer(containerName).catch(() => undefined);
    await removeDockerContainer(containerName).catch(() => undefined);
  }

  await prisma.service.delete({ where: { id: service.id } });
  eventBus.emitEvent({ type: 'service.deleted', payload: { serviceId: service.id } });
  void safeRegenerateCaddy(`service deleted (${service.name})`);
  return { success: true };
};

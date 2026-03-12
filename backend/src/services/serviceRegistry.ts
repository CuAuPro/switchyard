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
  type DockerRegistryAuth,
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
  registryHost?: string;
  registryUsername?: string;
  registryPassword?: string;
  environments: Array<{
    label: string;
    dockerImage: string;
    appPort?: number;
    weightPercent?: number;
    envVars?: Record<string, string>;
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
  envVars?: Record<string, string>;
};

type UpdateServiceInput = {
  serviceId: string;
  description?: string;
  repositoryUrl?: string;
  healthEndpoint?: string;
  registryHost?: string;
  registryUsername?: string;
  registryPassword?: string;
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
type ServiceWithEnvironments = Prisma.ServiceGetPayload<{ include: { environments: true } }>;

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
const SLOT_A_LABEL = 'slot-a';
const SLOT_B_LABEL = 'slot-b';

const buildContainerName = (serviceName: string, label: string) =>
  `switchyard-${sanitizeName(serviceName)}-${sanitizeName(label)}`;

const parseMetadata = parseEnvironmentMetadata;

const normalizeEnvVars = (envVars?: Record<string, string>): Record<string, string> | undefined => {
  if (!envVars) return undefined;
  const normalized = Object.fromEntries(
    Object.entries(envVars)
      .map(([key, value]) => [key.trim(), value])
      .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeTextField = (value?: string): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readOptionalStringField = (record: Record<string, unknown>, field: string): string | null => {
  const value = record[field];
  return typeof value === 'string' ? value : null;
};

const buildRegistryAuth = (service: {
  registryHost?: string | null;
  registryUsername?: string | null;
  registryPassword?: string | null;
}): DockerRegistryAuth | undefined => {
  const username = normalizeTextField(service.registryUsername ?? undefined);
  const password = normalizeTextField(service.registryPassword ?? undefined);
  if (!username || !password) return undefined;
  const registry = normalizeTextField(service.registryHost ?? undefined);
  return {
    registry,
    username,
    password,
  };
};

const resolveRuntimeDockerImage = (image: string, registryHost?: string | null) => {
  const trimmedImage = image.trim();
  const normalizedRegistryHost = normalizeTextField(registryHost ?? undefined);
  if (!trimmedImage || !normalizedRegistryHost) return trimmedImage;
  if (trimmedImage.startsWith(`${normalizedRegistryHost}/`)) return trimmedImage;
  return `${normalizedRegistryHost}/${trimmedImage}`;
};

const sameEnvVars = (left?: Record<string, string>, right?: Record<string, string>) => {
  const a = normalizeEnvVars(left);
  const b = normalizeEnvVars(right);
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, index) => key === keysB[index] && a[key] === b[key]);
};

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
  const { hostPort: existingHostPort, appPort: existingAppPort, envVars: existingEnvVars } = existingMeta;
  const hostPort = await reserveHostPort(existingHostPort, usedPorts);
  const appPort = input.appPort ?? existingAppPort ?? 4000;
  const envVars = normalizeEnvVars(input.envVars) ?? existingEnvVars;
  const dockerImage = resolveDockerImage(input, existing?.dockerImage);
  const containerName = buildContainerName(serviceName, label);

  if (!dockerImage) {
    throw new HttpError(400, `Environment ${label} requires a docker image`);
  }

  const metadata = mergeMetadata(existing?.metadata, {
    hostPort,
    appPort,
    envVars,
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
  const serviceRecord = service as unknown as Record<string, unknown>;
  const registryHost = readOptionalStringField(serviceRecord, 'registryHost');
  const registryUsername = readOptionalStringField(serviceRecord, 'registryUsername');
  const registryPassword = readOptionalStringField(serviceRecord, 'registryPassword');

  return {
    id: service.id,
    name: service.name,
    description: service.description,
    repositoryUrl: service.repositoryUrl,
    healthEndpoint: service.healthEndpoint,
    registryHost,
    registryUsername,
    registryPasswordSet: Boolean(registryPassword),
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
        envVars: meta.envVars ?? {},
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
  const slotA = envMap.get(SLOT_A_LABEL);
  const slotB = envMap.get(SLOT_B_LABEL);
  if (!slotA || !slotB) {
    throw new HttpError(400, "Service must include both 'slot-a' and 'slot-b' environments");
  }
  return { slotA, slotB };
};

const provisionDocker = async (
  serviceName: string,
  serviceConfig: { registryHost?: string | null },
  environments: ServiceEnvironment[],
  registryAuth?: DockerRegistryAuth,
) => {
  if (!envConfig.dockerAutostart) return;

  for (const env of environments) {
    if (!env.dockerImage) continue;
    const parsed = parseMetadata(env.metadata);
    const { hostPort, appPort, envVars: customEnvVars } = parsed;
    if (!hostPort || !appPort) continue;
    const containerName = parsed.containerName ?? buildContainerName(serviceName, env.label);
    const envVars = {
      ...(customEnvVars ?? {}),
      PORT: `${appPort}`,
      APP_PORT: `${appPort}`,
      APP_COLOR: env.label,
      APP_VERSION: `bootstrap-${new Date().toISOString()}`,
    };
    const runtimeImage = resolveRuntimeDockerImage(env.dockerImage, serviceConfig.registryHost);
    await ensureDockerContainer({
      name: containerName,
      image: runtimeImage,
      hostPort,
      containerPort: appPort,
      env: envVars,
      network: envConfig.dockerNetwork || undefined,
      registryAuth,
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
  const normalizedName = input.name.trim();
  if (!normalizedName) {
    throw new HttpError(400, 'Service name is required');
  }
  const existingByName = await prisma.service.findUnique({ where: { name: normalizedName } });
  if (existingByName) {
    throw new HttpError(409, `Service '${normalizedName}' already exists`);
  }

  const { slotA, slotB } = normalizeEnvs(input);
  const usedPorts = await gatherUsedPorts();
  const slotARecord = await buildEnvRecord({
    serviceName: normalizedName,
    label: SLOT_A_LABEL,
    input: slotA,
    usedPorts,
    isActive: false,
  });
  const slotBRecord = await buildEnvRecord({
    serviceName: normalizedName,
    label: SLOT_B_LABEL,
    input: slotB,
    usedPorts,
    isActive: true,
  });

  const createData: Prisma.ServiceCreateInput = {
    name: normalizedName,
    description: input.description,
    repositoryUrl: input.repositoryUrl,
    healthEndpoint: input.healthEndpoint,
    environments: { create: [slotARecord, slotBRecord] },
    activeTrafficId: undefined,
  };
  const createDataRecord = createData as unknown as Record<string, unknown>;
  createDataRecord.registryHost = normalizeTextField(input.registryHost) ?? null;
  createDataRecord.registryUsername = normalizeTextField(input.registryUsername) ?? null;
  createDataRecord.registryPassword = normalizeTextField(input.registryPassword) ?? null;

  const service = (await prisma.service.create({
    data: createData,
    include: serviceInclude,
  })) as ServiceWithRelations;

  await provisionDocker(
    service.name,
    { registryHost: readOptionalStringField(service as unknown as Record<string, unknown>, 'registryHost') },
    service.environments,
    buildRegistryAuth({
      registryHost: readOptionalStringField(service as unknown as Record<string, unknown>, 'registryHost'),
      registryUsername: readOptionalStringField(service as unknown as Record<string, unknown>, 'registryUsername'),
      registryPassword: readOptionalStringField(service as unknown as Record<string, unknown>, 'registryPassword'),
    }),
  );
  const hydrated = await reloadServiceOrThrow(service.id);
  eventBus.emitEvent({ type: 'service.updated', payload: hydrated });
  void safeRegenerateCaddy(`service register (${service.name})`);
  await logActivity({
    serviceId: hydrated.id,
    actor,
    type: 'service.created',
    message: `Created service ${hydrated.name} with slot-a/slot-b`,
  });
  return serializeService(hydrated);
};

export const listServices = async () => {
  const services = (await prisma.service.findMany({ include: serviceInclude })) as ServiceWithRelations[];
  await Promise.all(services.map((service) => syncServiceRuntimeState(service)));
  return services.map(serializeService);
};

export const updateServiceConfig = async (input: UpdateServiceInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = (await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { environments: true },
  })) as ServiceWithEnvironments | null;
  if (!service) throw new HttpError(404, 'Service not found');

  const tx: Prisma.PrismaPromise<unknown>[] = [];
  const serviceUpdateData: Prisma.ServiceUpdateInput = {};
  const serviceUpdateDataRecord = serviceUpdateData as unknown as Record<string, unknown>;
  const serviceMetadataChanges: string[] = [];
  const envChangeLogs: Array<{
    environmentId: string;
    label: string;
    details: string[];
    metadata: Record<string, unknown>;
  }> = [];

  const serviceRecord = service as unknown as Record<string, unknown>;
  const currentRegistryHost = readOptionalStringField(serviceRecord, 'registryHost');
  const currentRegistryUsername = readOptionalStringField(serviceRecord, 'registryUsername');
  const currentRegistryPassword = readOptionalStringField(serviceRecord, 'registryPassword');

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
  if (typeof input.registryHost !== 'undefined') {
    const nextRegistryHost = normalizeTextField(input.registryHost) ?? null;
    if (nextRegistryHost !== currentRegistryHost) {
      serviceUpdateDataRecord.registryHost = nextRegistryHost;
      serviceMetadataChanges.push('registryHost');
    }
  }
  const incomingRegistryUsername = typeof input.registryUsername !== 'undefined';
  const incomingRegistryPassword = typeof input.registryPassword !== 'undefined';
  let nextRegistryUsername = currentRegistryUsername;
  let nextRegistryPassword = currentRegistryPassword;
  if (incomingRegistryUsername) {
    nextRegistryUsername = normalizeTextField(input.registryUsername) ?? null;
  }
  if (incomingRegistryPassword) {
    nextRegistryPassword = normalizeTextField(input.registryPassword) ?? null;
  }
  if (incomingRegistryUsername && !incomingRegistryPassword && nextRegistryUsername === null) {
    // Clearing username should also clear any previously stored password.
    nextRegistryPassword = null;
  }
  if (incomingRegistryPassword && !incomingRegistryUsername && nextRegistryPassword === null) {
    // Clearing password should also clear any previously stored username.
    nextRegistryUsername = null;
  }
  const hasRegistryUsername = Boolean(nextRegistryUsername);
  const hasRegistryPassword = Boolean(nextRegistryPassword);
  if (hasRegistryUsername !== hasRegistryPassword) {
    throw new HttpError(400, 'Registry username and password must both be provided');
  }
  if (nextRegistryUsername !== currentRegistryUsername) {
    serviceUpdateDataRecord.registryUsername = nextRegistryUsername;
    serviceMetadataChanges.push('registryUsername');
  }
  if (nextRegistryPassword !== currentRegistryPassword) {
    serviceUpdateDataRecord.registryPassword = nextRegistryPassword;
    serviceMetadataChanges.push('registryPassword');
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

      if (Object.prototype.hasOwnProperty.call(envInput, 'envVars') && !sameEnvVars(envInput.envVars, parsed.envVars)) {
        if (parsed.containerState === 'running') {
          throw new HttpError(400, `Stop ${envInput.label} before changing env vars`);
        }
        const nextEnvVars = normalizeEnvVars(envInput.envVars);
        metadataPatch.envVars = nextEnvVars;
        envChangeDetails.push('environment variables updated');
        envMetadata.envVars = nextEnvVars ?? {};
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

  const service = (await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { environments: true },
  })) as ServiceWithEnvironments | null;
  if (!service) throw new HttpError(404, 'Service not found');

  const environment = service.environments.find((env) => env.label === input.environmentLabel);
  if (!environment) throw new HttpError(404, 'Environment not found');
  if (environment.isActive) {
    throw new HttpError(400, 'Deployments may only target the non-active slot');
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
    ...(parsed.envVars ?? {}),
    PORT: `${parsed.appPort}`,
    APP_PORT: `${parsed.appPort}`,
    APP_COLOR: environment.label,
    APP_VERSION: `manual-${new Date().toISOString()}`,
  };

  await ensureDockerContainer({
    name: containerName,
    image: resolveRuntimeDockerImage(
      environment.dockerImage,
      readOptionalStringField(service as unknown as Record<string, unknown>, 'registryHost'),
    ),
    hostPort,
    containerPort: parsed.appPort,
    env: envVars,
    network: envConfig.dockerNetwork || undefined,
    registryAuth: buildRegistryAuth(service),
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
    message: `Stopped ${environment.label} slot and kept container ${containerName}`,
  });

  const updated = await reloadServiceOrThrow(service.id);
  eventBus.emitEvent({ type: 'service.updated', payload: updated });
  void safeRegenerateCaddy(`stop ${service.name} (${environment.label})`);
  return serializeService(updated);
};

export const removeEnvironment = async (input: EnvironmentToggleInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = await reloadServiceOrThrow(input.serviceId);
  const environment = service.environments.find((env) => env.label === input.environmentLabel);
  if (!environment) throw new HttpError(404, 'Environment not found');
  const parsed = parseMetadata(environment.metadata);
  if (parsed.containerState === 'running') {
    throw new HttpError(400, `Stop ${environment.label} before removing its container`);
  }

  const containerName = parsed.containerName ?? buildContainerName(service.name, environment.label);
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
    type: 'environment.removed',
    message: `Removed stopped container ${containerName} for ${environment.label}`,
  });

  const updated = await reloadServiceOrThrow(service.id);
  eventBus.emitEvent({ type: 'service.updated', payload: updated });
  return serializeService(updated);
};

export const switchEnvironment = async (input: SwitchInput, actor: ActorUser) => {
  requireRole(actor.role, ['admin', 'operator']);

  const service = (await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { environments: true },
  })) as ServiceWithEnvironments | null;
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

  const service = (await prisma.service.findUnique({
    where: { id: serviceId },
    include: { environments: true },
  })) as ServiceWithEnvironments | null;
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

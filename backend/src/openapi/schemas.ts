import { z } from 'zod';

import { registry } from './registry.js';

export const ServiceEnvironmentSchema = registry.register(
  'ServiceEnvironment',
  z
    .object({
      id: z.string(),
      label: z.string(),
      targetUrl: z.string().url(),
      dockerImage: z.string().nullable().optional(),
      status: z.enum(['unknown', 'healthy', 'degraded', 'unhealthy', 'draining']),
      weightPercent: z.number().int(),
      isActive: z.boolean(),
      lastLatencyMs: z.number().int().nullable().optional(),
      lastCheckAt: z.string().nullable().optional(),
      hostPort: z.number().int().nullable().optional(),
      appPort: z.number().int().nullable().optional(),
      envVars: z.record(z.string(), z.string()).optional(),
      containerState: z.enum(['running', 'stopped']).nullable().optional(),
      containerName: z.string().nullable().optional(),
    })
    .openapi({
      example: {
        id: 'env1',
        label: 'blue',
        targetUrl: 'http://sample-blue:4001',
        dockerImage: 'switchyard-sample:latest',
        status: 'healthy',
        weightPercent: 100,
        isActive: true,
        lastLatencyMs: 32,
        hostPort: 4205,
        appPort: 4000,
        envVars: { LOG_LEVEL: 'debug', FEATURE_FLAG_X: 'true' },
        containerState: 'running',
        containerName: 'switchyard-sample-blue',
      },
    }),
);

export const DeploymentSchema = registry.register(
  'Deployment',
  z
    .object({
      id: z.string(),
      version: z.string(),
      status: z.string(),
      createdAt: z.string(),
      environmentId: z.string().nullable().optional(),
      dockerImage: z.string().nullable().optional(),
    })
    .openapi({
      example: {
        id: 'dep_123',
        version: '1.4.0',
        status: 'healthy',
        createdAt: '2026-02-17T18:21:00.000Z',
        environmentId: 'env1',
        dockerImage: 'ghcr.io/acme/sample:1.4.0',
      },
    }),
);

export const ServiceActivitySchema = registry.register(
  'ServiceActivity',
  z
    .object({
      id: z.string(),
      type: z.string(),
      message: z.string(),
      createdAt: z.string(),
      actorId: z.string().nullable().optional(),
      actorRole: z.enum(['viewer', 'operator', 'admin']).nullable().optional(),
      environmentId: z.string().nullable().optional(),
      environmentLabel: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.any()).nullable().optional(),
    })
    .openapi({
      example: {
        id: 'act_123',
        type: 'service.switched',
        message: 'Routed traffic to slot-b',
        createdAt: '2026-02-17T18:21:00.000Z',
      },
    }),
);

export const ServiceSchema = registry.register(
  'Service',
  z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable().optional(),
      repositoryUrl: z.string().nullable().optional(),
      healthEndpoint: z.string().nullable().optional(),
      registryHost: z.string().nullable().optional(),
      registryUsername: z.string().nullable().optional(),
      registryPasswordSet: z.boolean().optional(),
      environments: z.array(ServiceEnvironmentSchema),
      deployments: z.array(DeploymentSchema),
      activities: z.array(ServiceActivitySchema),
    })
    .openapi({
      example: {
        id: 'svc1',
        name: 'sample-api',
        description: 'Example service',
        registryHost: 'fra.ocir.io',
        registryUsername: 'tenant/user',
        registryPasswordSet: true,
        environments: [
          {
            id: 'env1',
            label: 'slot-a',
            targetUrl: 'http://sample-slot-a:4001',
            status: 'healthy',
            weightPercent: 0,
            isActive: false,
          },
          {
            id: 'env2',
            label: 'slot-b',
            targetUrl: 'http://sample-slot-b:4002',
            status: 'healthy',
            weightPercent: 100,
            isActive: true,
          },
        ],
        deployments: [],
      },
    }),
);

export const ServicesResponseSchema = registry.register(
  'ServicesResponse',
  z.array(ServiceSchema).openapi({ description: 'List of managed services' }),
);

export const SystemStatsSchema = registry.register(
  'SystemStats',
  z.object({
    timestamp: z.string(),
    host: z.object({
      hostname: z.string(),
      platform: z.string(),
      uptimeSeconds: z.number().int(),
      cpu: z.object({
        cores: z.number().int(),
        usagePercent: z.number().nullable(),
        loadAverage: z.object({
          oneMinute: z.number(),
          fiveMinutes: z.number(),
          fifteenMinutes: z.number(),
        }),
      }),
      memory: z.object({
        totalBytes: z.number(),
        usedBytes: z.number(),
        freeBytes: z.number(),
        usagePercent: z.number().nullable(),
      }),
      disk: z.object({
        totalBytes: z.number().nullable(),
        usedBytes: z.number().nullable(),
        availableBytes: z.number().nullable(),
      }),
    }),
    docker: z.object({
      containers: z.array(
        z.object({
          serviceId: z.string(),
          serviceName: z.string(),
          environmentId: z.string(),
          environmentLabel: z.string(),
          containerName: z.string(),
          dockerImage: z.string().nullable(),
          state: z.enum(['running', 'stopped', 'missing']),
          cpuPercent: z.number().nullable(),
          memUsage: z.string().nullable(),
          memPercent: z.number().nullable(),
          netIO: z.string().nullable(),
          blockIO: z.string().nullable(),
          pids: z.number().nullable(),
        }),
      ),
    }),
  }),
);

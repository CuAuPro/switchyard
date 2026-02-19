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
        message: 'Routed traffic to prod',
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
      environments: z.array(ServiceEnvironmentSchema),
      deployments: z.array(DeploymentSchema),
      activities: z.array(ServiceActivitySchema),
    })
    .openapi({
      example: {
        id: 'svc1',
        name: 'sample-api',
        description: 'Example service',
        environments: [
          {
            id: 'env1',
            label: 'staging',
            targetUrl: 'http://sample-staging:4001',
            status: 'healthy',
            weightPercent: 0,
            isActive: false,
          },
          {
            id: 'env2',
            label: 'prod',
            targetUrl: 'http://sample-prod:4002',
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

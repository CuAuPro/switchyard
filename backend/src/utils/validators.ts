import { z } from 'zod';

import { registry } from '../openapi/registry.js';

const healthEndpointField = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return false;
      if (/^https?:\/\//i.test(trimmed)) return true;
      return !/\s/.test(trimmed);
    },
    { message: 'Health endpoint must be an http(s) URL or a relative path without spaces' },
  );
export const createServiceSchema = registry.register(
  'CreateServiceRequest',
  z
    .object({
      name: z.string().min(2),
      description: z.string().optional(),
      repositoryUrl: z.string().url().optional(),
      healthEndpoint: healthEndpointField.optional(),
      environments: z
        .array(
          z.object({
            label: z.string().min(2),
            dockerImage: z.string().min(3),
            appPort: z.number().int().min(1).max(65535).optional(),
            weightPercent: z.number().min(0).max(100).optional(),
          }),
        )
        .superRefine((envs, ctx) => {
          const labels = envs.map((env) => env.label.toLowerCase());
          if (!labels.includes('slot-a') || !labels.includes('slot-b')) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Services must define both 'slot-a' and 'slot-b' environments",
            });
          }
        }),
    })
    .openapi({
      description: 'Payload for registering a new service with slot-a/slot-b environments.',
      example: {
        name: 'billing-api',
        description: 'Handles invoices',
        environments: [
          { label: 'slot-a', dockerImage: 'switchyard-sample:latest', appPort: 4000, weightPercent: 0 },
          { label: 'slot-b', dockerImage: 'switchyard-sample:latest', appPort: 4000, weightPercent: 100 },
        ],
      },
    }),
);

export const updateServiceSchema = registry.register(
  'UpdateServiceRequest',
  z
    .object({
      description: z.string().optional(),
      repositoryUrl: z.string().url().optional(),
      healthEndpoint: healthEndpointField.optional(),
      environments: z
        .array(
          z.object({
            label: z.string().min(2),
            dockerImage: z.string().min(3).optional(),
            appPort: z.number().int().min(1).max(65535).optional(),
          }),
        )
        .optional(),
    })
    .openapi({
      description: 'Partial update for existing service metadata or environment configuration.',
      example: {
        description: 'Updated summary',
        environments: [{ label: 'slot-a', appPort: 4100 }],
      },
    }),
);

export const deploySchema = registry.register(
  'DeploymentRequest',
  z
    .object({
      environmentLabel: z.string(),
      version: z.string(),
      dockerImage: z.string().min(3),
      metadata: z.record(z.string(), z.any()).optional(),
    })
    .openapi({
      description: 'Starts a deployment on a specific environment.',
      example: { environmentLabel: 'slot-a', version: '2.1.0', dockerImage: 'ghcr.io/acme/api:2.1.0' },
    }),
);

export const switchSchema = registry.register(
  'SwitchRequest',
  z
    .object({
      toLabel: z.string(),
      reason: z.string().optional(),
    })
    .openapi({
      description: 'Switches active traffic to a specific environment.',
      example: { toLabel: 'slot-b', reason: 'post-validation cutover' },
    }),
);

export const loginSchema = registry.register(
  'LoginRequest',
  z
    .object({
      email: z.string().email(),
      password: z.string().min(8),
    })
    .openapi({
      description: 'Credentials for JWT-based sign-in.',
      example: { email: 'admin@switchyard.dev', password: 'Switchyard!123' },
    }),
);

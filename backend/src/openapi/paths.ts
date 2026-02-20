import { z } from 'zod';

import { registry } from './registry.js';
import { ServiceSchema, ServicesResponseSchema } from './schemas.js';
import {
  createServiceSchema,
  deploySchema,
  loginSchema,
  switchSchema,
  updateServiceSchema,
} from '../utils/validators.js';

const LoginResponseSchema = registry.register(
  'LoginResponse',
  z.object({
    token: z.string().openapi({ example: 'eyJhbGciOiJI...' }),
    role: z.enum(['viewer', 'operator', 'admin']),
    name: z.string(),
  }),
);

const CurrentUserResponseSchema = registry.register(
  'CurrentUserResponse',
  z.object({
    id: z.string().openapi({ example: 'user_123' }),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['viewer', 'operator', 'admin']),
  }),
);
const ServiceIdParamSchema = registry.register(
  'ServiceIdParam',
  z.object({
    serviceId: z.string().openapi({ example: 'svc_123' }),
  }),
);

const EnvironmentLabelParamSchema = registry.register(
  'EnvironmentLabelParam',
  z.object({
    serviceId: z.string().openapi({ example: 'svc_123' }),
    label: z.string().openapi({ example: 'slot-a' }),
  }),
);

const SuccessResponseSchema = registry.register(
  'SuccessResponse',
  z.object({
    success: z.boolean().openapi({ example: true }),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Authentication success',
      content: {
        'application/json': {
          schema: LoginResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/services',
  tags: ['Services'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of registered services',
      content: {
        'application/json': {
          schema: ServicesResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/services',
  tags: ['Services'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createServiceSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created service',
      content: {
        'application/json': {
          schema: ServiceSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Current authenticated user',
      content: {
        'application/json': {
          schema: CurrentUserResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/services/{serviceId}',
  tags: ['Services'],
  security: [{ bearerAuth: [] }],
  request: {
    params: ServiceIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: updateServiceSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated service metadata',
      content: {
        'application/json': {
          schema: ServiceSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/services/{serviceId}/deployments',
  tags: ['Deployments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: ServiceIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: deploySchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Deployment accepted',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/services/{serviceId}/switch',
  tags: ['Services'],
  security: [{ bearerAuth: [] }],
  request: {
    params: ServiceIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: switchSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated service after switch',
      content: {
        'application/json': {
          schema: ServiceSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/services/{serviceId}/environments/{label}/start',
  tags: ['Environments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: EnvironmentLabelParamSchema,
  },
  responses: {
    200: {
      description: 'Service after starting the environment',
      content: {
        'application/json': {
          schema: ServiceSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/services/{serviceId}/environments/{label}/stop',
  tags: ['Environments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: EnvironmentLabelParamSchema,
  },
  responses: {
    200: {
      description: 'Service after stopping the environment',
      content: {
        'application/json': {
          schema: ServiceSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/services/{serviceId}',
  tags: ['Services'],
  security: [{ bearerAuth: [] }],
  request: {
    params: ServiceIdParamSchema,
  },
  responses: {
    200: {
      description: 'Service deleted',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
  },
});

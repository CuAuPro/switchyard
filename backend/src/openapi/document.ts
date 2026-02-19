import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

import { registry } from './registry.js';
import { env } from '../config/env.js';
import './paths.js';
import './schemas.js';

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Switchyard API',
    version: '1.0.0',
    description: 'REST API for managing blue/green deployments and routing state.',
  },
  servers: [
    {
      url: `http://localhost:${env.port}`,
      description: 'Local development',
    },
  ],
});

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: '*',
  }),
);
app.use(express.json());

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

const docsEnabled = (process.env.ENABLE_API_DOCS ?? 'false').toLowerCase() === 'true';
if (docsEnabled) {
  const [{ default: swaggerUi }, { openApiDocument }] = await Promise.all([
    import('swagger-ui-express'),
    import('./openapi/document.js'),
  ]);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.get('/swagger.json', (_req, res) => res.json(openApiDocument));
}

app.use('/api', routes);

app.use(errorHandler);

export default app;

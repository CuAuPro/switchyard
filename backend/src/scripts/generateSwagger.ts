import { promises as fs } from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

import { openApiDocument } from '../openapi/document.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const outDir = path.resolve(__dirname, '..', '..', 'openapi');
const jsonPath = path.join(outDir, 'swagger.json');
const yamlPath = path.join(outDir, 'swagger.yaml');

const write = async () => {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(openApiDocument, null, 2));
  await fs.writeFile(yamlPath, YAML.stringify(openApiDocument));
  console.log(`OpenAPI specs generated at ${jsonPath} and ${yamlPath}`);
};

write().catch((err) => {
  console.error('Failed to generate OpenAPI spec', err);
  process.exit(1);
});

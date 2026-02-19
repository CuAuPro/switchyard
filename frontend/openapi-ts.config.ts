import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../backend/openapi/swagger.json',
  output: 'src/app/rest-api',
  client: 'angular',
  services: {
    asClass: true,
  },
});

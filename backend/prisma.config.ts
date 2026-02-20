import 'dotenv/config';

import { defineConfig } from '@prisma/config';

const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL?.trim() || undefined;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/utils/seed.ts',
  },
  datasource: {
    url: databaseUrl,
    shadowDatabaseUrl,
  },
});

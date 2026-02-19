import 'dotenv/config';
import path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev.db';

const isSqliteUrl = (url: string) => url.startsWith('file:') || url.startsWith('sqlite:');
const isPostgresUrl = (url: string) => url.startsWith('postgres://') || url.startsWith('postgresql://');

const resolveSqlitePath = (url: string) => {
  const withoutScheme = url.replace(/^sqlite:/, 'file:').replace(/^file:/, '');
  if (withoutScheme === ':memory:') {
    return ':memory:';
  }
  return path.isAbsolute(withoutScheme) ? withoutScheme : path.resolve(process.cwd(), withoutScheme);
};

const createAdapter = () => {
  if (isSqliteUrl(databaseUrl)) {
    const sqlitePath = resolveSqlitePath(databaseUrl);
    return {
      adapter: new PrismaBetterSqlite3({ url: sqlitePath as ':memory:' | (string & {}) }),
    };
  }

  if (isPostgresUrl(databaseUrl)) {
    return {
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    };
  }

  throw new Error(`Unsupported DATABASE_URL scheme: ${databaseUrl}`);
};

const { adapter } = createAdapter();

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
  adapter,
});

export const disconnectPrisma = async () => {
  await prisma.$disconnect();
};

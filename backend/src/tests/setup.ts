import { afterAll, jest } from '@jest/globals';

jest.mock('../lib/prisma', () => {
  const deployments: unknown[] = [];
  return {
    prisma: {
      service: {
        findMany: jest.fn(async () => []),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      serviceEnvironment: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      deployment: {
        create: jest.fn(async (args: { data: unknown }) => {
          deployments.push(args.data);
          return args.data;
        }),
        findMany: jest.fn(),
      },
      switchEvent: {
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      $disconnect: jest.fn(),
    },
    disconnectPrisma: jest.fn(),
  };
});

afterAll(async () => {
  const { disconnectPrisma } = await import('../lib/prisma');
  await disconnectPrisma();
});

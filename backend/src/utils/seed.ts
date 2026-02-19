import { hashPassword } from '../auth/password.js';
import { disconnectPrisma, prisma } from '../lib/prisma.js';

const seed = async () => {
  const passwordHash = await hashPassword('Switchyard!123');

  await prisma.user.upsert({
    where: { email: 'admin@switchyard.dev' },
    update: {},
    create: {
      email: 'admin@switchyard.dev',
      name: 'Switchyard Admin',
      passwordHash,
      role: 'admin',
    },
  });

  console.log('Seeded admin user (create services via dashboard/API)');
};

seed()
  .then(() => {
    console.log('Seed complete');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });

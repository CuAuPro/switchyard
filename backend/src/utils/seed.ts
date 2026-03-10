import { hashPassword } from '../auth/password.js';
import { disconnectPrisma, prisma } from '../lib/prisma.js';

const seed = async () => {
  const adminEmail = process.env.ADMIN_EMAIL?.trim() || 'admin@switchyard.dev';
  const adminName = process.env.ADMIN_NAME?.trim() || 'Switchyard Admin';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Switchyard!123';

  if (adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters long');
  }

  const passwordHash = await hashPassword(adminPassword);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: adminName,
      passwordHash,
      role: 'admin',
    },
  });

  console.log(`Seeded admin user ${adminEmail} (create services via dashboard/API)`);
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

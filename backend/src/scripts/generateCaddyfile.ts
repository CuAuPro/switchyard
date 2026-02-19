import { regenerateCaddyfile } from '../lib/caddyfile.js';
import { disconnectPrisma } from '../lib/prisma.js';

regenerateCaddyfile()
  .catch((error) => {
    console.error('Failed to generate Caddyfile', error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });

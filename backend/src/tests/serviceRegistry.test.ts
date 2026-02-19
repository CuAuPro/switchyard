import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/errorHandler.js';
import { registerService, deployVersion } from '../services/serviceRegistry.js';

describe('serviceRegistry', () => {
  const operator = { id: 'user-1', role: 'operator' as const };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects unauthorized users when registering', async () => {
    await expect(
      registerService(
        {
          name: 'api',
          environments: [{ label: 'blue', targetUrl: 'http://blue' }],
        },
        { id: 'viewer', role: 'viewer' },
      ),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('deploys to a given environment', async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue({
      id: 'svc1',
      name: 'svc1',
      environments: [{ id: 'env1', label: 'staging' }],
    });

    (prisma.deployment.create as jest.Mock).mockResolvedValue({ id: 'dep1', version: '1.0.0' });

    const deployment = await deployVersion(
      { serviceId: 'svc1', environmentLabel: 'staging', version: '1.0.0', dockerImage: 'ghcr.io/app:1.0.0' },
      operator,
    );

    expect(deployment).toEqual({ id: 'dep1', version: '1.0.0' });
    expect(prisma.deployment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: '1.0.0', dockerImage: 'ghcr.io/app:1.0.0' }),
      }),
    );
  });
});

import type { Service, ServiceEnvironment } from '@prisma/client';

export type DeploymentEvent =
  | {
      type: 'deployment.created';
      payload: { serviceId: string; environmentId: string | null; version: string; dockerImage?: string };
    }
  | {
      type: 'service.switched';
      payload: { serviceId: string; fromLabel?: string; toLabel: string; reason?: string };
    }
  | {
      type: 'environment.health';
      payload: {
        serviceId: string;
        environmentId: string;
        status: ServiceEnvironment['status'];
        latencyMs?: number | null;
      };
    }
  | {
      type: 'service.updated';
      payload: Service;
    }
  | {
      type: 'service.deleted';
      payload: { serviceId: string };
    };

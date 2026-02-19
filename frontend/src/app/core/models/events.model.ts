export type EnvironmentHealthEvent = {
  type: 'environment.health';
  payload: {
    serviceId: string;
    environmentId: string;
    status: 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | 'draining';
    latencyMs?: number | null;
  };
};

export type DeploymentCreatedEvent = {
  type: 'deployment.created';
  payload: { serviceId: string; environmentId: string | null; version: string; dockerImage?: string };
};

export type ServiceSwitchedEvent = {
  type: 'service.switched';
  payload: { serviceId: string; fromLabel?: string; toLabel: string; reason?: string };
};

export type ServiceUpdatedEvent = {
  type: 'service.updated';
  payload: unknown;
};

export type ServiceDeletedEvent = {
  type: 'service.deleted';
  payload: { serviceId: string };
};

export type RealtimeEvent =
  | EnvironmentHealthEvent
  | DeploymentCreatedEvent
  | ServiceSwitchedEvent
  | ServiceUpdatedEvent
  | ServiceDeletedEvent;

export type EnvironmentStatus = 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | 'draining';
export type ContainerState = 'running' | 'stopped';
export type UserRole = 'viewer' | 'operator' | 'admin';

export interface ServiceEnvironment {
  id: string;
  label: string;
  targetUrl: string;
  status: EnvironmentStatus;
  weightPercent: number;
  isActive: boolean;
  lastLatencyMs?: number | null;
  dockerImage?: string | null;
  hostPort: number | null;
  appPort: number | null;
  containerState: ContainerState;
  containerName: string;
  lastCheckAt?: string | null;
}

export interface ServiceActivity {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  actorId?: string | null;
  actorRole?: UserRole | null;
  environmentId?: string | null;
  environmentLabel?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface Deployment {
  id: string;
  version: string;
  createdAt: string;
  status: string;
  environmentId?: string | null;
  dockerImage?: string | null;
}

export interface Service {
  id: string;
  name: string;
  description?: string | null;
  repositoryUrl?: string | null;
  healthEndpoint?: string | null;
  activeTrafficId?: string | null;
  environments: ServiceEnvironment[];
  deployments: Deployment[];
  activities: ServiceActivity[];
}

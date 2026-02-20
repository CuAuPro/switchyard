import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';

import { Service, ServiceEnvironment, EnvironmentStatus, ServiceActivity } from '../../core/models/service.model';
import { ApiService, UpdateServicePayload, CreateServicePayload } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { RealtimeEvent } from '../../core/models/events.model';
import { SnackbarService, SnackbarVariant } from '../../core/services/snackbar.service';
import { ServiceMetadataModalComponent } from '../../shared/components/service-metadata-modal/service-metadata-modal.component';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ServiceMetadataModalComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  services = signal<Service[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  creating = signal(false);
  detailsSaving = signal(false);
  deleting = signal(false);
  envSaving = signal(new Set<string>());
  envToggling = signal(new Set<string>());
  activityCollapse = signal(new Set<string>());
  healthPulse = signal(new Set<string>());
  serviceForms = new Map<string, FormGroup>();
  envForms = new Map<string, FormGroup>();
  isOperator = signal(false);
  createServiceForm: FormGroup;
  metadataModal = signal<string | null>(null);
  wsStatus = signal<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  wsStatusMessage = signal<string | null>(null);
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Subscription[] = [];
  private pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly statusStyles: Record<EnvironmentStatus, { label: string; className: string }> = {
    healthy: { label: 'Healthy', className: 'status-healthy' },
    degraded: { label: 'Degraded', className: 'status-degraded' },
    unhealthy: { label: 'Unhealthy', className: 'status-unhealthy' },
    draining: { label: 'Draining', className: 'status-draining' },
    unknown: { label: 'Unknown', className: 'status-unknown' },
  };

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private router: Router,
    private realtime: RealtimeService,
    private snackbar: SnackbarService,
    private fb: FormBuilder,
  ) {
    this.createServiceForm = this.fb.nonNullable.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      repositoryUrl: [''],
      dockerImage: ['cuaupro/switchyard-sample:latest', [Validators.required, Validators.minLength(3)]],
      appPort: [4000, [Validators.required, Validators.min(1), Validators.max(65535)]],
      healthEndpoint: [''],
    });
  }

  ngOnInit() {
    if (!this.auth.token()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadData(true);
    this.realtime.connect();
    this.subscriptions.push(
      this.realtime.events$.subscribe((event) => this.handleRealtimeEvent(event)),
      this.realtime.status$.subscribe((status) => {
        this.wsStatus.set(status.state);
        this.wsStatusMessage.set(status.message ?? null);
      }),
    );
  }

  ngOnDestroy() {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }
    this.pulseTimers.forEach((timer) => clearTimeout(timer));
    this.pulseTimers.clear();
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  loadData(forceSpinner = false) {
    const shouldShowSpinner = forceSpinner || this.services().length === 0;
    if (shouldShowSpinner) {
      this.loading.set(true);
    }
    this.isOperator.set(['admin', 'operator'].includes(this.auth.role() ?? 'viewer'));
    this.api.getServices().subscribe({
      next: (services) => {
        const single = services.slice(0, 1);
        this.services.set(single);
        this.services().forEach((svc) => {
          this.ensureServiceForm(svc);
          this.toggleServiceFormState(svc);
          svc.environments.forEach((env) => this.ensureEnvForm(env));
        });
        this.loading.set(false);
        this.clearGlobalError();
      },
      error: (err) => {
        this.setGlobalError('Unable to load services', err);
        this.loading.set(false);
      },
    });
  }

  registerService() {
    if (this.createServiceForm.invalid || this.creating()) return;
    const { name, description, repositoryUrl, dockerImage, appPort, healthEndpoint } =
      this.createServiceForm.getRawValue();
    const appPortNum = Number(appPort);
    this.creating.set(true);
    const payload: CreateServicePayload = {
      name,
      description: description?.trim() || undefined,
      environments: [
        { label: 'staging', dockerImage, appPort: appPortNum, weightPercent: 0 },
        { label: 'prod', dockerImage, appPort: appPortNum, weightPercent: 100 },
      ],
    };
    const repoTrimmed = repositoryUrl?.trim();
    if (repoTrimmed) {
      payload.repositoryUrl = repoTrimmed;
    }
    const healthTrimmed = healthEndpoint?.trim();
    if (healthTrimmed) {
      payload.healthEndpoint = healthTrimmed;
    }
    this.api
      .createService(payload)
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.createServiceForm.reset({
            name: '',
            description: '',
            repositoryUrl: '',
            dockerImage: 'cuaupro/switchyard-sample:latest',
            appPort: 4000,
            healthEndpoint: '',
          });
          this.loadData(true);
        },
        error: (err) => {
          this.setGlobalError('Failed to register service', err);
          this.creating.set(false);
        },
      });
  }

  saveServiceDetails(service: Service) {
    const form = this.serviceForms.get(service.id);
    if (!form) return;
    this.detailsSaving.set(true);
    const raw = form.getRawValue();
    const payload: UpdateServicePayload = {};
    if (typeof raw.description === 'string') {
      payload.description = raw.description;
    }
    if (raw.repositoryUrl?.trim()) {
      payload.repositoryUrl = raw.repositoryUrl.trim();
    }
    if (raw.healthEndpoint?.trim()) {
      payload.healthEndpoint = raw.healthEndpoint.trim();
    }
    this.api.updateService(service.id, payload).subscribe({
      next: () => {
        this.detailsSaving.set(false);
        if (this.metadataModal() === service.id) {
          this.closeMetadataModal();
        }
        this.loadData();
      },
      error: (err) => {
        this.setGlobalError('Failed to save service metadata', err);
        this.detailsSaving.set(false);
      },
    });
  }

  startEnvironment(service: Service, environment: ServiceEnvironment) {
    if (!this.isOperator() || !this.canStart(environment)) return;
    this.setEnvToggling(environment.id, true);
    this.api.startEnvironment(service.id, environment.label).subscribe({
      next: () => {
        this.setEnvToggling(environment.id, false);
        this.loadData();
      },
      error: (err) => {
        this.setEnvToggling(environment.id, false);
        this.setGlobalError(`Failed to start ${environment.label}`, err);
      },
    });
  }

  stopEnvironment(service: Service, environment: ServiceEnvironment) {
    if (!this.isOperator() || !this.canStop(environment)) return;
    this.setEnvToggling(environment.id, true);
    this.api.stopEnvironment(service.id, environment.label).subscribe({
      next: () => {
        this.setEnvToggling(environment.id, false);
        this.loadData();
      },
      error: (err) => {
        this.setEnvToggling(environment.id, false);
        this.setGlobalError(`Failed to stop ${environment.label}`, err);
      },
    });
  }

  updateEnvironment(service: Service, environment: ServiceEnvironment) {
    const form = this.envForms.get(environment.id);
    if (!form?.valid || !this.canEdit(environment)) return;
    this.setEnvSaving(environment.id, true);
    const { dockerImage, appPort } = form.getRawValue();
    this.api
      .updateService(service.id, {
        environments: [
          {
            label: environment.label,
            dockerImage,
            appPort: Number(appPort),
          },
        ],
      })
      .subscribe({
        next: () => {
          this.setEnvSaving(environment.id, false);
          this.loadData();
        },
        error: (err) => {
          this.setEnvSaving(environment.id, false);
          this.setGlobalError(`Failed to update ${environment.label}`, err);
        },
      });
  }

  deleteService(service: Service) {
    if (!this.isOperator()) return;
    const confirmed = window.confirm(
      `Delete ${service.name}? This stops and removes both staging/prod containers.`,
    );
    if (!confirmed) return;
    this.deleting.set(true);
    this.api.deleteService(service.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.loadData(true);
      },
      error: (err) => {
        this.deleting.set(false);
        this.setGlobalError('Failed to delete service', err);
      },
    });
  }

  switchTraffic(service: Service, label: string) {
    if (!this.isOperator()) return;
    const env = service.environments.find((e) => e.label === label);
    if (!env || !this.canRouteTraffic(env)) return;
    this.api
      .switch(service.id, { toLabel: label })
      .subscribe({
        next: () => this.loadData(),
        error: (err) => this.setGlobalError(`Failed to switch to ${label}`, err),
      });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  trackById(_index: number, svc: Service) {
    return svc.id;
  }

  statusLabel(status: EnvironmentStatus) {
    return this.statusStyles[status]?.label ?? 'Unknown';
  }

  statusClass(status: EnvironmentStatus) {
    return this.statusStyles[status]?.className ?? 'status-unknown';
  }

  canEdit(env: ServiceEnvironment) {
    return env.containerState === 'stopped';
  }

  canEditService(service: Service) {
    return service.environments.every((env) => env.containerState === 'stopped');
  }

  canStart(env: ServiceEnvironment) {
    return env.containerState === 'stopped';
  }

  canStop(env: ServiceEnvironment) {
    return env.containerState === 'running';
  }

  canRouteTraffic(env: ServiceEnvironment) {
    return env.containerState === 'running' && !env.isActive;
  }

  routeTooltip(env: ServiceEnvironment) {
    if (env.isActive) return 'Already receiving traffic';
    if (env.containerState !== 'running') return 'Start the container first';
    if (!this.isOperator()) return 'Operator role required';
    return '';
  }

  startTooltip(env: ServiceEnvironment) {
    if (env.containerState === 'running') {
      return 'Container already running';
    }
    return '';
  }

  stopTooltip(env: ServiceEnvironment) {
    if (env.containerState !== 'running') {
      return 'Start the container first';
    }
    return '';
  }

  serviceEditTooltip(service: Service) {
    if (this.canEditService(service)) return '';
    return 'Stop both staging and prod to edit metadata';
  }

  isEnvSaving(envId: string) {
    return this.envSaving().has(envId);
  }

  isEnvToggling(envId: string) {
    return this.envToggling().has(envId);
  }


  activitySlotLabel(activity: ServiceActivity) {
    if (activity.environmentLabel) return `${activity.environmentLabel} slot`;
    return 'service';
  }

  activityActorLabel(activity: ServiceActivity) {
    return activity.actorRole ?? 'system';
  }

  toggleActivity(serviceId: string) {
    const next = new Set(this.activityCollapse());
    if (next.has(serviceId)) {
      next.delete(serviceId);
    } else {
      next.add(serviceId);
    }
    this.activityCollapse.set(next);
  }

  isActivityCollapsed(serviceId: string) {
    return this.activityCollapse().has(serviceId);
  }

  openMetadataModal(serviceId: string) {
    this.metadataModal.set(serviceId);
  }

  closeMetadataModal() {
    this.metadataModal.set(null);
  }

  isMetadataModalOpen(serviceId: string) {
    return this.metadataModal() === serviceId;
  }

  private setEnvSaving(envId: string, saving: boolean) {
    const next = new Set(this.envSaving());
    if (saving) {
      next.add(envId);
    } else {
      next.delete(envId);
    }
    this.envSaving.set(next);
  }

  private setEnvToggling(envId: string, toggling: boolean) {
    const next = new Set(this.envToggling());
    if (toggling) {
      next.add(envId);
    } else {
      next.delete(envId);
    }
    this.envToggling.set(next);
  }

  private ensureServiceForm(service: Service) {
    if (!this.serviceForms.has(service.id)) {
      this.serviceForms.set(
        service.id,
        this.fb.nonNullable.group({
          description: [''],
          repositoryUrl: [''],
          healthEndpoint: [''],
        }),
      );
    }
    this.serviceForms.get(service.id)?.patchValue(
      {
        description: service.description ?? '',
        repositoryUrl: service.repositoryUrl ?? '',
        healthEndpoint: service.healthEndpoint ?? '',
      },
      { emitEvent: false },
    );
  }

  private ensureEnvForm(env: ServiceEnvironment) {
    if (!this.envForms.has(env.id)) {
      this.envForms.set(
        env.id,
        this.fb.nonNullable.group({
          dockerImage: ['', [Validators.required, Validators.minLength(3)]],
          appPort: [4000, [Validators.required, Validators.min(1), Validators.max(65535)]],
        }),
      );
    }
    this.envForms.get(env.id)?.patchValue(
      {
        dockerImage: env.dockerImage ?? '',
        appPort: env.appPort ?? 4000,
      },
      { emitEvent: false },
    );
  }

  private toggleServiceFormState(service: Service) {
    const form = this.serviceForms.get(service.id);
    if (!form) return;
    if (this.canEditService(service)) {
      form.enable({ emitEvent: false });
    } else {
      form.disable({ emitEvent: false });
    }
  }

  private setGlobalError(message: string, error?: unknown) {
    const detail = this.extractErrorDetail(error);
    const composed = detail ? `${message}: ${detail}` : message;
    this.error.set(composed);
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }
    this.errorTimer = setTimeout(() => {
      this.error.set(null);
      this.errorTimer = null;
    }, 10000);
  }

  private clearGlobalError() {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
    this.error.set(null);
  }

  private extractErrorDetail(error?: unknown) {
    if (!error) return '';
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error === 'string' && error.error.trim().length > 0) {
        return `${error.status} ${error.statusText} - ${error.error}`;
      }
      if (error.error && typeof error.error === 'object' && 'message' in error.error) {
        return `${error.status} ${error.statusText} - ${String(error.error.message)}`;
      }
      return `${error.status} ${error.statusText}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return '';
  }

  private handleRealtimeEvent(event: RealtimeEvent) {
    switch (event.type) {
      case 'environment.health':
        this.applyHealthEvent(event.payload);
        break;
      case 'deployment.created':
      case 'service.switched':
      case 'service.updated':
      case 'service.deleted':
        this.showRealtimeNotice(event);
        this.loadData();
        break;
      default:
        this.showRealtimeNotice(event);
        break;
    }
  }

  private applyHealthEvent(payload: { serviceId: string; environmentId: string; status: EnvironmentStatus; latencyMs?: number | null }) {
    let updated = false;
    const next = this.services().map((service) => {
      if (service.id !== payload.serviceId) return service;
      const environments = service.environments.map((env) => {
        if (env.id !== payload.environmentId) return env;
        updated = true;
        return {
          ...env,
          status: payload.status,
          lastLatencyMs: payload.latencyMs ?? null,
          lastCheckAt: new Date().toISOString(),
        };
      });
      return { ...service, environments };
    });

    if (updated) {
      this.services.set(next);
      this.pulseEnvironment(payload.environmentId);
    } else {
      this.loadData();
    }
  }

  isEnvPulsing(environmentId: string) {
    return this.healthPulse().has(environmentId);
  }

  private pulseEnvironment(environmentId: string) {
    if (!environmentId) return;
    const timer = this.pulseTimers.get(environmentId);
    if (timer) {
      clearTimeout(timer);
    }
    const next = new Set(this.healthPulse());
    next.add(environmentId);
    this.healthPulse.set(next);
    const timeout = setTimeout(() => {
      const updated = new Set(this.healthPulse());
      updated.delete(environmentId);
      this.healthPulse.set(updated);
      this.pulseTimers.delete(environmentId);
    }, 1600);
    this.pulseTimers.set(environmentId, timeout);
  }

  private showRealtimeNotice(event: RealtimeEvent) {
    const summary = this.describeEvent(event);
    if (!summary) return;
    this.snackbar.show(summary.title, {
      detail: summary.details,
      variant: summary.variant,
    });
  }

  private describeEvent(event: RealtimeEvent): { title: string; details?: string; variant: SnackbarVariant } | null {
    switch (event.type) {
      case 'environment.health':
        return null;
      case 'deployment.created':
        return {
          title: `Deployment ${event.payload.version}`,
          details: `Env: ${event.payload.environmentId ?? 'n/a'}`,
          variant: 'info',
        };
      case 'service.switched':
        return {
          title: 'Traffic switched',
          details: `Now serving ${event.payload.toLabel}`,
          variant: 'success',
        };
      case 'service.updated':
        return { title: 'Service updated', variant: 'info' };
      case 'service.deleted':
        return { title: 'Service deleted', details: event.payload.serviceId, variant: 'warning' };
      default:
        return null;
    }
  }

}

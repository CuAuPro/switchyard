import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';

import { Service, ServiceEnvironment, EnvironmentStatus, ServiceActivity } from '../../core/models/service.model';
import { ApiService, UpdateServicePayload, CreateServicePayload, SystemStatsPayload } from '../../core/services/api.service';
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
  systemStats = signal<SystemStatsPayload | null>(null);
  systemStatsLoading = signal(false);
  systemStatsError = signal<string | null>(null);
  systemStatsCollapsed = signal(false);
  services = signal<Service[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  creating = signal(false);
  detailsSaving = signal(false);
  deleting = signal(false);
  envSaving = signal(new Set<string>());
  envToggling = signal(new Set<string>());
  activityCollapse = signal(new Set<string>());
  serviceCollapse = signal(new Set<string>());
  healthPulse = signal(new Set<string>());
  serviceForms = new Map<string, FormGroup>();
  envForms = new Map<string, FormGroup>();
  isOperator = signal(false);
  createPanelOpen = signal(false);
  createServiceForm: FormGroup;
  metadataModal = signal<string | null>(null);
  stopProdModal = signal<{ serviceId: string; environmentLabel: string } | null>(null);
  wsStatus = signal<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  wsStatusMessage = signal<string | null>(null);
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Subscription[] = [];
  private pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
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
      registryHost: [''],
      registryUsername: [''],
      registryPassword: [''],
      dockerImage: ['cuaupro/switchyard-sample:latest', [Validators.required, Validators.minLength(3)]],
      appPort: [4000, [Validators.required, Validators.min(1), Validators.max(65535)]],
      healthEndpoint: [''],
      envVarsText: [''],
    });
  }

  ngOnInit() {
    if (!this.auth.token()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadData(true);
    this.loadSystemStats(true);
    this.statsTimer = setInterval(() => this.loadSystemStats(), 20000);
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
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
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
        this.services.set(services);
        if (services.length === 0) {
          this.createPanelOpen.set(true);
        }
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
    const {
      name,
      description,
      repositoryUrl,
      registryHost,
      registryUsername,
      registryPassword,
      dockerImage,
      appPort,
      healthEndpoint,
      envVarsText,
    } =
      this.createServiceForm.getRawValue();
    const appPortNum = Number(appPort);
    const parsedEnvVars = this.parseEnvVarsText(envVarsText);
    if (!this.hasValidRegistryCredentials(registryUsername, registryPassword)) {
      this.setGlobalError('Provide both registry username and registry password, or leave both empty');
      return;
    }
    this.creating.set(true);
    const payload: CreateServicePayload = {
      name,
      description: description?.trim() || undefined,
      environments: [
        { label: 'slot-a', dockerImage, appPort: appPortNum, weightPercent: 0, envVars: parsedEnvVars },
        { label: 'slot-b', dockerImage, appPort: appPortNum, weightPercent: 100, envVars: parsedEnvVars },
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
    const registryHostTrimmed = registryHost?.trim();
    if (registryHostTrimmed) {
      payload.registryHost = registryHostTrimmed;
    }
    const registryUsernameTrimmed = registryUsername?.trim();
    if (registryUsernameTrimmed) {
      payload.registryUsername = registryUsernameTrimmed;
    }
    const registryPasswordTrimmed = registryPassword?.trim();
    if (registryPasswordTrimmed) {
      payload.registryPassword = registryPasswordTrimmed;
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
            registryHost: '',
            registryUsername: '',
            registryPassword: '',
            dockerImage: 'cuaupro/switchyard-sample:latest',
            appPort: 4000,
            healthEndpoint: '',
            envVarsText: '',
          });
          this.createPanelOpen.set(false);
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
    if (typeof raw.registryHost === 'string') {
      payload.registryHost = raw.registryHost.trim();
    }
    if (typeof raw.registryUsername === 'string') {
      payload.registryUsername = raw.registryUsername.trim();
    }
    if (typeof raw.registryPassword === 'string' && raw.registryPassword.trim().length > 0) {
      payload.registryPassword = raw.registryPassword.trim();
    }
    if (!this.hasValidRegistryCredentials(payload.registryUsername, payload.registryPassword)) {
      this.setGlobalError('Provide both registry username and registry password, or leave both empty');
      this.detailsSaving.set(false);
      return;
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
    if (environment.isActive) {
      this.stopProdModal.set({ serviceId: service.id, environmentLabel: environment.label });
      return;
    }
    this.executeStopEnvironment(service, environment);
  }

  confirmStopProd(service: Service, environment: ServiceEnvironment, rerouteFirst: boolean) {
    if (!environment.isActive) {
      this.executeStopEnvironment(service, environment);
      return;
    }
    const target = this.rerouteTarget(service, environment);
    if (rerouteFirst) {
      if (!target) return;
      this.setEnvToggling(environment.id, true);
      this.api.switch(service.id, { toLabel: target.label }).subscribe({
        next: () => {
          this.closeStopProdModal();
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
        },
        error: (err) => {
          this.setEnvToggling(environment.id, false);
          this.setGlobalError(`Failed to reroute before stopping ${environment.label}`, err);
        },
      });
      return;
    }
    this.closeStopProdModal();
    this.executeStopEnvironment(service, environment);
  }

  closeStopProdModal() {
    this.stopProdModal.set(null);
  }

  isStopProdModalOpen(service: Service, environment: ServiceEnvironment) {
    const modal = this.stopProdModal();
    return modal?.serviceId === service.id && modal.environmentLabel === environment.label;
  }

  rerouteTarget(service: Service, environment: ServiceEnvironment) {
    return service.environments.find((candidate) => candidate.id !== environment.id && this.canRouteTraffic(candidate)) ?? null;
  }

  stopProdMessage(service: Service, environment: ServiceEnvironment) {
    const target = this.rerouteTarget(service, environment);
    if (target) {
      return `Stop active ${this.slotName(environment)} and reroute traffic to ${this.slotName(target)} first?`;
    }
    return `Stop active ${this.slotName(environment)}? No running standby slot is available for reroute.`;
  }

  private executeStopEnvironment(service: Service, environment: ServiceEnvironment) {
    this.setEnvToggling(environment.id, true);
    this.api.stopEnvironment(service.id, environment.label).subscribe({
      next: () => {
        this.setEnvToggling(environment.id, false);
        this.closeStopProdModal();
        this.loadData();
      },
      error: (err) => {
        this.setEnvToggling(environment.id, false);
        this.setGlobalError(`Failed to stop ${environment.label}`, err);
      },
    });
  }

  removeEnvironment(service: Service, environment: ServiceEnvironment) {
    if (!this.isOperator() || !this.canRemove(environment)) return;
    this.setEnvToggling(environment.id, true);
    this.api.removeEnvironment(service.id, environment.label).subscribe({
      next: () => {
        this.setEnvToggling(environment.id, false);
        this.loadData();
      },
      error: (err) => {
        this.setEnvToggling(environment.id, false);
        this.setGlobalError(`Failed to remove ${environment.label}`, err);
      },
    });
  }

  updateEnvironment(service: Service, environment: ServiceEnvironment) {
    const form = this.envForms.get(environment.id);
    if (!form?.valid || !this.canEdit(environment)) return;
    this.setEnvSaving(environment.id, true);
    const { dockerImage, appPort, envVarsText } = form.getRawValue();
    const parsedEnvVars = this.parseEnvVarsText(envVarsText);
    this.api
      .updateService(service.id, {
        environments: [
          {
            label: environment.label,
            dockerImage,
            appPort: Number(appPort),
            envVars: parsedEnvVars,
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
      `Delete ${service.name}? This stops and removes both slot-a/slot-b containers.`,
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

  openCreatePanel() {
    if (!this.isOperator()) return;
    this.createPanelOpen.set(true);
  }

  closeCreatePanel() {
    this.createPanelOpen.set(false);
  }

  slotName(env: ServiceEnvironment) {
    if (env.label === 'slot-a') return 'Slot A';
    if (env.label === 'slot-b') return 'Slot B';
    return `Slot ${env.label}`;
  }

  slotRole(env: ServiceEnvironment) {
    return env.isActive ? 'PROD' : 'STAGING';
  }

  orderedEnvironments(service: Service) {
    const rank = (label: string) => {
      if (label === 'slot-a') return 0; // Slot A
      if (label === 'slot-b') return 1; // Slot B
      return 2;
    };
    return [...service.environments].sort((a, b) => rank(a.label) - rank(b.label));
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

  canRemove(env: ServiceEnvironment) {
    return env.containerState === 'stopped';
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
    if (env.isActive) {
      return 'Stopping the active slot requires confirmation';
    }
    return 'Stop container but keep it for later restart';
  }

  removeTooltip(env: ServiceEnvironment) {
    if (!this.isOperator()) return 'Operator role required';
    if (env.containerState !== 'stopped') return 'Stop container before removing it';
    return 'Remove stopped container';
  }

  serviceEditTooltip(service: Service) {
    if (this.canEditService(service)) return '';
    return 'Stop both slots to edit metadata';
  }

  isEnvSaving(envId: string) {
    return this.envSaving().has(envId);
  }

  isEnvToggling(envId: string) {
    return this.envToggling().has(envId);
  }


  activitySlotLabel(activity: ServiceActivity) {
    if (!activity.environmentLabel) return 'service';
    if (activity.environmentLabel === 'slot-a') return 'Slot A';
    if (activity.environmentLabel === 'slot-b') return 'Slot B';
    return `Slot ${activity.environmentLabel}`;
  }

  activityActorLabel(activity: ServiceActivity) {
    return activity.actorRole ?? 'system';
  }

  routeHost(service: Service, env: ServiceEnvironment) {
    const domain = this.routerDomain();
    const serviceName = this.slugify(service.name);
    if (env.isActive) {
      return `${serviceName}.${domain}`;
    }
    if (env.label === 'slot-a' || env.label === 'slot-b') {
      return `staging-${serviceName}.${domain}`;
    }
    return `${serviceName}.${domain}`;
  }

  loadSystemStats(forceSpinner = false) {
    if (forceSpinner) {
      this.systemStatsLoading.set(true);
    }
    this.api.getSystemStats().subscribe({
      next: (stats) => {
        this.systemStats.set(stats);
        this.systemStatsError.set(null);
        this.systemStatsLoading.set(false);
      },
      error: (err) => {
        this.systemStatsLoading.set(false);
        this.systemStatsError.set(this.extractErrorDetail(err) || 'Unable to load system stats');
      },
    });
  }

  toggleSystemStats() {
    this.systemStatsCollapsed.set(!this.systemStatsCollapsed());
  }

  routeUrl(service: Service, env: ServiceEnvironment) {
    const port = this.routerPort();
    const portSuffix = port ? `:${port}` : '';
    return `http://${this.routeHost(service, env)}${portSuffix}`;
  }

  routeLabel(service: Service, env: ServiceEnvironment) {
    const port = this.routerPort();
    const portSuffix = port ? `:${port}` : '';
    return `${this.routeHost(service, env)}${portSuffix}`;
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

  toggleServiceCard(serviceId: string) {
    const next = new Set(this.serviceCollapse());
    if (next.has(serviceId)) {
      next.delete(serviceId);
    } else {
      next.add(serviceId);
    }
    this.serviceCollapse.set(next);
  }

  isServiceCollapsed(serviceId: string) {
    return this.serviceCollapse().has(serviceId);
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
          registryHost: [''],
          registryUsername: [''],
          registryPassword: [''],
        }),
      );
    }
    this.serviceForms.get(service.id)?.patchValue(
      {
        description: service.description ?? '',
        repositoryUrl: service.repositoryUrl ?? '',
        healthEndpoint: service.healthEndpoint ?? '',
        registryHost: service.registryHost ?? '',
        registryUsername: service.registryUsername ?? '',
        registryPassword: '',
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
          envVarsText: [''],
        }),
      );
    }
    this.envForms.get(env.id)?.patchValue(
      {
        dockerImage: env.dockerImage ?? '',
        appPort: env.appPort ?? 4000,
        envVarsText: this.formatEnvVars(env.envVars),
      },
      { emitEvent: false },
    );
  }

  private parseEnvVarsText(raw: string): Record<string, string> | undefined {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return undefined;
    const envVars: Record<string, string> = {};
    for (const line of lines) {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) continue;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!key) continue;
      envVars[key] = value;
    }
    return Object.keys(envVars).length > 0 ? envVars : undefined;
  }

  private formatEnvVars(envVars?: Record<string, string> | null): string {
    if (!envVars) return '';
    return Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
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

  private routerDomain() {
    const hostname = window.location.hostname;
    if (hostname.startsWith('console.')) {
      return hostname.slice('console.'.length);
    }
    return hostname;
  }

  private routerPort() {
    const { hostname, port } = window.location;
    if (port && port !== '80' && port !== '443' && port !== '4200') {
      return port;
    }
    if ((hostname === 'localhost' || hostname.endsWith('.localhost')) && port === '4200') {
      return '8080';
    }
    return '';
  }

  private slugify(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  containerStats() {
    const stats = this.systemStats();
    if (!stats) return [];
    return [...stats.docker.containers].sort((a, b) => {
      const byService = a.serviceName.localeCompare(b.serviceName);
      if (byService !== 0) return byService;
      return a.environmentLabel.localeCompare(b.environmentLabel);
    });
  }

  containerStateClass(state: 'running' | 'stopped' | 'missing') {
    if (state === 'running') return 'status-healthy';
    if (state === 'stopped') return 'status-degraded';
    return 'status-unhealthy';
  }

  formatPercent(value: number | null | undefined, digits = 1) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
    return `${value.toFixed(digits)}%`;
  }

  formatBytes(value: number | null | undefined) {
    if (typeof value !== 'number' || value <= 0) return 'n/a';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx += 1;
    }
    return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  formatUptime(seconds: number | null | undefined) {
    if (typeof seconds !== 'number' || seconds < 0) return 'n/a';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  private hasValidRegistryCredentials(username?: string, password?: string) {
    const hasUsername = typeof username === 'string' && username.trim().length > 0;
    const hasPassword = typeof password === 'string' && password.trim().length > 0;
    return hasUsername === hasPassword;
  }

}

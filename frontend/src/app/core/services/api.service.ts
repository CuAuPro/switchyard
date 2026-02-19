import { Injectable } from '@angular/core';
import { from, map, Observable } from 'rxjs';

import { Service } from '../models/service.model';
import {
  CreateServiceRequest,
  PostApiServicesByServiceIdDeploymentsData,
  PostApiServicesByServiceIdSwitchData,
  UpdateServiceRequest,
  deleteApiServicesByServiceId,
  getApiServices,
  patchApiServicesByServiceId,
  postApiServices,
  postApiServicesByServiceIdDeployments,
  postApiServicesByServiceIdEnvironmentsByLabelStart,
  postApiServicesByServiceIdEnvironmentsByLabelStop,
  postApiServicesByServiceIdSwitch,
} from '../../rest-api';

export type CreateServicePayload = CreateServiceRequest;
export type UpdateServicePayload = UpdateServiceRequest;

@Injectable({ providedIn: 'root' })
export class ApiService {
  getServices(): Observable<Service[]> {
    return from(
      getApiServices({
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(map((data) => data as unknown as Service[]));
  }

  createService(payload: CreateServicePayload) {
    return from(
      postApiServices({
        body: payload,
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(map((data) => data as unknown as Service));
  }

  updateService(serviceId: string, payload: UpdateServicePayload) {
    return from(
      patchApiServicesByServiceId({
        path: { serviceId },
        body: payload,
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(map((data) => data as unknown as Service));
  }

  deploy(serviceId: string, payload: PostApiServicesByServiceIdDeploymentsData['body']) {
    return from(
      postApiServicesByServiceIdDeployments({
        path: { serviceId },
        body: payload,
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    );
  }

  switch(serviceId: string, payload: PostApiServicesByServiceIdSwitchData['body']) {
    return from(
      postApiServicesByServiceIdSwitch({
        path: { serviceId },
        body: payload,
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(map((data) => data as unknown as Service));
  }

  startEnvironment(serviceId: string, label: string) {
    return from(
      postApiServicesByServiceIdEnvironmentsByLabelStart({
        path: { serviceId, label },
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(map((data) => data as unknown as Service));
  }

  stopEnvironment(serviceId: string, label: string) {
    return from(
      postApiServicesByServiceIdEnvironmentsByLabelStop({
        path: { serviceId, label },
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(map((data) => data as unknown as Service));
  }

  deleteService(serviceId: string) {
    return from(
      deleteApiServicesByServiceId({
        path: { serviceId },
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(map((data) => data as unknown as { success: boolean }));
  }
}

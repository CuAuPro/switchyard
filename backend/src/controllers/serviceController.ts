import { Request, Response } from 'express';

import { AuthenticatedRequest } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  deleteService,
  deployVersion,
  listServices,
  registerService,
  startEnvironment,
  stopEnvironment,
  switchEnvironment,
  updateServiceConfig,
} from '../services/serviceRegistry.js';
import { createServiceSchema, deploySchema, switchSchema, updateServiceSchema } from '../utils/validators.js';

const ensureServiceId = (value: string | string[] | undefined) => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Invalid service id');
  }
  return value;
};

const ensureLabel = (value: string | string[] | undefined) => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Invalid environment label');
  }
  return value;
};

export const postService = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.message);
  }
  const service = await registerService(parsed.data, req.user!);
  res.status(201).json(service);
};

export const getServices = async (_req: Request, res: Response) => {
  const services = await listServices();
  res.json(services);
};

export const deploy = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = deploySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.message);
  }
  const serviceId = ensureServiceId(req.params.serviceId);
  const deployment = await deployVersion({ ...parsed.data, serviceId }, req.user!);
  res.status(202).json(deployment);
};

export const switchEnv = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = switchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.message);
  }
  const serviceId = ensureServiceId(req.params.serviceId);
  const updated = await switchEnvironment({ ...parsed.data, serviceId, initiatedBy: req.user?.id }, req.user!);
  res.json(updated);
};

export const patchService = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.message);
  }
  const serviceId = ensureServiceId(req.params.serviceId);
  const service = await updateServiceConfig({ ...parsed.data, serviceId }, req.user!);
  res.json(service);
};

export const startEnv = async (req: AuthenticatedRequest, res: Response) => {
  const serviceId = ensureServiceId(req.params.serviceId);
  const label = ensureLabel(req.params.label);
  const service = await startEnvironment({ serviceId, environmentLabel: label }, req.user!);
  res.json(service);
};

export const stopEnv = async (req: AuthenticatedRequest, res: Response) => {
  const serviceId = ensureServiceId(req.params.serviceId);
  const label = ensureLabel(req.params.label);
  const service = await stopEnvironment({ serviceId, environmentLabel: label }, req.user!);
  res.json(service);
};

export const removeService = async (req: AuthenticatedRequest, res: Response) => {
  const serviceId = ensureServiceId(req.params.serviceId);
  const result = await deleteService(serviceId, req.user!);
  res.json(result);
};

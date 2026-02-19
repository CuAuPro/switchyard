import { Request, Response } from 'express';

import { signToken } from '../auth/jwt.js';
import { verifyPassword } from '../auth/password.js';
import { prisma } from '../lib/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { loginSchema } from '../utils/validators.js';

export const login = async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.message);
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const match = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!match) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  res.json({ token, role: user.role, name: user.name });
};

export const currentUser = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, 'Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  res.json(user);
};

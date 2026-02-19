import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';

import { env, Role } from '../config/env.js';

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
};

const jwtSecret: Secret = env.jwtSecret;
const jwtExpiresIn = env.jwtExpiresIn as SignOptions['expiresIn'];
const signOptions: SignOptions = { expiresIn: jwtExpiresIn };

export const signToken = (payload: JwtPayload) =>
  jwt.sign(payload, jwtSecret, signOptions);

export const verifyToken = (token: string): JwtPayload => jwt.verify(token, jwtSecret) as JwtPayload;

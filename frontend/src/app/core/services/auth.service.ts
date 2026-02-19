import { Injectable, signal } from '@angular/core';
import { from, tap } from 'rxjs';

import { appEnv } from '../config/app-env';
import { client } from '../../rest-api/client.gen';
import { getApiAuthMe, postApiAuthLogin } from '../../rest-api';

type Role = 'viewer' | 'operator' | 'admin';

type LoginResponse = {
  token: string;
  role: Role;
  name: string;
};

type ProfileResponse = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

type StoredSession = {
  token: string;
  role: Role;
  name: string;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'switchyard_session';
  private profileLoaded = false;

  token = signal<string | null>(null);
  role = signal<Role | null>(null);
  name = signal<string | null>(null);

  constructor() {
    const apiHost = appEnv.apiBaseUrl.replace(/\/api$/, '');
    client.setConfig({
      baseUrl: apiHost,
      auth: () => this.token() ?? undefined,
    });

    const session = this.getStoredSession();
    if (session) {
      this.token.set(session.token);
      this.role.set(session.role);
      this.name.set(session.name);
    }
  }

  login(email: string, password: string) {
    return from(
      postApiAuthLogin({
        body: { email, password },
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).pipe(
      tap((res) => {
        const data = res as unknown as LoginResponse;
        this.token.set(data.token);
        this.role.set(data.role);
        this.name.set(data.name);
        this.profileLoaded = true;
        this.persistSession({ token: data.token, role: data.role, name: data.name });
      }),
    );
  }

  logout() {
    localStorage.removeItem(this.storageKey);
    this.token.set(null);
    this.role.set(null);
    this.name.set(null);
    this.profileLoaded = false;
  }

  bootstrapSession() {
    if (!this.token() || this.profileLoaded) {
      return;
    }

    from(
      getApiAuthMe({
        responseStyle: 'data' as const,
        throwOnError: true as const,
      }),
    ).subscribe({
      next: (profile) => {
        const data = profile as unknown as ProfileResponse;
        this.role.set(data.role);
        this.name.set(data.name);
        this.profileLoaded = true;
        this.persistSession({ token: this.token()!, role: data.role, name: data.name });
      },
      error: () => {
        this.logout();
      },
    });
  }

  private getStoredSession(): StoredSession | null {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      localStorage.removeItem(this.storageKey);
      return null;
    }
  }

  private persistSession(session: StoredSession) {
    localStorage.setItem(this.storageKey, JSON.stringify(session));
  }
}

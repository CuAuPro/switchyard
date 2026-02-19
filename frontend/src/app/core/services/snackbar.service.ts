import { Injectable, signal } from '@angular/core';

export type SnackbarVariant = 'info' | 'success' | 'warning' | 'error';

export type SnackbarMessage = {
  id: number;
  title: string;
  detail?: string;
  variant: SnackbarVariant;
};

@Injectable({ providedIn: 'root' })
export class SnackbarService {
  private incrementingId = 0;
  private readonly snacks = signal<SnackbarMessage[]>([]);

  readonly snackbars = this.snacks.asReadonly();

  show(title: string, options?: { detail?: string; variant?: SnackbarVariant; durationMs?: number }) {
    const id = ++this.incrementingId;
    const message: SnackbarMessage = {
      id,
      title,
      detail: options?.detail,
      variant: options?.variant ?? 'info',
    };
    this.snacks.update((current) => [...current, message]);
    const duration = options?.durationMs ?? 5000;
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
    return id;
  }

  dismiss(id: number) {
    this.snacks.update((current) => current.filter((message) => message.id !== id));
  }

  clearAll() {
    this.snacks.set([]);
  }
}

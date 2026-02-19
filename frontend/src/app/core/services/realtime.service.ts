import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

import { appEnv } from '../config/app-env';
import { RealtimeEvent } from '../models/events.model';

export type RealtimeConnectionState = 'connecting' | 'open' | 'closed' | 'error';
export type RealtimeStatus = { state: RealtimeConnectionState; message?: string };

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private eventsSubject = new Subject<RealtimeEvent>();
  private statusSubject = new BehaviorSubject<RealtimeStatus>({ state: 'connecting' });

  events$ = this.eventsSubject.asObservable();
  status$ = this.statusSubject.asObservable();

  constructor(private zone: NgZone) {}

  connect() {
    if (this.socket) {
      return;
    }

    this.statusSubject.next({ state: 'connecting' });
    this.socket = new WebSocket(appEnv.wsBaseUrl);

    this.socket.onopen = () => {
      this.zone.run(() => this.statusSubject.next({ state: 'open' }));
    };

    this.socket.onmessage = (event) => {
      this.zone.run(() => this.handleMessage(event.data));
    };

    this.socket.onerror = () => {
      this.zone.run(() =>
        this.statusSubject.next({ state: 'error', message: 'Realtime channel encountered an error.' }),
      );
    };

    this.socket.onclose = () => {
      this.zone.run(() => this.statusSubject.next({ state: 'closed' }));
      this.socket = undefined;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    };
  }

  private handleMessage(raw: string) {
    try {
      const parsed = JSON.parse(raw) as RealtimeEvent;
      this.eventsSubject.next(parsed);
    } catch (error) {
      this.statusSubject.next({ state: 'error', message: 'Received malformed realtime event.' });
    }
  }
}

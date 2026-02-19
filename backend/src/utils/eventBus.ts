import { EventEmitter } from 'events';

import { DeploymentEvent } from '../types/events.js';

class EventBus extends EventEmitter {
  emitEvent(event: DeploymentEvent) {
    this.emit(event.type, event);
    this.emit('message', event);
  }
}

export const eventBus = new EventBus();

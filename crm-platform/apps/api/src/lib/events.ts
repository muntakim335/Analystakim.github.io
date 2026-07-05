/**
 * In-process domain event bus. Services emit AFTER their transaction commits;
 * subscribers (workflow engine, notifiers) run async and must never throw into
 * the request path. Swap point for a Redis-backed queue at scale.
 */
export type DomainEventType =
  | 'lead.created'
  | 'contact.created'
  | 'deal.created'
  | 'deal.stage_changed'
  | 'deal.won'
  | 'deal.lost'
  | 'task.completed';

export interface DomainEvent {
  type: DomainEventType;
  orgId: string;
  actorId: string;
  entityType: 'lead' | 'contact' | 'deal' | 'task';
  entityId: string;
  /** Flat snapshot of the entity (plus context like fromStage/toStage). */
  data: Record<string, unknown>;
}

type Handler = (event: DomainEvent) => Promise<void>;

export class EventBus {
  private handlers: Handler[] = [];
  private pending = new Set<Promise<void>>();

  subscribe(handler: Handler): void {
    this.handlers.push(handler);
  }

  emit(event: DomainEvent): void {
    for (const handler of this.handlers) {
      const p = handler(event)
        .catch((err) => {
          // Subscribers own their errors; the request that emitted must not fail.
          console.error(`event handler failed for ${event.type}:`, err);
        })
        .finally(() => this.pending.delete(p));
      this.pending.add(p);
    }
  }

  /** Test helper: wait until all in-flight handlers settle. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}

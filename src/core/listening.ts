import type { ListeningEvent } from './types';

/** Network retries keep the session, but old capture / IPC events must not revive its old attempt. */
export class ListeningEpoch {
  private generation = 0;
  accept(event: ListeningEvent): boolean {
    if (event.type === 'recovering') {
      if (event.attempt <= this.generation) return false;
      this.generation = event.attempt;
      return true;
    }
    return (event.generation ?? 0) === this.generation;
  }
}

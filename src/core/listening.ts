import type { ListeningEvent } from './types';

/** Network retries keep the session, but old capture / IPC events must not revive its old attempt. */
export class ListeningEpoch {
  private generation = 0;
  private speakers = new Map<string, number>();

  speaker(id: string | undefined): number | undefined {
    if (!id) return undefined;
    // The provider can reuse the same identifiers after reconnecting.
    const key = `${this.generation}:${id}`;
    const existing = this.speakers.get(key);
    if (existing !== undefined) return existing;
    const number = this.speakers.size + 1;
    this.speakers.set(key, number);
    return number;
  }

  accept(event: ListeningEvent): boolean {
    if (event.type === 'recovering') {
      if (event.attempt <= this.generation) return false;
      this.generation = event.attempt;
      return true;
    }
    return (event.generation ?? 0) === this.generation;
  }
}

/** Stop admits only final text and matching translations for the existing generation. */
export function acceptDuringDrain(event: ListeningEvent): boolean {
  return (
    event.type === 'translation' ||
    event.type === 'translationError' ||
    (event.type === 'transcript' && event.final)
  );
}

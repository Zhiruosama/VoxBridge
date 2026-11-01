import type { ProviderProfile } from './types';
import { speechOptions, supportsEmotion } from './speech-options';

export type ConversationTurn = { role: 'self' | 'remote'; text: string };
export type SpeechPlan = {
  translation: string;
  speech?: { emotion?: string; speed_multiplier?: number };
};

/** Session-only, receipt-time history. Corrections replace hypotheses, never duplicate them. */
export class SpeechConversation {
  private turns: (ConversationTurn & { id: string; at: number })[] = [];
  clear() {
    this.turns = [];
  }
  remember(id: string, role: ConversationTurn['role'], text: string, now = Date.now()) {
    this.turns = this.turns.filter((turn) => turn.id !== id && now - turn.at <= 60_000);
    if (text.trim())
      this.turns.push({ id, role, text: Array.from(text.trim()).slice(-1200).join(''), at: now });
    this.turns = this.turns.slice(-12);
  }
  snapshot(now = Date.now()): ConversationTurn[] {
    const selected: ConversationTurn[] = [];
    let characters = 0;
    for (const turn of this.turns.slice().reverse()) {
      if (now - turn.at > 60_000) continue;
      if (characters + turn.text.length > 4000) break;
      selected.unshift({ role: turn.role, text: turn.text });
      characters += turn.text.length;
    }
    return selected;
  }
}

/** Per-request copy: automatic prosody never overwrites saved voice settings. */
export function plannedSpeech(profile: ProviderProfile, plan?: SpeechPlan): ProviderProfile {
  const baseline = speechOptions(profile);
  if (!plan?.speech || profile.adapter !== 'minimax_tts_ws' || baseline.emotion !== 'auto')
    return profile;
  const common = ['calm', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];
  const emotion =
    common.includes(plan.speech.emotion ?? '') &&
    supportsEmotion(profile.modelId, plan.speech.emotion!)
      ? (plan.speech.emotion as typeof baseline.emotion)
      : 'auto';
  const multiplier = plan.speech.speed_multiplier;
  const factor =
    typeof multiplier === 'number' &&
    Number.isFinite(multiplier) &&
    multiplier >= 0.9 &&
    multiplier <= 1.1
      ? multiplier
      : 1;
  return {
    ...profile,
    speed: Math.min(2, Math.max(0.5, (profile.speed ?? 1) * factor)),
    speechOptions: { ...baseline, emotion },
  };
}

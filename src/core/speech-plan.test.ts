import { describe, expect, it } from 'vitest';
import { SpeechConversation, plannedSpeech } from './speech-plan';
import { defaults, parseSettings } from './settings';
import { speechOptionDefaults } from './speech-options';

describe('contextual speech', () => {
  it('keeps bounded session history, replaces corrections and expires old conversations', () => {
    const history = new SpeechConversation();
    history.remember('one', 'remote', 'fifteen dollars', 0);
    const snapshot = history.snapshot(100);
    history.remember('one', 'remote', 'fifty dollars', 200);
    history.remember('self', 'self', 'really?', 300);
    expect(snapshot).toEqual([{ role: 'remote', text: 'fifteen dollars' }]);
    expect(history.snapshot(400)).toEqual([
      { role: 'remote', text: 'fifty dollars' },
      { role: 'self', text: 'really?' },
    ]);
    expect(history.snapshot(61_000)).toEqual([]);
    for (let i = 0; i < 20; i++) history.remember(String(i), 'remote', '中'.repeat(1000), 62_000);
    expect(history.snapshot(62_001).length).toBe(4);
    history.clear();
    expect(history.snapshot(62_001)).toEqual([]);
  });
  it('preserves voice identity and manual emotion, bounds automatic speed, and respects model capabilities', () => {
    const profile = {
      ...defaults.profiles[2],
      adapter: 'minimax_tts_ws' as const,
      modelId: 'speech-2.8-turbo',
      voice: 'my-voice',
      speed: 1.1,
    };
    const result = plannedSpeech(profile, {
      translation: 'Hello',
      speech: { emotion: 'happy', speed_multiplier: 1.05 },
    });
    expect(result.voice).toBe('my-voice');
    expect(result.speed).toBeCloseTo(1.155);
    expect(result.speechOptions).toEqual({ ...speechOptionDefaults, emotion: 'happy' });
    expect(profile.speechOptions).toBeUndefined();
    const manual = {
      ...profile,
      speechOptions: { ...speechOptionDefaults, emotion: 'calm' as const },
    };
    expect(
      plannedSpeech(manual, {
        translation: 'Hi',
        speech: { emotion: 'angry', speed_multiplier: 1.1 },
      }),
    ).toBe(manual);
    expect(
      plannedSpeech(profile, {
        translation: 'Hi',
        speech: { emotion: 'whisper', speed_multiplier: 8 },
      }),
    ).toMatchObject({ speed: 1.1, speechOptions: { emotion: 'auto' } });
    expect(
      plannedSpeech(
        { ...profile, modelId: 'new-model' },
        { translation: 'Hi', speech: { emotion: 'angry' } },
      ).speechOptions?.emotion,
    ).toBe('auto');
  });
  it('persists only the opt-in setting, not conversation history', () => {
    expect(parseSettings(defaults).composer.contextualSpeech).toBeUndefined();
    const settings = structuredClone(defaults);
    settings.composer.contextualSpeech = true;
    expect(parseSettings(settings).composer.contextualSpeech).toBe(true);
  });
});

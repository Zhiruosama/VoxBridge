import MacWindowChrome from './components/MacWindowChrome';
import { automaticUpdateBlocker } from './core/app-update';
import { clearUpdateDrafts, readUpdateDrafts, saveUpdateDrafts } from './core/update-drafts';
import TextTranslation from './components/TextTranslation';
import { useTextTools } from './hooks/useTextTools';
import { TextTranslationController } from './core/text-translation';
import { watchFrontendErrors, recordDiagnostic } from './diagnostics';
import { useTheme } from './hooks/useTheme';
import SidebarResizeHandle from './components/SidebarResizeHandle';
import WindowChrome from './components/WindowChrome';
import { configurationSection, type ConfigurationSection } from './core/configuration-guidance';
import { useSidebarLayout } from './hooks/useSidebarLayout';
import { workspaceMinimum } from './core/sidebar-layout';
import { t, setUiLanguage, useUiLanguage } from './i18n';
import SendQueueControls from './components/SendQueueControls';
import type { QueueAction } from './core/send-queue';
import { SendQueue, type QueueView } from './core/send-queue';
import {
  prepareSpeech,
  playPreparedSpeech,
  discardPreparedSpeech,
  setMainCloseBehavior,
} from './bridge';
import SpeechSpeedPicker from './components/SpeechSpeedPicker';
import { updateSpeechProfile } from './core/speech-presets';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import CaptionFeed from './components/CaptionFeed';
import { workspaceCaptions } from './core/caption-layout';
import { useReadingFollow } from './hooks/useReadingFollow';
import VoiceActivity from './components/VoiceActivity';
import SpeechPicker from './components/SpeechPicker';
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  ChevronDown,
  Headphones,
  Languages,
  MessageSquare,
  Mic,
  Volume2,
  PanelLeftClose,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import SettingsPanel, { type SettingsSection } from './components/SettingsPanel';
import { appUpdates } from './app-updates';
import Diagnostics from './components/Diagnostics';
import Select from './components/Select';
import AppNotices from './components/AppNotices';
import ListeningStatus, {
  ListeningNotice,
  type ListeningProgress,
} from './components/ListeningStatus';
import { defaults, loadSettings, profileFor, saveSettings, validateProfile } from './core/settings';
import type {
  CaptureSource,
  ListeningEvent,
  RuntimeInfo,
  Session,
  Settings,
  OverlayVoiceRequest,
} from './core/types';
import {
  appendExpression,
  applyTranscript,
  applyTranslation,
  applyTranslationError,
  discardUnfinished,
  endSession,
} from './core/session';
import { overlaySnapshot } from './core/overlay';
import { ListeningEpoch, acceptDuringDrain } from './core/listening';
import { CaptureSignalMonitor, type CaptureHealth } from './core/capture-health';
import {
  ComposerController,
  composerKeyAction,
  composerLanguages,
  type ComposerPhase,
} from './core/composer';
import { listen } from '@tauri-apps/api/event';
import {
  startVoiceInput,
  finishVoiceInput,
  cancelVoiceInput,
  cancelTranslation,
  detectTextLanguage,
  desktop,
  listCaptureSources,
  listOutputs,
  publishOverlay,
  publishOverlayVoice,
  readOverlayVoice,
  readOverlay,
  showOverlay,
  runtimeInfo,
  speak,
  startListening,
  stopCapture,
  finishListening,
  stopSpeech,
  setSpeechMonitoring,
  translate,
} from './bridge';

import { captureSourceKey, captureSourceLabel } from './core/capture-sources';
import { migrateLegacyOutputRouting } from './core/audio-routing';
import { ComposerSetupError, preflightComposer } from './core/composer-preflight';
import { inspectSpeechOutput } from './bridge';
import { useTextSelection } from './hooks/useTextSelection';

const languages = [
  '英语',
  '简体中文',
  '日语',
  '韩语',
  '西班牙语',
  '印尼语',
  '粤语',
  '芬兰语',
  '俄语',
  '德语',
];
type Page = 'workspace' | 'text' | 'settings' | 'diagnostics';

export default function App({ bootstrapError = '' }: { bootstrapError?: string }) {
  useUiLanguage();
  useTextSelection();
  useEffect(watchFrontendErrors, []);
  const [initial] = useState(() => {
    try {
      return { settings: loadSettings(), error: bootstrapError };
    } catch {
      return {
        settings: structuredClone(defaults),
        error: '本地设置无法读取，已使用默认配置。请到设置页重新保存。',
      };
    }
  });
  const [updateDrafts] = useState(readUpdateDrafts);
  useEffect(() => {
    try {
      clearUpdateDrafts();
    } catch {
      /* Reading can still work in restricted storage. */
    }
  }, []);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  useEffect(() => setUiLanguage(settings.uiLanguage), [settings.uiLanguage]);
  const [savedSettings, setSavedSettings] = useState<Settings>(initial.settings);
  const [page, setPage] = useState<Page>('workspace');
  const [textTranslation] = useState(
    () =>
      new TextTranslationController(
        { translate, cancelTranslation },
        initial.settings.targetLanguage,
        updateDrafts?.translation,
      ),
  );
  useEffect(() => () => textTranslation.cancel(), [textTranslation]);
  const textTools = useTextTools(textTranslation, settings, () => setPage('text'));
  useEffect(() => {
    recordDiagnostic({ operation: 'frontend', kind: 'state', phase: `page_${page}` });
  }, [page]);
  useEffect(() => {
    if (initial.error)
      recordDiagnostic({
        operation: 'frontend',
        kind: 'error',
        phase: 'settings_load_failed',
        reason: 'configuration',
      });
    else
      recordDiagnostic({
        operation: 'frontend',
        kind: 'state',
        phase: 'settings_loaded',
        count: initial.settings.profiles.filter((profile) => !validateProfile(profile)).length,
      });
  }, [initial]);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [settingsFocus, setSettingsFocus] = useState<{ id: string; version: number } | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    id: number;
    section: ConfigurationSection | null;
  }>({ message: initial.error, id: 0, section: null });
  const notify = useCallback((message: string, section?: ConfigurationSection) => {
    setNotice((current) => ({
      message,
      id: current.id + 1,
      section: section ?? configurationSection(message),
    }));
  }, []);
  const dismissNotice = useCallback(() => {
    setNotice((current) => ({ ...current, message: '' }));
  }, []);
  const [session, setSession] = useState<Session>({ id: null, segments: [] });
  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [captureSourceId, setCaptureSourceId] = useState('');
  const [refreshingSources, setRefreshingSources] = useState(false);
  const [listenPhase, setListenPhase] = useState<
    'idle' | 'starting' | 'running' | 'recovering' | 'stopping'
  >('idle');
  const [recognitionMetrics, setRecognitionMetrics] = useState<
    Extract<ListeningEvent, { type: 'recognitionMetrics' }>['metrics'] | null
  >(null);
  const [translationMetrics, setTranslationMetrics] = useState<
    Extract<ListeningEvent, { type: 'translationMetrics' }>['metrics'] | null
  >(null);
  const [listenProgress, setListenProgress] = useState<ListeningProgress | null>(null);
  const [listenHealth, setListenHealth] = useState<CaptureHealth>('waiting');
  const [listenError, setListenError] = useState('');
  const [recovery, setRecovery] = useState<Extract<ListeningEvent, { type: 'recovering' }> | null>(
    null,
  );
  const listeningRef = useRef<string | null>(null);
  const listenStoppingRef = useRef(false);
  const listenEpochRef = useRef(new ListeningEpoch());
  const listening = listenPhase !== 'idle';
  const [text, setText] = useState(updateDrafts?.main ?? '');
  const draftRevisionRef = useRef(0);
  const voiceRef = useRef<{
    id: string;
    cancelled: boolean;
    finishing: boolean;
    origin: 'main' | 'overlay';
  } | null>(null);
  const [voice, setVoice] = useState<{
    phase: 'starting' | 'recording' | 'recognizing' | 'cancelling';
    seconds: number;
    level: number;
  } | null>(null);
  const [composerPhase, setComposerPhase] = useState<ComposerPhase>('idle');
  const busy = composerPhase !== 'idle';
  const [composer] = useState(
    () =>
      new ComposerController({
        detectLanguage: detectTextLanguage,
        translate,
        speak,
        cancelTranslation,
        stopSpeech,
        setMonitoring: setSpeechMonitoring,
      }),
  );
  const [queueView, setQueueView] = useState<QueueView>({ paused: false, items: [] });
  const [unsavedKey, setUnsavedKey] = useState(false);
  const updateBlocked = useRef<boolean | string>(true);
  const automaticUpdateBlocked = useRef<false | string>(false);
  const prepareUpdate = useRef(() => {});
  useEffect(() => {
    if (!desktop) return;
    appUpdates.blocked = (automatic) =>
      updateBlocked.current || (automatic ? automaticUpdateBlocked.current : false);
    appUpdates.setAutomatic(initial.settings.automaticUpdates);
    appUpdates.beforeInstall = () => prepareUpdate.current();
    appUpdates.installFailed = clearUpdateDrafts;
    void appUpdates.checkAtStartup();
    return () => {
      appUpdates.blocked = () => true;
      appUpdates.beforeInstall = () => {};
      appUpdates.installFailed = () => {};
    };
  }, [notify]);
  useEffect(() => {
    appUpdates.setAutomatic(savedSettings.automaticUpdates);
  }, [savedSettings.automaticUpdates]);
  const [sendQueue] = useState(
    () =>
      new SendQueue({
        detectLanguage: detectTextLanguage,
        translate,
        speak,
        cancelTranslation,
        stopSpeech,
        setMonitoring: setSpeechMonitoring,
        prepare: prepareSpeech,
        playPrepared: playPreparedSpeech,
        discardPrepared: discardPreparedSpeech,
      }),
  );
  useEffect(
    () =>
      sendQueue.subscribe((view) => {
        setQueueView(view);
        const active = view.items.find((item) => item.active);
        setComposerPhase(
          active &&
            [
              'detecting',
              'waitingDevice',
              'translating',
              'synthesizing',
              'decoding',
              'playing',
              'stopping',
            ].includes(active.status)
            ? (active.status as ComposerPhase)
            : 'idle',
        );
      }),
    [sendQueue],
  );
  useEffect(
    () => () => {
      void sendQueue.clear();
    },
    [sendQueue],
  );
  function queueAction(action: QueueAction) {
    if (action.action === 'queuePause') sendQueue.pause();
    else if (action.action === 'queueResume') sendQueue.resume();
    else if (action.action === 'queueCancel') void sendQueue.cancel(action.id);
    else if (action.action === 'queueRetry') void sendQueue.retry(action.id, settings);
    else if (action.action === 'queueEdit') void sendQueue.edit(action.id, action.text);
  }
  const [overlayDraft, setOverlayDraft] = useState(updateDrafts?.overlay ?? '');
  const [overlaySubmission, setOverlaySubmission] =
    useState<import('./core/types').OverlayVoiceState['submission']>(null);
  automaticUpdateBlocked.current = automaticUpdateBlocker(
    textTools.watching,
    text,
    overlayDraft,
    textTranslation.getSnapshot().input,
  );
  updateBlocked.current = settingsBusy
    ? '设置正在保存，请完成后再更新。'
    : listenPhase !== 'idle'
      ? '请先停止字幕监听，停止完成后再更新。'
      : voice
        ? '请先结束或取消语音输入，再更新。'
        : composer.busy || busy || queueView.items.length > 0
          ? '请先完成或取消发送队列中的任务，再更新。'
          : textTranslation.getSnapshot().busy
            ? '文本翻译正在进行，请完成或取消后再更新。'
            : unsavedKey || JSON.stringify(settings) !== JSON.stringify(savedSettings)
              ? '设置尚未保存，请保存或放弃更改后再更新。'
              : false;
  prepareUpdate.current = () => {
    const { input, source, target, result, resultTarget } = textTranslation.getSnapshot();
    saveUpdateDrafts({
      main: text,
      overlay: overlayDraft,
      translation: { input, source, target, result, resultTarget },
    });
    textTools.changeWatching(false);
  };
  const [overlayVoiceError, setOverlayVoiceError] = useState('');
  const [overlayVoiceReady, setOverlayVoiceReady] = useState(false);
  const overlayActionsRef = useRef<(request: OverlayVoiceRequest) => void>(() => {});
  const mountedRef = useRef(true);
  const composingRef = useRef(false);
  const captionView = useMemo(
    () => ({
      lines: workspaceCaptions(session.segments, settings.captionColors),
      layout: settings.captionLayout,
    }),
    [session.segments, settings.captionColors, settings.captionLayout],
  );
  const reading = useReadingFollow<HTMLDivElement>(
    captionView,
    session.id,
    'workspace',
    page === 'workspace',
  );
  const follow = reading.follow;
  const [sidebar, setSidebar] = useState(true);
  const sidebarLayout = useSidebarLayout();

  const translationProfile = profileFor(settings, 'translation');
  const speechSpeed = profileFor(settings, 'tts').speed ?? 1;
  const overlayVersionRef = useRef(0);
  const [overlayReady, setOverlayReady] = useState(!desktop);
  const [overlayError, setOverlayError] = useState('');
  const captureSignalRef = useRef(new CaptureSignalMonitor());

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void Promise.all([readOverlay(), readOverlayVoice()])
      .then(([snapshot, voiceState]) => {
        if (!disposed) {
          overlayVersionRef.current = Math.max(
            overlayVersionRef.current,
            snapshot.version,
            voiceState.version,
          );
          setOverlayReady(true);
        }
      })
      .catch(() => {
        if (!disposed) setOverlayError('悬浮字幕初始化失败，请重启应用。');
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!desktop || !overlayReady) return;
    let disposed = false;
    const version = ++overlayVersionRef.current;
    void publishOverlay(
      overlaySnapshot(
        session,
        listenPhase,
        settings.subtitle,
        version,
        settings.captionColors,
        settings.uiLanguage,
        settings.captionLayout,
      ),
    ).catch(() => {
      if (!disposed) setOverlayError('悬浮字幕同步失败，请返回主窗口测试。');
    });
    return () => {
      disposed = true;
    };
  }, [
    session,
    listenPhase,
    settings.subtitle,
    settings.captionColors,
    settings.uiLanguage,
    settings.captionLayout,
    overlayReady,
  ]);
  useEffect(() => {
    if (!desktop || !overlayReady) return;
    void publishOverlayVoice({
      version: ++overlayVersionRef.current,
      phase: voice?.phase ?? composerPhase,
      level: voice?.level ?? 0,
      mode: settings.composer.voiceInputMode || 'dictate',
      enabled: page === 'workspace' && overlayVoiceReady,
      targetLanguage: settings.targetLanguage,
      speed: speechSpeed,
      queue: queueView,
      error: Array.from(overlayVoiceError).slice(0, 400).join(''),
      draft: overlayDraft,
      submission: overlaySubmission,
    }).catch(() => {});
  }, [
    voice,
    composerPhase,
    settings.composer.voiceInputMode,
    settings.targetLanguage,
    speechSpeed,
    queueView,
    page,
    overlayReady,
    overlayVoiceReady,
    overlayVoiceError,
    overlayDraft,
    overlaySubmission,
  ]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void listen<OverlayVoiceRequest>('overlay-voice-request', (event) =>
      overlayActionsRef.current(event.payload),
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          unsubscribe = unlisten;
          setOverlayVoiceReady(true);
        }
      })
      .catch(() => {
        if (!disposed) setOverlayVoiceError('悬浮窗语音入口未就绪，请重启软件。');
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  overlayActionsRef.current = (request) => {
    if (request.action === 'subtitleContent') {
      const content = request.bilingual ? 'bilingual' : 'translation';
      try {
        // Persist only this preference; unrelated settings drafts remain unsaved.
        const saved: Settings = {
          ...savedSettings,
          subtitle: { ...savedSettings.subtitle, content },
        };
        saveSettings(saved);
        setSavedSettings(saved);
        setSettings((current) => ({ ...current, subtitle: { ...current.subtitle, content } }));
      } catch (error) {
        notify(t('保存失败：{0}', String(error)));
      }
      return;
    }
    if (request.action.startsWith('queue')) {
      queueAction(request as QueueAction);
      return;
    }
    if (request.action === 'cancel') {
      void cancelVoice();
      return;
    }
    if (request.action === 'finish') {
      void finishVoice();
      return;
    }
    if (request.action === 'stop') {
      void stopComposer();
      return;
    }
    if (page !== 'workspace') {
      setOverlayVoiceError('请先在主窗口保存设置并返回字幕页。');
      if (request.action === 'send' && request.requestId)
        setOverlaySubmission({
          id: request.requestId,
          accepted: false,
          error: '请先在主窗口保存设置并返回字幕页。',
        });
      return;
    }
    if (request.action === 'speed') {
      if (Number.isFinite(request.speed) && request.speed >= 0.5 && request.speed <= 2)
        persist(updateSpeechProfile(settings, { speed: request.speed }), true);
      return;
    }
    if (request.action === 'send') {
      setOverlayVoiceError('');
      void sendOverlaySource(request.text, request.requestId);
      return;
    }
    if (voiceRef.current || composer.busy) return;
    if (request.action === 'start') {
      if (overlayDraft.trim()) {
        setOverlayVoiceError('请先发送或清空悬浮窗中的草稿。');
        return;
      }
      void beginVoice('overlay');
    } else if (request.action === 'discard') {
      setOverlayDraft('');
      setOverlayVoiceError('');
    }
  };
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void listen('overlay-stop-request', () => {
      void endListening();
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unsubscribe = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    runtimeInfo()
      .then(setRuntime)
      .catch((e) => notify(String(e)));
  }, [notify]);
  const macFrame =
    desktop && (runtime ? runtime.platform === 'macos' : /Mac/.test(navigator.platform));
  useTheme(settings.theme, macFrame);
  useEffect(() => {
    if (!runtime || !['macos', 'windows'].includes(runtime.platform)) return;
    void setMainCloseBehavior(savedSettings.mainWindowCloseBehavior).catch(() =>
      notify(t('无法应用窗口关闭设置，请重试。')),
    );
  }, [runtime?.platform, savedSettings.mainWindowCloseBehavior, notify]);
  useEffect(() => {
    if (!desktop || runtime?.platform !== 'windows') return;
    let active = true;
    listOutputs()
      .then((devices) => {
        if (!active) return;
        // Read the latest saved settings after enumeration, preserving edits saved meanwhile.
        const saved = loadSettings();
        const audio = migrateLegacyOutputRouting(saved.audio, devices);
        if (audio !== saved.audio) {
          saveSettings({ ...saved, audio });
          setSavedSettings((current) => ({
            ...current,
            audio: migrateLegacyOutputRouting(current.audio, devices),
          }));
        }
        setSettings((current) => {
          const audio = migrateLegacyOutputRouting(current.audio, devices);
          return audio === current.audio ? current : { ...current, audio };
        });
      })
      .catch((error) => {
        if (active) notify(String(error));
      });
    return () => {
      active = false;
    };
  }, [runtime?.platform, notify]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (voiceRef.current) {
        voiceRef.current.cancelled = true;
        void cancelVoiceInput(voiceRef.current.id).catch(() => {});
      }
      void composer.cancel().catch(() => {});
      const id = listeningRef.current;
      listeningRef.current = null;
      if (id) void stopCapture(id).catch(() => {});
    };
  }, [composer]);

  async function refreshCaptureSources() {
    if (listeningRef.current || refreshingSources) return;
    setRefreshingSources(true);
    setListenError('');
    try {
      setCaptureSources(await listCaptureSources());
    } catch (error) {
      setListenError(String(error));
      if (page === 'settings') notify(String(error));
    } finally {
      setRefreshingSources(false);
    }
  }

  useEffect(() => {
    if (desktop && runtime?.nativeCapture === true) void refreshCaptureSources();
  }, [runtime?.platform]);

  function receiveListening(event: ListeningEvent) {
    if (listeningRef.current !== event.sessionId) return;
    if (listenStoppingRef.current && !acceptDuringDrain(event)) return;
    if (!listenEpochRef.current.accept(event)) return;
    if (event.type === 'transcript') {
      setSession((state) => applyTranscript(state, event));
    } else if (event.type === 'translation') {
      setSession((state) =>
        applyTranslation(
          state,
          event.sessionId,
          event.segmentId,
          event.revision,
          event.text,
          event.sourceText,
        ),
      );
    } else if (event.type === 'recognitionMetrics') {
      setRecognitionMetrics(event.metrics);
    } else if (event.type === 'translationMetrics') {
      setTranslationMetrics(event.metrics);
    } else if (event.type === 'translationError') {
      setSession((state) =>
        applyTranslationError(state, event.sessionId, event.segmentId, event.revision),
      );
    } else if (event.type === 'recovering') {
      setListenPhase('recovering');
      setRecovery(event);
      setListenProgress(null);
      setTranslationMetrics(null);
      setRecognitionMetrics(null);
      captureSignalRef.current = new CaptureSignalMonitor();
      setSession(discardUnfinished);
    } else if (event.type === 'sourceChanged') {
      setCaptureSourceId(captureSourceKey(event.source));
      setCaptureSources((sources) => [
        ...sources.filter((source) => captureSourceKey(source) !== captureSourceKey(event.source)),
        event.source,
      ]);
    } else if (event.phase === 'running') {
      setRecovery(null);
      setListenPhase('running');
      setListenHealth(captureSignalRef.current.update(event));
      setListenProgress(event);
    }
  }

  async function beginListening() {
    if (listeningRef.current) return;
    const source = captureSources.find((item) => captureSourceKey(item) === captureSourceId);
    const asrProfile = profileFor(settings, 'asr');
    const invalid = validateProfile(asrProfile) || validateProfile(translationProfile);
    if (
      !source ||
      invalid ||
      !['qwen_chat_asr', 'qwen_dashscope_asr'].includes(asrProfile.adapter)
    ) {
      setListenError(invalid || '请刷新并选择监听应用，配置语音识别与文字翻译服务。');
      if (invalid) notify(invalid, validateProfile(asrProfile) ? 'asr' : 'translation');
      return;
    }
    const id = crypto.randomUUID();
    listeningRef.current = id;
    listenStoppingRef.current = false;
    listenEpochRef.current = new ListeningEpoch();
    captureSignalRef.current = new CaptureSignalMonitor();
    setListenPhase('starting');
    setRecovery(null);
    setListenProgress(null);
    setTranslationMetrics(null);
    setRecognitionMetrics(null);
    setListenHealth('waiting');
    setListenError('');
    setSession({ id, segments: [] });
    try {
      await startListening(
        {
          source,
          sessionId: id,
          asrProfile,
          translationProfile,
          sourceLanguage: settings.listening.sourceLanguage,
          targetLanguage: settings.listening.targetLanguage,
        },
        receiveListening,
      );
    } catch (error) {
      if (
        listeningRef.current === id &&
        !(listenStoppingRef.current && String(error) === '采集已停止。')
      ) {
        setListenError(String(error));
      }
    } finally {
      if (listeningRef.current === id) {
        listeningRef.current = null;
        setSession(endSession);
        setListenPhase('idle');
      }
    }
  }

  async function endListening() {
    const id = listeningRef.current;
    if (!id || listenStoppingRef.current) return;
    listenStoppingRef.current = true;
    setListenPhase('stopping');
    try {
      await finishListening(id);
    } catch (error) {
      if (listeningRef.current !== id) return;
      setListenError(String(error));
      listenStoppingRef.current = false;
      setSession((state) => ({ ...state, id }));
      setListenPhase('running');
    }
  }

  function persist(next: Settings, silent = false) {
    try {
      saveSettings(next);
      setSettings(next);
      setSavedSettings(next);
      recordDiagnostic({ operation: 'frontend', kind: 'state', phase: 'settings_saved' });
      if (!silent) notify('已保存');
    } catch (e) {
      recordDiagnostic({
        operation: 'frontend',
        kind: 'error',
        phase: 'settings_save_failed',
        reason: 'configuration',
      });
      notify(t('保存失败：{0}', String(e)));
    }
  }
  function persistAutomaticUpdates(enabled: boolean) {
    try {
      const next = { ...savedSettings, automaticUpdates: enabled };
      saveSettings(next);
      setSavedSettings(next);
      setSettings((current) => ({ ...current, automaticUpdates: enabled }));
    } catch (error) {
      notify(t('保存失败：{0}', String(error)));
    }
  }
  async function runComposer(
    action: 'speak' | 'translate',
    route = settings.composer.route,
    sourceOverride?: string,
    options?: {
      preserveDraft: boolean;
      onError: (message: string) => void;
      onAccepted?: () => void;
    },
  ) {
    if (voiceRef.current || composer.busy || (action === 'translate' && sendQueue.busy)) {
      options?.onError('当前操作尚未结束，请稍后重试发送。');
      return;
    }
    if (!desktop) {
      notify('请通过桌面应用使用翻译和语音输出。');
      return;
    }
    const id = crypto.randomUUID();
    const source = sourceOverride ?? text;
    const submittedSettings = structuredClone(settings);
    const sourceRevision = draftRevisionRef.current;
    let clearedRevision: number | null = null;
    const restoreSubmittedDraft = () => {
      if (
        mountedRef.current &&
        clearedRevision !== null &&
        draftRevisionRef.current === clearedRevision
      ) {
        draftRevisionRef.current++;
        setText(source);
      }
    };
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    try {
      const detection = await preflightComposer(submittedSettings, source, action, route, {
        detect: detectTextLanguage,
        output: inspectSpeechOutput,
      });
      if (!mountedRef.current) return;
      const outcome = await (action === 'speak' ? sendQueue : composer).run(
        {
          id,
          text: source,
          settings: submittedSettings,
          detection,
          action,
          route,
          listening: Boolean(listeningRef.current),
        },
        {
          notice: notify,
          accepted: () => {
            options?.onAccepted?.();
            if (options?.preserveDraft) setOverlayDraft('');
            if (
              !options?.preserveDraft &&
              action === 'speak' &&
              route === 'send' &&
              draftRevisionRef.current === sourceRevision
            ) {
              clearedRevision = ++draftRevisionRef.current;
              setText('');
            }
          },
          phase: (phase) => {
            if (mountedRef.current) setComposerPhase(phase);
          },
          translation: (translated: string, queuedSource?: string) => {
            if (mountedRef.current)
              setSession((state) =>
                appendExpression(state, {
                  id,
                  source: queuedSource ?? source,
                  translation: translated,
                  time,
                }),
              );
          },
        },
      );
      if (outcome === 'busy') options?.onError('当前操作尚未结束，请稍后重试发送。');
      if (outcome === 'stopped' && action !== 'speak') restoreSubmittedDraft();
    } catch (error) {
      restoreSubmittedDraft();
      if (mountedRef.current) {
        if (error instanceof ComposerSetupError)
          recordDiagnostic({
            operation: 'frontend',
            kind: 'error',
            reason: error.section === 'general' ? 'device' : 'configuration',
          });
        notify(String(error), error instanceof ComposerSetupError ? error.section : undefined);
        options?.onError(String(error));
      }
    }
  }

  async function sendOverlaySource(source: string, requestId?: string) {
    let accepted = false;
    await runComposer('speak', settings.composer.route, source, {
      preserveDraft: true,
      onAccepted: () => {
        accepted = true;
        if (requestId) setOverlaySubmission({ id: requestId, accepted: true, error: '' });
      },
      onError: (error) => {
        setOverlayVoiceError(error);
        if (requestId && !accepted)
          setOverlaySubmission({
            id: requestId,
            accepted: false,
            error: Array.from(error).slice(0, 400).join(''),
          });
      },
    });
  }

  async function beginVoice(origin: 'main' | 'overlay' = 'main') {
    if (voiceRef.current || composer.busy || !desktop) return;
    const profile = profileFor(settings, 'asr');
    const invalid = validateProfile(profile);
    if (invalid) {
      if (origin === 'overlay') setOverlayVoiceError(invalid);
      notify(invalid, 'asr');
      return;
    }
    const operation = { id: crypto.randomUUID(), cancelled: false, finishing: false, origin };
    setOverlayVoiceError('');
    const revision = draftRevisionRef.current;
    const previous = text;
    const mode = settings.composer.voiceInputMode || 'dictate';
    voiceRef.current = operation;
    setVoice({ phase: 'starting', seconds: 0, level: 0 });
    try {
      const result = await startVoiceInput(
        operation.id,
        settings.audio.inputDeviceId || '',
        profile,
        (progress) => {
          if (
            mountedRef.current &&
            voiceRef.current === operation &&
            !operation.cancelled &&
            !(operation.finishing && progress.phase === 'recording')
          )
            setVoice(progress);
        },
      );
      if (!mountedRef.current || voiceRef.current !== operation || operation.cancelled) return;
      if (origin === 'overlay') {
        if (Array.from(result.text).length > 6000)
          throw new Error('识别内容过长，请缩短录音后重试。');
        setOverlayDraft(result.text);
        voiceRef.current = null;
        setVoice(null);
        if (mode === 'send') await sendOverlaySource(result.text);
        return;
      }
      if (draftRevisionRef.current !== revision) {
        notify('录音期间输入内容有修改，识别结果已追加，请确认后发送。');
        draftRevisionRef.current++;
        setText((current) => [current, result.text].filter(Boolean).join('\n'));
        return;
      }
      const combined = [previous, result.text].filter(Boolean).join('\n');
      draftRevisionRef.current++;
      setText(combined);
      voiceRef.current = null;
      setVoice(null);
      if (mode === 'send') {
        if ([...combined].length > 2000) {
          notify('识别内容超过 2000 字，请编辑后发送。');
          return;
        }
        await runComposer('speak', settings.composer.route, combined);
      }
    } catch (error) {
      if (mountedRef.current && !operation.cancelled) {
        notify(String(error));
        if (origin === 'overlay') setOverlayVoiceError(String(error));
      }
    } finally {
      if (voiceRef.current === operation) {
        voiceRef.current = null;
        if (mountedRef.current) setVoice(null);
      }
    }
  }
  async function finishVoice() {
    const operation = voiceRef.current;
    if (!operation || operation.finishing || voice?.phase !== 'recording') return;
    operation.finishing = true;
    setVoice((current) => current && { ...current, phase: 'recognizing' });
    try {
      await finishVoiceInput(operation.id);
    } catch (error) {
      notify(String(error));
    }
  }
  async function cancelVoice() {
    const operation = voiceRef.current;
    if (!operation) return;
    operation.cancelled = true;
    setVoice((current) => current && { ...current, phase: 'cancelling' });
    try {
      await cancelVoiceInput(operation.id);
    } catch (error) {
      notify(String(error));
    }
    // The native promise owns cleanup; a new recording cannot start before it settles.
  }

  async function stopComposer() {
    if (sendQueue.busy) {
      await sendQueue.stop();
      return;
    }
    if (!composer.busy || composerPhase === 'stopping') return;
    setComposerPhase('stopping');
    try {
      await composer.cancel();
    } catch (error) {
      if (mountedRef.current) notify(t('停止失败：{0} 请等待当前任务结束。', String(error)));
    }
  }

  function openSettings(section: SettingsSection = 'general', anchor = '') {
    if (voiceRef.current) {
      notify('请先结束或取消录音。');
      return false;
    }
    if (composer.busy) {
      void stopComposer();
      notify('正在停止当前操作，结束后可进入设置。');
      return false;
    }
    if (listeningRef.current && section !== 'tts') {
      void endListening();
      notify('正在停止监听，结束后可进入设置。');
      return false;
    }
    setSettingsSection(section);
    setSettingsFocus((current) => ({ id: anchor, version: (current?.version ?? 0) + 1 }));
    setPage('settings');
    return true;
  }

  const direction = composerLanguages(settings, listening);
  const composerHint =
    (settings.composer.enterAction === 'newline'
      ? 'Enter 换行'
      : settings.composer.enterAction === 'translate'
        ? 'Enter 仅翻译 · Shift + Enter 换行'
        : t(
            'Enter {0} · Shift + Enter 换行',
            t(settings.composer.output === 'translation' ? '翻译后输出' : '输出原文'),
          )) +
    (settings.composer.enterAction === 'speak'
      ? t(' · {0}设备', t(settings.composer.route === 'preview' ? '试听' : '发送'))
      : '') +
    ` · ${t(direction.source)} → ${t(direction.target)}`;

  return (
    <div
      ref={sidebarLayout.shellRef}
      className={`app-shell ${sidebar ? '' : 'sidebar-collapsed'} ${runtime?.platform === 'windows' ? 'has-window-chrome' : macFrame ? 'has-mac-chrome' : ''}`}
      style={
        {
          '--sidebar-width': `${sidebarLayout.width}px`,
          '--workspace-min-width': `${workspaceMinimum}px`,
        } as CSSProperties
      }
    >
      <a className="skip-link" href="#main-content">
        {t('跳到主内容')}
      </a>
      {macFrame && <MacWindowChrome />}
      {runtime?.platform === 'windows' && (
        <WindowChrome
          sidebar={sidebar}
          onToggleSidebar={() => setSidebar(!sidebar)}
          notify={notify}
        />
      )}
      <aside className="sidebar">
        <div className="brand">
          <AudioLines size={19} strokeWidth={1.5} />
          <span>VoxBridge</span>
        </div>
        <nav aria-label={t('主导航')}>
          <button
            aria-current={page === 'workspace' ? 'page' : undefined}
            onClick={() => setPage('workspace')}
            disabled={settingsBusy}
          >
            <MessageSquare size={15} />
            {t('字幕')}
          </button>
          <button
            aria-current={page === 'text' ? 'page' : undefined}
            onClick={() => setPage('text')}
            disabled={settingsBusy}
          >
            <Languages size={15} />
            {t('文本翻译')}
          </button>
        </nav>
        {page === 'workspace' || page === 'text' ? (
          <div className="sidebar-bottom">
            <nav aria-label={t('设置导航')}>
              <button onClick={() => openSettings()}>
                <Settings2 size={15} />
                {t('设置')}
              </button>
            </nav>
          </div>
        ) : (
          <nav className="preferences-nav" aria-label={t('设置分类')}>
            <span className="nav-group-label">{t('偏好设置')}</span>
            <button
              disabled={settingsBusy}
              aria-current={
                page === 'settings' && settingsSection === 'general' ? 'page' : undefined
              }
              onClick={() => openSettings('general')}
            >
              <Settings2 size={15} />
              {t('常规')}
            </button>
            <span className="nav-group-label">{t('模型服务')}</span>
            {(
              [
                { id: 'translation', label: '文字翻译', Icon: Languages },
                { id: 'asr', label: '语音识别', Icon: Mic },
                { id: 'tts', label: '语音合成', Icon: Volume2 },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                disabled={settingsBusy}
                aria-current={page === 'settings' && settingsSection === id ? 'page' : undefined}
                onClick={() => openSettings(id)}
              >
                <Icon size={15} />
                {t(label)}
              </button>
            ))}
            <span className="nav-group-label">{t('工具')}</span>
            <button
              disabled={settingsBusy}
              aria-current={page === 'diagnostics' ? 'page' : undefined}
              onClick={() => setPage('diagnostics')}
            >
              <AudioLines size={15} />
              {t('音频与诊断')}
            </button>
          </nav>
        )}
      </aside>
      {sidebar && (
        <SidebarResizeHandle
          width={sidebarLayout.width}
          maximum={sidebarLayout.maximum}
          onChange={sidebarLayout.setWidth}
        />
      )}
      <div className="main-shell">
        <header className="titlebar">
          <div>
            <button
              className="icon-button page-sidebar-toggle"
              aria-label={t(sidebar ? '收起侧栏' : '展开侧栏')}
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeftClose size={16} />
            </button>
            <strong>
              {t(
                page === 'workspace'
                  ? '字幕'
                  : page === 'text'
                    ? '文本翻译'
                    : page === 'settings'
                      ? '设置'
                      : '音频与诊断',
              )}
            </strong>
          </div>
          {page === 'workspace' && (
            <div className="toolbar-actions">
              <button className="subtle" onClick={() => openSettings('general', 'audio-heading')}>
                <Settings2 size={14} aria-hidden="true" />
                {t('音频设置')}
              </button>
              <button
                disabled={!desktop || !overlayReady}
                onClick={() => void showOverlay().catch(() => notify('无法打开悬浮字幕窗。'))}
                aria-description={t('隐藏字幕窗不会停止监听；可在悬浮窗返回主窗口或停止')}
              >
                {t('悬浮字幕')}
              </button>
              <button
                onClick={() => void (listening ? endListening() : beginListening())}
                disabled={
                  !desktop ||
                  runtime?.nativeCapture !== true ||
                  listenPhase === 'stopping' ||
                  (!listening && (!captureSourceId || refreshingSources))
                }
                aria-description={t('开始后，目标声音会发送到所选的语音识别与翻译服务，可能计费')}
              >
                {t(listenPhase === 'stopping' ? '正在停止…' : listening ? '停止监听' : '开始监听')}
              </button>
            </div>
          )}
          {page === 'diagnostics' && (
            <button className="subtle" onClick={() => openSettings()}>
              {t('返回设置')}
            </button>
          )}
        </header>
        <main
          key={page}
          id="main-content"
          className={
            page === 'workspace'
              ? 'workspace'
              : page === 'text'
                ? 'page-scroll text-translation-page'
                : 'page-scroll'
          }
        >
          {page === 'text' && (
            <TextTranslation
              controller={textTranslation}
              tools={textTools}
              settings={settings}
              onSettings={() => openSettings('translation')}
            />
          )}
          {page === 'settings' && (
            <SettingsPanel
              platform={runtime?.platform}
              section={settingsSection}
              focusSection={settingsFocus}
              onBusyChange={setSettingsBusy}
              onUnsavedKeyChange={setUnsavedKey}
              settings={settings}
              savedSettings={savedSettings}
              onDraftChange={setSettings}
              onAutomaticUpdatesChange={persistAutomaticUpdates}
              onSave={persist}
              notify={notify}
              onDiagnostics={() => setPage('diagnostics')}
              onRefreshApplications={refreshCaptureSources}
              refreshingApplications={refreshingSources}
              captureSupported={runtime?.nativeCapture === true}
            />
          )}
          {page === 'diagnostics' && (
            <Diagnostics runtime={runtime} notify={notify} settings={settings} onSave={persist} />
          )}
          {page === 'workspace' && (
            <>
              <div className="workspace-toolbar">
                <Select
                  label={t('监听应用')}
                  value={captureSourceId}
                  onChange={setCaptureSourceId}
                  disabled={listening || !desktop || runtime?.nativeCapture !== true}
                  placeholder={t('选择监听应用')}
                  onOpenChange={(open) => {
                    if (open) void refreshCaptureSources();
                  }}
                  emptyLabel={
                    refreshingSources ? '正在读取应用…' : '没有可监听的应用，请先打开应用'
                  }
                  compact
                  options={[
                    ...captureSources.map((source) => ({
                      value: captureSourceKey(source),
                      label: captureSourceLabel(source),
                      translate: false,
                    })),
                    ...(captureSourceId &&
                    !captureSources.some((source) => captureSourceKey(source) === captureSourceId)
                      ? [{ value: captureSourceId, label: '应用已退出，请重新选择' }]
                      : []),
                  ]}
                />
                <ListeningStatus
                  phase={listenPhase}
                  health={listenHealth}
                  progress={listenProgress}
                  translationMetrics={translationMetrics}
                  recognitionMetrics={recognitionMetrics}
                  recovery={recovery}
                />
              </div>
              <ListeningNotice
                message={listenError || overlayError}
                overlay={!listenError && !!overlayError}
                onDismiss={() => {
                  setListenError('');
                  setOverlayError('');
                }}
                onSettings={() => openSettings('asr')}
                onRefresh={() => void refreshCaptureSources()}
                refreshing={refreshingSources}
              />
              <div className="transcript-scroll" ref={reading.ref} onScroll={reading.onScroll}>
                {!session.segments.length ? (
                  <div className="empty-state">
                    <p>{t('暂无字幕')}</p>
                  </div>
                ) : (
                  <div
                    className="transcript-content"
                    data-selection-scope
                    style={
                      {
                        '--caption-spacing': `${settings.captionSpacing}px`,
                        '--caption-font-size': `${settings.captionFontSize}px`,
                        '--caption-source-font-size': `${(settings.captionFontSize * 14) / 17}px`,
                      } as CSSProperties
                    }
                  >
                    <CaptionFeed
                      lines={captionView.lines}
                      layout={settings.captionLayout}
                      scope="workspace"
                    />
                  </div>
                )}
              </div>
              {!follow && (
                <button className="jump-latest" onClick={reading.jumpLatest}>
                  <ArrowDown size={13} />
                  {t('最新')}
                </button>
              )}
              <section className="composer-area" aria-label={t('文字表达')}>
                <div className={`composer-box${voice ? ' is-voice-active' : ''}`}>
                  {voice && (
                    <div className="voice-recording" aria-label={t('语音输入')}>
                      <button
                        className="icon-button voice-cancel"
                        aria-label={t('取消录音')}
                        aria-description={t('取消录音')}
                        disabled={voice.phase === 'cancelling'}
                        onClick={() => void cancelVoice()}
                      >
                        <X size={18} />
                      </button>
                      <div className="voice-recording-status" role="status">
                        <VoiceActivity phase={voice.phase} level={voice.level} />
                      </div>
                      <button
                        className="voice-finish"
                        aria-label={t(
                          settings.composer.voiceInputMode === 'send'
                            ? '结束录音并发送'
                            : '完成录音并填入输入框',
                        )}
                        disabled={voice.phase !== 'recording'}
                        onClick={() => void finishVoice()}
                      >
                        <Square size={13} fill="currentColor" />
                        {t(settings.composer.voiceInputMode === 'send' ? '结束并发送' : '完成录音')}
                      </button>
                    </div>
                  )}
                  <div className="composer-queue">
                    <SendQueueControls view={queueView} onAction={queueAction} />
                  </div>
                  <label className="sr-only" htmlFor="speech-input">
                    {t('输入要翻译或表达的内容')}
                  </label>
                  <textarea
                    id="speech-input"
                    inert={Boolean(voice)}
                    maxLength={2000}
                    value={text}
                    aria-describedby="composer-hint"
                    aria-description={t(composerHint)}
                    onChange={(event) => {
                      draftRevisionRef.current++;
                      setText(event.target.value);
                    }}
                    onCompositionStart={() => {
                      composingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      composingRef.current = false;
                    }}
                    onKeyDown={(event) => {
                      const action = composerKeyAction(
                        {
                          ...event.nativeEvent,
                          key: event.key,
                          shiftKey: event.shiftKey,
                          ctrlKey: event.ctrlKey,
                          metaKey: event.metaKey,
                          altKey: event.altKey,
                          repeat: event.repeat,
                          isComposing: composingRef.current || event.nativeEvent.isComposing,
                          keyCode: event.nativeEvent.keyCode,
                        },
                        settings.composer.enterAction,
                      );
                      if (
                        action === 'newline' ||
                        event.key !== 'Enter' ||
                        composingRef.current ||
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      )
                        return;
                      event.preventDefault();
                      if (action !== 'ignore') void runComposer(action);
                    }}
                    placeholder={t('输入要说的话…')}
                  />
                  <div className="composer-controls" inert={Boolean(voice)}>
                    <div className="composer-preferences">
                      <button
                        className="model-button"
                        disabled={busy || listening || Boolean(voice)}
                        onClick={() => openSettings('translation')}
                        aria-description={t('配置翻译模型')}
                      >
                        <Languages size={13} />
                        <span>{translationProfile.modelId || t('选择模型')}</span>
                        <ChevronDown size={11} />
                      </button>
                      <Select
                        label={t('语音目标语言')}
                        value={settings.targetLanguage}
                        disabled={busy || Boolean(voice)}
                        onChange={(value) => persist({ ...settings, targetLanguage: value }, true)}
                        options={languages.map((language) => ({
                          value: language,
                          label: language,
                        }))}
                        compact
                      />
                      <SpeechPicker
                        settings={settings}
                        onChange={(next) => persist(next, true)}
                        onSettings={() => openSettings('tts')}
                      />
                      <SpeechSpeedPicker
                        value={speechSpeed}
                        onChange={(speed) =>
                          persist(updateSpeechProfile(settings, { speed }), true)
                        }
                      />
                      {text.length > 1800 && (
                        <span className="input-count">{text.length}/2000</span>
                      )}
                    </div>
                    <div className="composer-actions">
                      <>
                        <button
                          type="button"
                          role="switch"
                          className="voice-direct-toggle"
                          aria-label={t('录音后直接发送')}
                          aria-checked={settings.composer.voiceInputMode === 'send'}
                          disabled={busy}
                          aria-description={t(
                            settings.composer.voiceInputMode === 'send'
                              ? '开启：结束录音后自动翻译并输出语音'
                              : '关闭：识别结果填入输入框，确认后再发送',
                          )}
                          onClick={() =>
                            persist(
                              {
                                ...settings,
                                composer: {
                                  ...settings.composer,
                                  voiceInputMode:
                                    settings.composer.voiceInputMode === 'send'
                                      ? 'dictate'
                                      : 'send',
                                },
                              },
                              true,
                            )
                          }
                        >
                          <span className="voice-switch-track" aria-hidden="true">
                            <span />
                          </span>
                          <span className="voice-direct-label">{t('直接发送')}</span>
                        </button>
                        <button
                          className="icon-button"
                          aria-label={t('开始录音')}
                          aria-description={t('开始麦克风录音，最长 1 分钟')}
                          disabled={busy || !desktop}
                          onClick={() => void beginVoice()}
                        >
                          <Mic size={16} />
                        </button>
                      </>

                      <button
                        className="output-mode"
                        aria-label={t('输出译文')}
                        aria-pressed={settings.composer.output === 'translation'}
                        disabled={busy || Boolean(voice)}
                        aria-description={t(
                          '切换原文或译文语音；当前 {0} → {1}',
                          t(direction.source),
                          t(direction.target),
                        )}
                        onClick={() =>
                          persist(
                            {
                              ...settings,
                              composer: {
                                ...settings.composer,
                                output:
                                  settings.composer.output === 'translation'
                                    ? 'source'
                                    : 'translation',
                              },
                            },
                            true,
                          )
                        }
                      >
                        <Languages size={12} />
                        {t(settings.composer.output === 'translation' ? '译文' : '原文')}
                      </button>
                      <button
                        className="icon-button monitor-toggle"
                        aria-label={t('发送时试听')}
                        aria-pressed={settings.audio.monitorEnabled === true}
                        aria-description={t(
                          settings.audio.monitorEnabled
                            ? '关闭本地试听，继续发送语音'
                            : '发送语音时同时在耳机试听',
                        )}
                        disabled={!desktop}
                        onClick={() => {
                          if (!settings.audio.previewDeviceId) {
                            openSettings('general');
                            notify('请先选择试听设备。');
                            return;
                          }
                          const enabled = !settings.audio.monitorEnabled;
                          persist(
                            { ...settings, audio: { ...settings.audio, monitorEnabled: enabled } },
                            true,
                          );
                          void Promise.all([
                            composer.setMonitoring(enabled),
                            sendQueue.setMonitoring(enabled),
                          ]).catch(() => notify('试听切换失败，请重试。'));
                        }}
                      >
                        <Headphones size={16} />
                      </button>
                      {busy && (
                        <>
                          <span
                            role="status"
                            className={queueView.items.length ? 'sr-only' : 'composer-phase'}
                          >
                            {t(
                              {
                                waitingDevice: '等待设备…',
                                detecting: '处理中…',
                                translating: '翻译中…',
                                synthesizing: '合成中…',
                                decoding: '准备播放…',
                                playing: '输出中…',
                                stopping: '停止中…',
                                idle: '',
                              }[composerPhase],
                            )}
                          </span>
                          <button
                            className="icon-button"
                            aria-label={t('停止当前操作')}
                            disabled={composerPhase === 'stopping'}
                            onClick={() => void stopComposer()}
                          >
                            <Square size={13} />
                          </button>
                        </>
                      )}
                      {!busy && <span className="composer-stop-placeholder" aria-hidden="true" />}
                      <>
                        <button
                          className="subtle"
                          disabled={
                            busy || sendQueue.busy || !text.trim() || !desktop || Boolean(voice)
                          }
                          onClick={() => void runComposer('translate')}
                          aria-description={t('仅翻译，不输出语音')}
                        >
                          {t('翻译')}
                        </button>
                        <button
                          disabled={!desktop || !text.trim() || Boolean(voice) || composer.busy}
                          aria-description={t(
                            '输出{0}到{1}设备 · 可能计费',
                            t(settings.composer.output === 'translation' ? '译文' : '原文'),
                            t(settings.composer.route === 'preview' ? '试听' : '发送'),
                          )}
                          aria-label={t('输出合成语音')}
                          className="send-button"
                          onClick={() => void runComposer('speak')}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </>
                    </div>
                  </div>
                </div>
                <span id="composer-hint" className="sr-only">
                  {t(composerHint)}
                </span>
              </section>
            </>
          )}
        </main>
      </div>
      <AppNotices
        noticeId={notice.id}
        message={notice.message}
        onClose={dismissNotice}
        onConfigure={
          notice.section
            ? () => {
                if (
                  openSettings(notice.section!, notice.section === 'general' ? 'audio-heading' : '')
                )
                  dismissNotice();
              }
            : undefined
        }
      />
    </div>
  );
}

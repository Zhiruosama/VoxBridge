import { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import SettingsPanel, { type SettingsSection } from './components/SettingsPanel';
import Diagnostics from './components/Diagnostics';
import Select from './components/Select';
import Toast from './components/Toast';
import ListeningStatus, {
  ListeningNotice,
  type ListeningProgress,
} from './components/ListeningStatus';
import { defaults, loadSettings, profileFor, saveSettings, validateProfile } from './core/settings';
import type { CaptureSource, ListeningEvent, RuntimeInfo, Session, Settings } from './core/types';
import { applyTranscript, applyTranslation, discardUnfinished } from './core/session';
import { overlaySnapshot } from './core/overlay';
import { ListeningEpoch } from './core/listening';
import { CaptureSignalMonitor, type CaptureHealth } from './core/capture-health';
import {
  ComposerController,
  composerKeyAction,
  composerLanguages,
  type ComposerPhase,
} from './core/composer';
import { listen } from '@tauri-apps/api/event';
import {
  cancelTranslation,
  desktop,
  listCaptureSources,
  publishOverlay,
  readOverlay,
  showOverlay,
  runtimeInfo,
  speak,
  startListening,
  stopCapture,
  stopSpeech,
  translate,
} from './bridge';

const languages = ['英语', '简体中文', '日语', '韩语', '西班牙语'];
type Page = 'workspace' | 'settings' | 'diagnostics';

export default function App() {
  const [initial] = useState(() => {
    try {
      return { settings: loadSettings(), error: '' };
    } catch {
      return {
        settings: structuredClone(defaults),
        error: '本地设置无法读取，已使用默认配置。请到设置页重新保存。',
      };
    }
  });
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [savedSettings, setSavedSettings] = useState<Settings>(initial.settings);
  const [page, setPage] = useState<Page>('workspace');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [notice, setNotice] = useState({ message: initial.error, id: 0 });
  const notify = useCallback((message: string) => {
    setNotice((current) => ({ message, id: current.id + 1 }));
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
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [composerPhase, setComposerPhase] = useState<ComposerPhase>('idle');
  const busy = composerPhase !== 'idle';
  const [composer] = useState(
    () => new ComposerController({ translate, speak, cancelTranslation, stopSpeech }),
  );
  const mountedRef = useRef(true);
  const composingRef = useRef(false);
  const [follow, setFollow] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const translationProfile = profileFor(settings, 'translation');
  useEffect(() => {
    setResult('');
  }, [settings.sourceLanguage, settings.targetLanguage, translationProfile]);
  const overlayVersionRef = useRef(0);
  const [overlayReady, setOverlayReady] = useState(!desktop);
  const [overlayError, setOverlayError] = useState('');
  const captureSignalRef = useRef(new CaptureSignalMonitor());

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void readOverlay()
      .then((snapshot) => {
        if (!disposed) {
          overlayVersionRef.current = Math.max(overlayVersionRef.current, snapshot.version);
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
    void publishOverlay(overlaySnapshot(session, listenPhase, settings.subtitle, version)).catch(
      () => {
        if (!disposed) setOverlayError('悬浮字幕同步失败，请返回主窗口测试。');
      },
    );
    return () => {
      disposed = true;
    };
  }, [session, listenPhase, settings.subtitle, overlayReady]);
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
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    function apply() {
      document.documentElement.dataset.theme =
        settings.theme === 'system' ? (media.matches ? 'light' : 'dark') : settings.theme;
    }
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);
  useEffect(() => {
    if (follow)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' });
  }, [session.segments, follow]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    } finally {
      setRefreshingSources(false);
    }
  }

  function receiveListening(event: ListeningEvent) {
    if (listeningRef.current !== event.sessionId || listenStoppingRef.current) return;
    if (!listenEpochRef.current.accept(event)) return;
    if (event.type === 'transcript') {
      setSession((state) => applyTranscript(state, event));
    } else if (event.type === 'translation') {
      setSession((state) =>
        applyTranslation(state, event.sessionId, event.segmentId, event.revision, event.text),
      );
    } else if (event.type === 'recovering') {
      setListenPhase('recovering');
      setRecovery(event);
      setListenProgress(null);
      captureSignalRef.current = new CaptureSignalMonitor();
      setSession(discardUnfinished);
    } else if (event.type === 'sourceChanged') {
      setCaptureSourceId(String(event.source.pid));
      setCaptureSources((sources) => [
        ...sources.filter((source) => source.pid !== event.source.pid),
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
    const source = captureSources.find((item) => String(item.pid) === captureSourceId);
    const asrProfile = profileFor(settings, 'asr');
    const invalid = validateProfile(asrProfile) || validateProfile(translationProfile);
    if (
      !source ||
      invalid ||
      !['qwen_chat_asr', 'qwen_dashscope_asr'].includes(asrProfile.adapter)
    ) {
      setListenError(invalid || '请刷新并选择目标音频进程，配置语音识别与文字翻译服务。');
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
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
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
        setSession((state) => ({ ...discardUnfinished(state), id: null }));
        setListenPhase('idle');
      }
    }
  }

  async function endListening() {
    const id = listeningRef.current;
    if (!id || listenStoppingRef.current) return;
    listenStoppingRef.current = true;
    setListenPhase('stopping');
    setSession((state) => ({ ...discardUnfinished(state), id: null }));
    try {
      await stopCapture(id);
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
      if (
        next.sourceLanguage !== settings.sourceLanguage ||
        next.targetLanguage !== settings.targetLanguage ||
        JSON.stringify(profileFor(next, 'translation')) !== JSON.stringify(translationProfile)
      )
        setResult('');
      setSettings(next);
      setSavedSettings(next);
      if (!silent) notify('已保存');
    } catch (e) {
      notify(`保存失败：${String(e)}`);
    }
  }
  async function runComposer(
    action: 'speak' | 'translate',
    route = settings.composer.route,
    content?: string,
  ) {
    if (composer.busy) return;
    if (!desktop) {
      setError('请通过桌面应用使用翻译和语音输出。');
      return;
    }
    setError('');
    if (
      content === undefined &&
      (action === 'translate' || settings.composer.output === 'translation')
    )
      setResult('');
    try {
      await composer.run(
        {
          id: crypto.randomUUID(),
          text: content ?? text,
          settings,
          action,
          route,
          listening: Boolean(listeningRef.current),
          ...(content !== undefined ? { output: 'source' as const } : {}),
        },
        {
          phase: (phase) => {
            if (mountedRef.current) setComposerPhase(phase);
          },
          translation: (translated) => {
            if (mountedRef.current) setResult(translated);
          },
        },
      );
    } catch (error) {
      if (mountedRef.current) setError(String(error));
    }
  }

  async function stopComposer() {
    if (!composer.busy || composerPhase === 'stopping') return;
    setComposerPhase('stopping');
    try {
      await composer.cancel();
    } catch (error) {
      if (mountedRef.current) setError(`停止失败：${String(error)} 请等待当前任务结束。`);
    }
  }

  function openSettings(section: SettingsSection = 'general') {
    if (composer.busy) {
      void stopComposer();
      notify('正在停止当前操作，结束后可进入设置。');
      return;
    }
    if (listeningRef.current) {
      void endListening();
      notify('正在停止监听，结束后可进入设置。');
      return;
    }
    setSettingsSection(section);
    setPage('settings');
  }

  const direction = composerLanguages(settings, listening);
  const composerHint =
    (settings.composer.enterAction === 'newline'
      ? 'Enter 换行'
      : settings.composer.enterAction === 'translate'
        ? 'Enter 仅翻译 · Shift + Enter 换行'
        : `Enter ${settings.composer.output === 'translation' ? '翻译后输出' : '输出原文'} · Shift + Enter 换行`) +
    (settings.composer.enterAction === 'speak'
      ? ` · ${settings.composer.route === 'preview' ? '试听' : '发送'}设备`
      : '') +
    ` · ${direction.source} → ${direction.target}`;

  return (
    <div className={`app-shell ${sidebar ? '' : 'sidebar-collapsed'}`}>
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <AudioLines size={19} strokeWidth={1.5} />
          <span>VoxBridge</span>
        </div>
        <nav aria-label="主导航">
          <button
            aria-current={page === 'workspace' ? 'page' : undefined}
            onClick={() => setPage('workspace')}
            disabled={settingsBusy}
          >
            <MessageSquare size={15} />
            字幕
          </button>
        </nav>
        {page === 'workspace' ? (
          <div className="sidebar-bottom">
            <nav aria-label="设置导航">
              <button onClick={() => openSettings()}>
                <Settings2 size={15} />
                设置
              </button>
            </nav>
          </div>
        ) : (
          <nav className="preferences-nav" aria-label="设置分类">
            <span className="nav-group-label">偏好设置</span>
            <button
              disabled={settingsBusy}
              aria-current={
                page === 'settings' && settingsSection === 'general' ? 'page' : undefined
              }
              onClick={() => openSettings('general')}
            >
              <Settings2 size={15} />
              常规
            </button>
            <span className="nav-group-label">模型服务</span>
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
                {label}
              </button>
            ))}
            <span className="nav-group-label">工具</span>
            <button
              disabled={settingsBusy}
              aria-current={page === 'diagnostics' ? 'page' : undefined}
              onClick={() => setPage('diagnostics')}
            >
              <AudioLines size={15} />
              音频与诊断
            </button>
          </nav>
        )}
      </aside>
      <div className="main-shell">
        <header className="titlebar">
          <div>
            <button
              className="icon-button"
              aria-label={sidebar ? '收起侧栏' : '展开侧栏'}
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeftClose size={16} />
            </button>
            <strong>
              {page === 'workspace' ? '字幕' : page === 'settings' ? '设置' : '音频与诊断'}
            </strong>
          </div>
          {page === 'workspace' && (
            <div className="toolbar-actions">
              <button
                disabled={!desktop || !overlayReady}
                onClick={() => void showOverlay().catch(() => notify('无法打开悬浮字幕窗。'))}
                title="隐藏字幕窗不会停止监听；可在悬浮窗返回主窗口或停止"
              >
                悬浮字幕
              </button>
              <button
                onClick={() => void (listening ? endListening() : beginListening())}
                disabled={
                  !desktop ||
                  runtime?.platform !== 'macos' ||
                  listenPhase === 'stopping' ||
                  (!listening && (!captureSourceId || refreshingSources))
                }
                title="开始后，目标声音会发送到所选的语音识别与翻译服务，可能计费"
              >
                {listenPhase === 'stopping' ? '正在停止…' : listening ? '停止监听' : '开始监听'}
              </button>
            </div>
          )}
          {page === 'diagnostics' && (
            <button className="subtle" onClick={() => openSettings()}>
              返回设置
            </button>
          )}
        </header>
        {notice.message && (
          <Toast key={notice.id} message={notice.message} onClose={dismissNotice} />
        )}
        <main
          key={page}
          id="main-content"
          className={page === 'workspace' ? 'workspace' : 'page-scroll'}
        >
          {page === 'settings' && (
            <SettingsPanel
              section={settingsSection}
              onBusyChange={setSettingsBusy}
              settings={settings}
              savedSettings={savedSettings}
              onDraftChange={setSettings}
              onSave={persist}
              notify={notify}
              onDiagnostics={() => setPage('diagnostics')}
            />
          )}
          {page === 'diagnostics' && (
            <Diagnostics runtime={runtime} notify={notify} settings={settings} onSave={persist} />
          )}
          {page === 'workspace' && (
            <>
              <div className="workspace-toolbar">
                <Select
                  label="目标应用音频进程"
                  value={captureSourceId}
                  onChange={setCaptureSourceId}
                  disabled={
                    listening || refreshingSources || !desktop || runtime?.platform !== 'macos'
                  }
                  placeholder="选择音频进程"
                  compact
                  options={[
                    ...captureSources.map((source) => ({
                      value: String(source.pid),
                      label: `${source.bundleId || '音频进程'} · PID ${source.pid}`,
                    })),
                    ...(captureSourceId &&
                    !captureSources.some((source) => String(source.pid) === captureSourceId)
                      ? [{ value: captureSourceId, label: '原进程已不可用，请重新选择' }]
                      : []),
                  ]}
                />
                <button
                  className="subtle"
                  disabled={
                    listening || refreshingSources || !desktop || runtime?.platform !== 'macos'
                  }
                  onClick={() => void refreshCaptureSources()}
                >
                  {refreshingSources ? '刷新中…' : '刷新进程'}
                </button>
                <div className="language-pair">
                  <Select
                    label="源语言"
                    disabled={listening || busy}
                    value={settings.sourceLanguage}
                    onChange={(value) => persist({ ...settings, sourceLanguage: value }, true)}
                    options={languages.map((language) => ({ value: language, label: language }))}
                    compact
                  />
                  <ArrowRight size={12} />
                  <Select
                    label="目标语言"
                    disabled={listening || busy}
                    value={settings.targetLanguage}
                    onChange={(value) => persist({ ...settings, targetLanguage: value }, true)}
                    options={languages.map((language) => ({ value: language, label: language }))}
                    compact
                  />
                </div>
                <ListeningStatus
                  phase={listenPhase}
                  health={listenHealth}
                  progress={listenProgress}
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
              <div
                className="transcript-scroll"
                ref={scrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 70);
                }}
              >
                {!session.segments.length ? (
                  <div className="empty-state">
                    <p>暂无字幕</p>
                  </div>
                ) : (
                  <div className="transcript-content">
                    {session.segments.map((segment) => (
                      <article className="segment" key={segment.id}>
                        <div className="segment-meta">
                          <time>{segment.time}</time>
                          {!segment.final && <span>识别中…</span>}
                        </div>
                        <p className="source-text">{segment.source}</p>
                        {segment.translation && (
                          <p className="translation-text">{segment.translation}</p>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
              {!follow && (
                <button
                  className="jump-latest"
                  onClick={() => {
                    setFollow(true);
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
                  }}
                >
                  <ArrowDown size={13} />
                  最新
                </button>
              )}
              <section className="composer-area" aria-label="文字表达">
                <div className="composer-box">
                  <label className="sr-only" htmlFor="speech-input">
                    输入要翻译或表达的内容
                  </label>
                  <textarea
                    id="speech-input"
                    maxLength={500}
                    value={text}
                    disabled={busy}
                    aria-describedby="composer-hint"
                    title={composerHint}
                    onChange={(event) => {
                      setText(event.target.value);
                      setResult('');
                      setError('');
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
                    placeholder="输入要说的话…"
                  />
                  <div className="composer-controls">
                    <button
                      className="model-button"
                      disabled={busy || listening}
                      onClick={() => openSettings('translation')}
                      title="配置翻译模型"
                    >
                      <Languages size={13} />
                      {translationProfile.modelId || '选择模型'}
                      <ChevronDown size={11} />
                    </button>
                    {text.length > 450 && <span className="input-count">{text.length}/500</span>}
                    <div className="composer-actions">
                      <button
                        className="output-mode"
                        aria-label="输出译文"
                        aria-pressed={settings.composer.output === 'translation'}
                        disabled={busy}
                        title={`切换原文或译文语音；当前 ${direction.source} → ${direction.target}`}
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
                        {settings.composer.output === 'translation' ? '译文' : '原文'}
                      </button>
                      {busy ? (
                        <>
                          <span role="status" className="composer-phase">
                            {
                              {
                                waitingDevice: '等待设备…',
                                translating: '翻译中…',
                                synthesizing: '合成中…',
                                decoding: '准备播放…',
                                playing: '输出中…',
                                stopping: '停止中…',
                                idle: '',
                              }[composerPhase]
                            }
                          </span>
                          <button
                            className="send-button"
                            aria-label="停止当前操作"
                            disabled={composerPhase === 'stopping'}
                            onClick={() => void stopComposer()}
                          >
                            <Square size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="subtle"
                            disabled={!text.trim() || !desktop}
                            onClick={() => void runComposer('translate')}
                            title="仅翻译，不输出语音"
                          >
                            翻译
                          </button>
                          <button
                            className="icon-button"
                            aria-label={
                              settings.composer.output === 'translation'
                                ? '翻译并试听译文'
                                : '试听原文'
                            }
                            title={
                              settings.composer.output === 'translation'
                                ? '自动翻译后在试听设备播放'
                                : '在试听设备播放原文'
                            }
                            disabled={!desktop || !text.trim()}
                            onClick={() => void runComposer('speak', 'preview')}
                          >
                            <Headphones size={16} />
                          </button>
                          <button
                            disabled={!desktop || !text.trim()}
                            title={`输出${settings.composer.output === 'translation' ? '译文' : '原文'}到${settings.composer.route === 'preview' ? '试听' : '发送'}设备 · 可能计费`}
                            aria-label="输出合成语音"
                            className="send-button"
                            onClick={() => void runComposer('speak')}
                          >
                            <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <span id="composer-hint" className="sr-only">
                  {composerHint}
                </span>
                {error && (
                  <p className="error-text" role="alert">
                    {error}
                  </p>
                )}
                {result && (
                  <div className="translation-result">
                    <p>{result}</p>
                    <div className="composer-actions">
                      <button
                        className="subtle"
                        disabled={!desktop || busy || result.length > 500}
                        onClick={() => void runComposer('speak', 'preview', result)}
                      >
                        试听译文
                      </button>
                      <button
                        className="subtle"
                        disabled={!desktop || busy || result.length > 500}
                        onClick={() => void runComposer('speak', 'send', result)}
                      >
                        发送译文
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

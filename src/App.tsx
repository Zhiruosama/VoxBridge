import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Headphones,
  Languages,
  MessageSquare,
  Mic,
  Volume2,
  Monitor,
  PanelLeftClose,
  Pause,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import SettingsPanel, { type SettingsSection } from './components/SettingsPanel';
import Diagnostics from './components/Diagnostics';
import Select from './components/Select';
import { defaults, loadSettings, profileFor, saveSettings, validateProfile } from './core/settings';
import { applyTranscript, applyTranslation } from './core/session';
import type { RuntimeInfo, Session, Settings, TranscriptEvent } from './core/types';
import { cancelTranslation, desktop, runtimeInfo, speak, stopSpeech, translate } from './bridge';

const samples = [
  ["Thanks for joining. Let's review the schedule.", '感谢参加，我们先确认一下日程。'],
  ['The meeting starts at ten tomorrow morning.', '会议将于明天上午十点开始。'],
  ['Could you send me the updated document?', '可以把更新后的文档发给我吗？'],
  ["I'll review it and get back to you this afternoon.", '我会查看文档，并在今天下午回复你。'],
];
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
  const [page, setPage] = useState<Page>('workspace');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [notice, setNotice] = useState(initial.error);
  const [session, setSession] = useState<Session>({ id: null, segments: [] });
  const [demo, setDemo] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const translationProfile = profileFor(settings, 'translation');
  const speechProfile = profileFor(settings, 'tts');
  const speechRef = useRef<string | null>(null);
  const speechStoppingRef = useRef(false);
  const [speechPhase, setSpeechPhase] = useState('');
  const [speechStopping, setSpeechStopping] = useState(false);

  useEffect(() => {
    runtimeInfo()
      .then(setRuntime)
      .catch((e) => setNotice(String(e)));
  }, []);
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
    if (!demo) return;
    const id = crypto.randomUUID();
    setSession({ id, segments: [] });
    setFollow(true);
    let step = 0;
    const interval = window.setInterval(() => {
      const index = Math.floor(step / 3);
      if (index >= samples.length) {
        setDemo(false);
        return;
      }
      const phase = step % 3;
      const [source, target] = samples[index];
      const event: TranscriptEvent = {
        sessionId: id,
        segmentId: `demo-${index}`,
        revision: phase + 1,
        text: phase === 0 ? source.slice(0, Math.floor(source.length / 2)) : source,
        final: phase === 2,
      };
      setSession((current) => {
        const next = applyTranscript(current, event);
        return phase === 2
          ? applyTranslation(next, id, event.segmentId, event.revision, target)
          : next;
      });
      step++;
    }, 950);
    return () => {
      clearInterval(interval);
      setSession((current) => ({ ...current, id: null }));
    };
  }, [demo]);
  useEffect(
    () => () => {
      if (requestRef.current) void cancelTranslation(requestRef.current);
      if (speechRef.current) void stopSpeech(speechRef.current);
    },
    [],
  );

  useEffect(() => {
    if (notice !== '已保存') return;
    const timer = window.setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [notice]);

  function persist(next: Settings, silent = false) {
    try {
      saveSettings(next);
      setSettings(next);
      if (!silent) setNotice('已保存');
    } catch (e) {
      setNotice(`保存失败：${String(e)}`);
    }
  }
  async function runTranslation() {
    if (pendingRef.current || speechRef.current) return;
    const invalid = validateProfile(translationProfile);
    if (invalid) {
      setError(`${invalid} 请到设置页完善文字翻译服务。`);
      return;
    }
    pendingRef.current = true;
    stoppingRef.current = false;
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const translated = await translate(
        translationProfile,
        text,
        settings.sourceLanguage,
        settings.targetLanguage,
        requestId,
      );
      if (requestRef.current === requestId && !stoppingRef.current) setResult(translated);
    } catch (e) {
      if (requestRef.current === requestId && !stoppingRef.current) setError(String(e));
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null;
        pendingRef.current = false;
        setBusy(false);
        setStopping(false);
      }
    }
  }

  async function runSpeech(route: 'preview' | 'send', content = text) {
    if (speechRef.current || pendingRef.current) return;
    const invalid = validateProfile(speechProfile);
    if (invalid) {
      setError(`${invalid} 请到设置页完善语音合成服务。`);
      return;
    }
    if (!(route === 'preview' ? settings.audio.previewDeviceId : settings.audio.sendDeviceId)) {
      setError('请先在常规设置中选择对应的音频输出设备。');
      return;
    }
    const id = crypto.randomUUID();
    speechRef.current = id;
    speechStoppingRef.current = false;
    setSpeechStopping(false);
    setSpeechPhase('正在准备…');
    setError('');
    try {
      await speak(speechProfile, content, settings.audio, route, id, (event) => {
        if (speechRef.current !== event.requestId || speechStoppingRef.current) return;
        const labels: Record<string, string> = {
          synthesizing: '正在合成…',
          decoding: '正在准备播放…',
          playing: route === 'preview' ? '正在试听…' : '正在发送…',
        };
        if (labels[event.phase]) setSpeechPhase(labels[event.phase]);
      });
    } catch (error) {
      if (speechRef.current === id && !speechStoppingRef.current) setError(String(error));
    } finally {
      if (speechRef.current === id) {
        speechRef.current = null;
        setSpeechPhase('');
        setSpeechStopping(false);
      }
    }
  }
  async function cancelSpeech() {
    const id = speechRef.current;
    if (!id) return;
    speechStoppingRef.current = true;
    setSpeechStopping(true);
    setSpeechPhase('正在停止…');
    try {
      await stopSpeech(id);
    } catch (error) {
      setError(String(error));
    }
  }
  async function stopTranslation() {
    const id = requestRef.current;
    if (!id) return;
    stoppingRef.current = true;
    setStopping(true);
    try {
      await cancelTranslation(id);
    } catch (e) {
      setError(String(e));
    }
  }

  function openSettings(section: SettingsSection = 'general') {
    setSettingsSection(section);
    setPage('settings');
  }

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
              {demo ? (
                <button className="subtle" onClick={() => setDemo(false)}>
                  <Pause size={13} />
                  暂停演示
                </button>
              ) : (
                <button disabled title="应用声音采集尚未接入，完成后可在这里开始监听">
                  开始监听
                </button>
              )}
            </div>
          )}
          {page === 'diagnostics' && (
            <button className="subtle" onClick={() => openSettings()}>
              返回设置
            </button>
          )}
        </header>
        {notice && (
          <div className="notice" role="status">
            <Check size={14} />
            <span>{notice}</span>
            <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={14} />
            </button>
          </div>
        )}
        <main id="main-content" className={page === 'workspace' ? 'workspace' : 'page-scroll'}>
          {page === 'settings' && (
            <SettingsPanel
              section={settingsSection}
              onBusyChange={setSettingsBusy}
              settings={settings}
              onSave={persist}
              notify={setNotice}
              onDiagnostics={() => setPage('diagnostics')}
            />
          )}
          {page === 'diagnostics' && (
            <Diagnostics
              runtime={runtime}
              notify={setNotice}
              demo={demo}
              onDemo={() => {
                setDemo(!demo);
                setPage('workspace');
              }}
            />
          )}
          {page === 'workspace' && (
            <>
              <div className="workspace-toolbar">
                <button className="source-button" disabled title="应用音频采集待接入">
                  <Monitor size={14} />
                  选择应用
                  <ChevronDown size={12} />
                </button>
                <div className="language-pair">
                  <Select
                    label="源语言"
                    value={settings.sourceLanguage}
                    onChange={(value) => persist({ ...settings, sourceLanguage: value }, true)}
                    options={languages.map((language) => ({ value: language, label: language }))}
                    compact
                  />
                  <ArrowRight size={12} />
                  <Select
                    label="目标语言"
                    value={settings.targetLanguage}
                    onChange={(value) => persist({ ...settings, targetLanguage: value }, true)}
                    options={languages.map((language) => ({ value: language, label: language }))}
                    compact
                  />
                </div>
                {(demo || session.segments.length > 0) && <span className="demo-label">演示</span>}
              </div>
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
                    onChange={(e) => setText(e.target.value)}
                    placeholder="输入要说的话…"
                  />
                  <div className="composer-controls">
                    <button
                      className="model-button"
                      onClick={() => openSettings('translation')}
                      title="配置翻译模型"
                    >
                      <Languages size={13} />
                      {translationProfile.modelId || '选择模型'}
                      <ChevronDown size={11} />
                    </button>
                    {text.length > 450 && <span className="input-count">{text.length}/500</span>}
                    <div className="composer-actions">
                      {speechPhase ? (
                        <>
                          <span role="status" className="input-count">
                            {speechPhase}
                          </span>
                          <button
                            className="icon-button"
                            aria-label="停止语音"
                            disabled={speechStopping}
                            onClick={() => void cancelSpeech()}
                          >
                            <Square size={13} />
                          </button>
                        </>
                      ) : busy ? (
                        <button
                          className="icon-button"
                          aria-label="停止翻译"
                          disabled={stopping}
                          onClick={() => void stopTranslation()}
                        >
                          <Square size={13} />
                        </button>
                      ) : (
                        <button
                          className="subtle"
                          disabled={!text.trim() || !desktop}
                          onClick={() => void runTranslation()}
                          title={desktop ? '翻译输入的文字' : '请通过桌面应用使用翻译'}
                        >
                          翻译
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label="试听输入文字"
                        title="试听输入文字"
                        disabled={!desktop || !text.trim() || busy || !!speechPhase}
                        onClick={() => void runSpeech('preview')}
                      >
                        <Headphones size={16} />
                      </button>
                      <button
                        disabled={!desktop || !text.trim() || busy || !!speechPhase}
                        title="将输入文字合成为语音并发送到所选设备"
                        aria-label="发送合成语音"
                        className="send-button"
                        onClick={() => void runSpeech('send')}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>
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
                        disabled={!desktop || busy || !!speechPhase || result.length > 500}
                        onClick={() => void runSpeech('preview', result)}
                      >
                        试听译文
                      </button>
                      <button
                        className="subtle"
                        disabled={!desktop || busy || !!speechPhase || result.length > 500}
                        onClick={() => void runSpeech('send', result)}
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

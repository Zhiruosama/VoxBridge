import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Circle,
  Headphones,
  Languages,
  MessageSquare,
  Monitor,
  PanelLeftClose,
  Pause,
  Play,
  Radio,
  Send,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import SettingsPanel from './components/SettingsPanel';
import Diagnostics from './components/Diagnostics';
import { defaults, loadSettings, profileFor, saveSettings, validateProfile } from './core/settings';
import { applyTranscript, applyTranslation } from './core/session';
import type { RuntimeInfo, Session, Settings, TranscriptEvent } from './core/types';
import { cancelTranslation, desktop, runtimeInfo, translate } from './bridge';

const samples = [
  ['Hey, can you hear me? Let’s get started.', '嘿，能听到吗？我们开始吧。'],
  ['I think we should keep the first version simple.', '我觉得第一版应该保持简单。'],
  [
    'Let’s test the audio on the Mac before adding more features.',
    '先在 Mac 上测试音频，再添加更多功能。',
  ],
  ['Sounds good. We can take it one step at a time.', '可以，我们一步一步来。'],
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
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [notice, setNotice] = useState(initial.error);
  const [session, setSession] = useState<Session>({ id: null, segments: [] });
  const [demo, setDemo] = useState(false);
  const [overlayPreview, setOverlayPreview] = useState(false);
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
    },
    [],
  );

  function persist(next: Settings) {
    try {
      saveSettings(next);
      setSettings(next);
      setNotice('设置已保存，下次任务使用新配置。');
    } catch (e) {
      setNotice(`保存失败：${String(e)}`);
    }
  }
  async function runTranslation() {
    if (pendingRef.current) return;
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

  const latest = session.segments.at(-1);
  return (
    <div className={`app-shell ${sidebar ? '' : 'sidebar-collapsed'}`}>
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={21} strokeWidth={1.7} />
          </span>
          <span>
            VoxBridge<span className="brand-caption">声音，自由抵达。</span>
          </span>
        </div>
        <div className="nav-label">工作空间</div>
        <nav aria-label="主导航">
          <button
            aria-current={page === 'workspace' ? 'page' : undefined}
            onClick={() => setPage('workspace')}
          >
            <MessageSquare size={16} />
            实时工作台<span className="nav-shortcut">01</span>
          </button>
        </nav>
        <div className="sidebar-session">
          <span className="small-label">当前会话</span>
          <p>
            <span className={`status-dot ${demo ? 'active' : ''}`} />
            {demo ? '演示字幕运行中' : '尚未开始监听'}
          </p>
          <small>原生音频待 Mac 联调</small>
        </div>
        <div className="sidebar-bottom">
          <nav aria-label="工具导航">
            <button
              aria-current={page === 'settings' ? 'page' : undefined}
              onClick={() => setPage('settings')}
            >
              <Settings2 size={16} />
              设置
            </button>
            <button
              aria-current={page === 'diagnostics' ? 'page' : undefined}
              onClick={() => setPage('diagnostics')}
            >
              <Activity size={16} />
              诊断
            </button>
          </nav>
          <div className="build-label">
            <span className="status-dot" />
            开发预览<span>v0.1</span>
          </div>
        </div>
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
            <span className="muted">工作空间</span>
            <span className="slash">/</span>
            <strong>
              {page === 'workspace' ? '实时工作台' : page === 'settings' ? '设置' : '诊断'}
            </strong>
          </div>
          <span className="titlebar-status">
            <span className="status-dot" />
            {desktop ? '桌面开发版' : '浏览器预览'}
          </span>
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
            <SettingsPanel settings={settings} onSave={persist} notify={setNotice} />
          )}
          {page === 'diagnostics' && <Diagnostics runtime={runtime} notify={setNotice} />}
          {page === 'workspace' && (
            <>
              <div className="workspace-toolbar">
                <div className="source-chip">
                  <Monitor size={15} />
                  <span>应用声音</span>
                  <span className="tag">待接入</span>
                </div>
                <div className="language-pair">
                  <label>
                    <span className="sr-only">源语言</span>
                    <select
                      aria-label="源语言"
                      value={settings.sourceLanguage}
                      onChange={(e) => persist({ ...settings, sourceLanguage: e.target.value })}
                    >
                      {languages.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <ArrowRight size={13} />
                  <label>
                    <span className="sr-only">目标语言</span>
                    <select
                      aria-label="目标语言"
                      value={settings.targetLanguage}
                      onChange={(e) => persist({ ...settings, targetLanguage: e.target.value })}
                    >
                      {languages.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="toolbar-actions">
                  <button
                    title="预览字幕样式；独立置顶悬浮窗待实现"
                    className={overlayPreview ? 'selected' : ''}
                    onClick={() => setOverlayPreview(!overlayPreview)}
                  >
                    <Monitor size={14} />
                    <span>字幕预览</span>
                  </button>
                  <button className={demo ? 'selected' : ''} onClick={() => setDemo(!demo)}>
                    {demo ? <Pause size={14} /> : <Play size={14} />}
                    <span>{demo ? '暂停演示' : '演示字幕'}</span>
                  </button>
                </div>
              </div>
              <div className="session-label">
                <span>
                  <span className={`status-dot ${demo ? 'active' : ''}`} />
                  {demo
                    ? '演示模式 · 固定样例，不采集声音'
                    : session.segments.length
                      ? '演示已暂停 · 内容仅保留在当前窗口'
                      : '准备就绪'}
                </span>
                <span>原文 + 译文</span>
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
                    <div className="empty-symbol">
                      <AudioLines size={36} strokeWidth={1.2} />
                    </div>
                    <span className="eyebrow">LISTEN. UNDERSTAND. CONNECT.</span>
                    <h1>让语言，不再成为距离。</h1>
                    <p>
                      听见对方，也让对方听懂你。
                      <br />
                      从一段双语字幕，开始更自然的交流。
                    </p>
                    <button onClick={() => setDemo(true)}>
                      <Play size={14} />
                      体验字幕演示
                      <ArrowRight size={14} />
                    </button>
                    <div className="empty-hint">
                      <Circle size={9} />
                      演示不录音、不调用付费服务
                    </div>
                  </div>
                ) : (
                  <div className="transcript-content">
                    <div className="timeline-start">
                      <span />
                      本次演示
                      <span />
                    </div>
                    {session.segments.map((segment) => (
                      <article className="segment" key={segment.id}>
                        <div className="segment-meta">
                          <Radio size={12} />
                          <span>演示音源</span>
                          <time>{segment.time}</time>
                          {!segment.final && <span className="recognizing">识别样式演示…</span>}
                        </div>
                        <p className="source-text">{segment.source}</p>
                        {segment.translation ? (
                          <p className="translation-text">{segment.translation}</p>
                        ) : (
                          <p className="translation-pending">等待定稿</p>
                        )}
                      </article>
                    ))}
                    <div className="timeline-end">
                      <span className={`status-dot ${demo ? 'active' : ''}`} />
                      {demo ? '等待下一句…' : '演示结束'}
                    </div>
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
                  回到最新
                </button>
              )}
              {overlayPreview && (
                <div className="overlay-preview">
                  <div>
                    <span>字幕样式预览 · 非置顶窗口</span>
                    <button
                      className="icon-button"
                      aria-label="关闭字幕预览"
                      onClick={() => setOverlayPreview(false)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <small>{latest?.source || 'The next conversation starts here.'}</small>
                  <p>{latest?.translation || '下一段对话，从这里开始。'}</p>
                </div>
              )}
              <section className="composer-area" aria-label="文字表达">
                <div className="composer-caption">
                  <span>
                    <Languages size={14} />
                    文字表达
                  </span>
                  <span>先翻译，再让声音抵达</span>
                </div>
                <div className="composer-box">
                  <label className="sr-only" htmlFor="speech-input">
                    输入要翻译或表达的内容
                  </label>
                  <textarea
                    id="speech-input"
                    maxLength={500}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="输入你想说的话…"
                  />
                  <div className="composer-controls">
                    <button
                      className="model-button"
                      onClick={() => setPage('settings')}
                      title="配置翻译模型"
                    >
                      <span className="model-indicator" />
                      {translationProfile.modelId || '选择翻译模型'}
                      <ChevronDown size={12} />
                    </button>
                    <span className="input-count">{text.length}/500</span>
                    <button
                      className="subtle"
                      disabled={!text.trim() || busy || !desktop}
                      onClick={() => void runTranslation()}
                      title={desktop ? '调用配置的翻译服务，可能计费' : '真实翻译需桌面版'}
                    >
                      <Languages size={14} />
                      {busy ? '翻译中…' : '翻译'}
                    </button>
                    <button
                      className="icon-button"
                      aria-label="停止翻译"
                      disabled={!busy || stopping}
                      onClick={() => void stopTranslation()}
                    >
                      <Square size={13} />
                    </button>
                    <button
                      disabled
                      title="语音合成正在接入，当前不能试听或发送"
                      className="send-button"
                    >
                      <Send size={14} />
                      发送
                    </button>
                  </div>
                </div>
                {error && (
                  <p className="error-text" role="alert">
                    {error}
                  </p>
                )}
                {result && (
                  <div className="translation-result">
                    <span>{settings.targetLanguage}译文</span>
                    <p>{result}</p>
                  </div>
                )}
                <div className="composer-footnote">
                  <span>
                    <Headphones size={12} />
                    TTS 试听与虚拟麦克风发送接入中
                  </span>
                  <button onClick={() => setPage('diagnostics')}>
                    检查音频设备
                    <ArrowRight size={11} />
                  </button>
                </div>
              </section>
            </>
          )}
        </main>
        <footer className="statusbar">
          <span>
            <span className={`status-dot ${demo ? 'active' : ''}`} />
            {demo ? '演示中' : '未监听'}
            <span className="footer-divider" />
            {session.segments.filter((s) => s.final).length} 条字幕
          </span>
          <span>
            macOS 优先
            <span className="footer-divider" />
            声音与对话默认不落盘
          </span>
        </footer>
      </div>
    </div>
  );
}

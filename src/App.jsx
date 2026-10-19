import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  Radio,
  SlidersHorizontal,
  Waves,
  Sparkles,
  ListMusic,
  LogIn,
  LogOut,
  Play,
  Pause,
  Plus,
  Minus,
  RotateCcw,
  Square,
  X,
  ArrowUpRight,
  Shuffle,
  Link2,
  RefreshCw,
  ChevronRight,
  Download,
  Upload,
  Shield,
  CircleHelp,
  CircleUserRound,
  Users,
} from "lucide-react";
import { api, rememberState, localId } from "./api.js";
import Touch from "./Touch.jsx";
import Laboratory from "./lab/Laboratory.jsx";
import Guest from "./lab/Coop.jsx";
import Admin from "./Admin.jsx";
import { ThemeSwitch, DeckSignature, AnalogMeter } from "./Theme.jsx";
import PlaybackDock from "./PlaybackDock.jsx";
import PlaybackTiming, {
  defaultTiming,
  playbackPhase,
} from "./PlaybackTiming.jsx";
import { feedbackPhrases } from "../shared/feedback.mjs";
import { channelLimits } from "../shared/channel-state.mjs";

const groups = [
  ["direct", SlidersHorizontal, "直接控制", ["control", "touch"]],
  [
    "create",
    Waves,
    "制作波形",
    ["waves", "scenes", "record", "draw", "random", "echo"],
  ],
  ["interact", Sparkles, "互动玩法", ["music", "dj", "coop", "branch"]],
  ["history", ListMusic, "操作记录", ["logs"]],
];
const features = {
  control: ["通道控制", "调整 A / B 双通道强度，查看设备当前状态。"],
  touch: ["触控与开火", "滑动改变波形，按住开火临时增加强度，松开恢复。"],
  waves: ["波形工作室", "挑选波形，确认通道和时长，再开始播放。"],
  scenes: ["场景组合", "把波形按时长和顺序编排，保存常用组合。"],
  record: ["触控录制", "录下手指的移动，把节奏保存成双轨片段。"],
  draw: ["画线波形", "画出变化曲线，试听后保存到片段库。"],
  random: ["规律随机", "设置变化范围，生成有规律的随机节奏。"],
  echo: ["A/B 回声", "让 B 通道延迟回应 A 通道，调整两者的节奏关系。"],
  music: ["音乐联动", "选择本地音乐或手动节拍，让波形跟随节奏变化。"],
  dj: ["波形 DJ", "混合两段波形，实时调整过渡比例。"],
  coop: ["多人协作", "独立邀请，多人一起叠加 A/B 两路幅值。"],
  branch: ["互动场景", "设置场景分支，在播放中选择下一段节奏。"],
  logs: ["操作记录", "查看连接、控制与播放事件。数值以设备回传为准。"],
};
const labModes = [
  "record",
  "draw",
  "random",
  "echo",
  "music",
  "dj",
  "coop",
  "branch",
];
const empty = {
  devices: [],
  players: [],
  logs: [],
  limits: {},
  status: "idle",
};
const statusText = {
  idle: "尚未加入房间",
  connecting: "连接中",
  connected: "房间已连接",
  disconnected: "连接已断开",
};
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Num({ value, onChange, min = 0, max = 200, ...props }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
      {...props}
    />
  );
}
export function Wave({ frames = [], large = false, color }) {
  const sample = frames.length
    ? Array.from(
        { length: large ? 150 : 55 },
        (_, i) =>
          frames[Math.floor((i * frames.length) / (large ? 150 : 55))][2],
      )
    : Array(55).fill(0);
  const points = sample
    .map((v, i) => `${(i / (sample.length - 1)) * 300},${46 - v * 1.85}`)
    .join(" ");
  return (
    <svg
      className={`wave ${large ? "large" : ""}`}
      viewBox="0 0 300 54"
      preserveAspectRatio="none"
      role="img"
      aria-label="波形幅值预览"
    >
      <path d="M0 46H300 M0 28H300 M0 10H300" className="wave-grid" />
      <polyline
        points={points}
        fill="none"
        stroke={color || "currentColor"}
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export default function App() {
  const [state, setState] = useState(empty),
    [presets, setPresets] = useState([]),
    [custom, setCustom] = useState([]);
  const [tab, updateTab] = useState("control"),
    [selectedId, setSelectedId] = useState(null),
    [toast, setToast] = useState(null),
    [online, setOnline] = useState(true),
    [linked, setLinked] = useState(false);
  const [queue, setQueue] = useState([]),
    [timing, setTiming] = useState(defaultTiming),
    [seconds, setSeconds] = useState(30),
    [target, setTarget] = useState("0"),
    [scale, setScale] = useState(100),
    [loop, setLoop] = useState(true);
  const [invite, setInvite] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("invite") || "",
  );
  const [route, setRoute] = useState(location.pathname),
    [authRevision, setAuthRevision] = useState(0);
  const navigate = (path) => {
    history.pushState(null, "", path);
    setRoute(path);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      const h = document.querySelector("main h1");
      if (h) {
        h.tabIndex = -1;
        h.focus({ preventScroll: true });
      }
    });
  };
  useEffect(() => {
    const back = () => setRoute(location.pathname);
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const refresh = async () => {
    const next = await api("state");
    setState(next);
    return next;
  };
  const onAuth = (next) => {
    setState(next);
    setOnline(true);
    setAuthRevision((v) => v + 1);
  };
  const toastTimer = useRef();
  const notify = (message, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  const run = async (path, body, message) => {
    try {
      const result = await api(path, body);
      if (message) notify(message);
      return result;
    } catch (error) {
      notify(error.message, true);
      return null;
    }
  };
  const lastFeature = useRef({});
  const group = groups.find((g) => g[3].includes(tab));
  const setTab = (next) => {
    if (next === tab) return;
    lastFeature.current[groups.find((g) => g[3].includes(next))[0]] = next;
    updateTab(next);
    window.scrollTo(0, 0);
  };
  const enterControl = (id) => {
    if (id !== undefined) setSelectedId(id);
    updateTab("control");
    navigate("/");
  };
  useEffect(() => {
    let events,
      cancelled = false,
      initialized = false;
    const offline = () => setOnline(false);
    const resync = async () => {
      if (!initialized || document.hidden || !navigator.onLine) return;
      try {
        const next = await api("state");
        if (!cancelled && navigator.onLine) {
          setState(next);
          setOnline(true);
        }
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", resync);
    window.addEventListener("pageshow", resync);
    document.addEventListener("visibilitychange", resync);
    (async () => {
      // Establish one cookie before opening additional requests.
      const initial = await api("state");
      if (cancelled) return;
      setState(initial);
      initialized = true;
      const waves = await api("presets");
      if (cancelled) return;
      setPresets(waves);
      events = new EventSource("/api/events");
      events.onmessage = (e) => {
        if (!navigator.onLine) return;
        setState(rememberState(JSON.parse(e.data)));
        setOnline(true);
      };
      events.onerror = () => setOnline(false);
    })().catch((e) => {
      setOnline(false);
      notify(e.message, true);
    });
    return () => {
      cancelled = true;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", resync);
      window.removeEventListener("pageshow", resync);
      document.removeEventListener("visibilitychange", resync);
      events?.close();
      clearTimeout(toastTimer.current);
    };
  }, [authRevision]);
  const device =
    state.devices.find((d) => d.id === selectedId) || state.devices[0];
  const ready =
    !!device?.connected &&
    device.slotState?.hasDevice !== false &&
    device.props?.connectState !== "disconnected" &&
    state.status === "connected" &&
    online;
  const channels = target === "both" ? [0, 1] : [Number(target)];
  const forChannels = async (path, body, list = channels) => {
    for (const channel of list)
      if (!(await run(path, { id: device?.id, channel, ...body })))
        return false;
    return true;
  };
  const control = (channel, action, value, duration) =>
    forChannels(
      "control",
      { action, value, duration },
      linked ? [0, 1] : [channel],
    );
  const addQueue = (wave) => {
    if (queue.length >= 30) return notify("队列最多 30 段", true);
    setQueue((q) => [...q, { ...wave, seconds }]);
    notify(`已加入队列：${wave.name}`);
  };
  const start = (items = queue) =>
    forChannels("player/start", {
      queue: items.map((w) => ({
        presetId: w.official ? w.id : undefined,
        frames: w.official ? undefined : w.frames,
        name: w.name,
        seconds: w.seconds || seconds,
      })),
      loop,
      scale,
      timing,
    });
  const stop = () =>
    run("stop", {}, "已发送停止指令：所有播放停止，A / B 强度归零");
  const dock = (state.room || state.devices.length > 0) && (
    <PlaybackDock
      state={state}
      device={device}
      online={online}
      run={run}
      stop={stop}
    />
  );
  if (invite || state.guest)
    return (
      <Guest
        state={state}
        token={invite}
        online={online}
        notify={notify}
        onExit={() => {
          setInvite("");
          history.replaceState(null, "", location.pathname);
        }}
      />
    );
  if (route === "/admin" || route === "/admin/")
    return (
      <div className={dock ? "admin-with-dock" : ""}>
        <Admin
          state={state}
          online={online}
          navigate={navigate}
          refresh={refresh}
          onAuth={onAuth}
          enterControl={enterControl}
        />
        {dock}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setTab("control");
          }}
        >
          <span className="brand-icon">
            <Activity size={26} />
          </span>
          <span>
            DG-LAB<small>REMOTE CONSOLE</small>
          </span>
        </a>
        <div className="arcade-wordmark" aria-hidden="true">
          PULSE
          <span>
            DECK<span className="wordmark-dot">↗</span>
          </span>
          <small>PLAY IT YOUR WAY.</small>
        </div>
        <div className="retro-wordmark" aria-hidden="true">
          <small>PULSE DECK / STEREO</small>
          <b>
            Fine tune.
            <br />
            Feel more.
          </b>
          <div className="speaker-grille" />
          <span>DUAL CHANNEL / 02</span>
        </div>
        <div className="nav-caption">工作空间</div>
        <nav aria-label="主导航">
          {groups.map(([key, Icon, name, items]) => (
            <button
              key={key}
              onClick={() => setTab(lastFeature.current[key] || items[0])}
              aria-current={group[0] === key ? "page" : undefined}
              className={group[0] === key ? "active" : ""}
            >
              <Icon size={19} />
              {name}
              {group[0] === key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-label">
            <span className={`status-dot ${online ? "green" : ""}`} />
            {online ? "面板服务在线" : "面板连接中断"}
          </div>
          <p>
            COYOTE 2.0
            <br />
            自己的空间，自己的节奏。
          </p>
          <button
            className="subtle"
            onClick={() => run("demo", { enabled: !state.demo })}
          >
            {state.demo ? "退出演示模式" : "探索演示模式"}
            <ArrowUpRight size={14} />
          </button>
          <span className="version">WEB PANEL / v{__APP_VERSION__}</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            工作空间 <ChevronRight size={13} />
            <b>{group[2]}</b>
          </span>
          <div className="top-actions">
            <ThemeSwitch />
            <span
              className={`connection-pill ${state.status === "connected" ? "live" : ""}`}
            >
              <span className="status-dot" />
              {statusText[state.status]}
            </span>
            <button className="account" onClick={() => navigate("/admin")}>
              <Shield size={18} />
              <span>
                {state.admin?.authenticated ? "连接管理" : "管理员入口"}
              </span>
            </button>
            {device?.connected && <button className="invite-shortcut" aria-label="邀请协作" title="邀请协作" disabled={!online} onClick={() => setTab("coop")}>
              <Users size={18} /><span>邀请协作</span>
            </button>}
          </div>
        </header>
        {!online && (
          <div className="banner error">
            面板连接中断，控制已禁用。恢复连接后请重新检查设备状态。
          </div>
        )}
        {state.demo && (
          <div className="banner">
            <Radio size={16} /> 演示模式 · 操作只在本地模拟，不连接真实设备。
            <button onClick={() => run("demo", { enabled: false })}>
              退出演示 <X size={14} />
            </button>
          </div>
        )}
        <main>
          <div className="page-heading" data-section={tab}>
            <div>
              <p className="eyebrow">
                <span className="arcade-kicker">PULSE DECK / </span>DG-LAB /{" "}
                {tab.toUpperCase()}
              </p>
              <h1>{features[tab][0]}</h1>
              <p className="muted">{features[tab][1]}</p>
            </div>
            <DeckSignature />
          </div>
          {group[3].length > 1 && (
            <nav className="feature-nav" aria-label="功能选择">
              {group[3].map((key) => (
                <button
                  key={key}
                  aria-current={tab === key ? "page" : undefined}
                  className={tab === key ? "active" : ""}
                  onClick={() => setTab(key)}
                >
                  {features[key][0]}
                </button>
              ))}
            </nav>
          )}
          {!device?.connected && !state.demo && (
            <section className="connection-guide">
              <Link2 size={22} />
              <div>
                <b>
                  {state.admin?.authenticated
                    ? state.room
                      ? "接管设备后即可开始控制"
                      : "先完成账号与房间连接"
                    : "连接设备，从管理员入口开始"}
                </b>
                <p>
                  {state.admin?.authenticated
                    ? "在连接管理中登录官方账号、加入房间并接管设备。"
                    : "真实设备由管理员管理；受邀协作者通过邀请链接参与。也可以先体验全部演示功能。"}
                </p>
              </div>
              <div className="lab-buttons">
                <button className="primary" onClick={() => navigate("/admin")}>
                  {state.admin?.authenticated ? "打开连接管理" : "管理员认证"}
                  <ArrowUpRight size={15} />
                </button>
                {!state.room && (
                  <button onClick={() => run("demo", { enabled: true })}>
                    先体验演示
                  </button>
                )}
              </div>
            </section>
          )}
          {!(tab === "control" && !device && !state.demo) && (
            <div className="main-grid">
              <div className="main-content">
                <section className="device-strip">
                  <div className="device-symbol">
                    <Radio size={24} />
                  </div>
                  <div className="device-details">
                    <b>
                      {device?.name || (device ? "COYOTE 2.0" : "等待设备连接")}
                    </b>
                    <span>
                      {device
                        ? `${device.type} · ${device.connected ? "已接管 · 状态同步中" : "可用 · 尚未接管"}`
                        : "在连接管理中加入房间并接管设备"}
                    </span>
                  </div>
                  <div className="device-buttons">
                    {state.devices.length > 1 && (
                      <select
                        aria-label="选择设备"
                        value={device?.id ?? ""}
                        onChange={(e) => setSelectedId(Number(e.target.value))}
                      >
                        {state.devices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name || d.type} / {d.id}
                          </option>
                        ))}
                      </select>
                    )}
                    {device &&
                      (state.demo ? (
                        <button
                          className={device.connected ? "secondary" : "primary"}
                          disabled={!online || state.status !== "connected"}
                          onClick={() =>
                            run(
                              `device/${device.connected ? "detach" : "attach"}`,
                              { id: device.id },
                            )
                          }
                        >
                          {device.connected ? "释放控制" : "接管设备"}
                        </button>
                      ) : (
                        <button onClick={() => navigate("/admin")}>
                          管理连接
                        </button>
                      ))}
                  </div>
                </section>
                {tab === "control" && (device || state.demo) && (
                  <>
                    <div className="section-heading">
                      <h2>
                        通道控制 <span className="section-tag">LIVE</span>
                      </h2>
                      <label className="switch-label">
                        <input
                          type="checkbox"
                          checked={linked}
                          onChange={(e) => setLinked(e.target.checked)}
                        />
                        <Link2 size={14} /> A / B 联动
                      </label>
                    </div>
                    <div className="channel-grid">
                      {[0, 1].map((c) => (
                        <Channel
                          key={`${device?.id}:${c}`}
                          c={c}
                          state={state}
                          device={device}
                          ready={ready}
                          control={control}
                          run={run}
                        />
                      ))}
                    </div>
                    <section className="panel quick-waves">
                      <div className="section-heading">
                        <h2>即刻播放</h2>
                        <button
                          className="subtle"
                          onClick={() => setTab("waves")}
                        >
                          全部波形 <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <div className="quick-grid">
                        {presets
                          .filter((p) =>
                            ["呼吸", "潮汐", "心跳节奏"].includes(p.name),
                          )
                          .map((p) => (
                            <button
                              className="quick-wave"
                              key={p.id}
                              onClick={() => {
                                setQueue([{ ...p, seconds }]);
                                setTab("waves");
                              }}
                            >
                              <Wave frames={p.frames} />
                              <span>
                                {p.name}
                                <ChevronRight size={15} />
                              </span>
                            </button>
                          ))}
                      </div>
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>快捷反馈</h2>
                        <span className="muted small">发送给房主</span>
                      </div>
                      <Feedback ready={ready} run={run} id={device?.id} />
                      {device?.feedback && (
                        <p className="peer-reply" role="status">
                          房主：
                          {feedbackPhrases[device.feedback.feel] || "收到反馈"}
                        </p>
                      )}
                    </section>
                  </>
                )}
                {tab === "touch" && (
                  <Touch
                    ready={ready}
                    device={device}
                    state={state}
                    presets={presets}
                    run={run}
                    notify={notify}
                  />
                )}
                {device && (
                  <Laboratory
                    mode={labModes.includes(tab) ? tab : null}
                    device={device}
                    state={state}
                    presets={presets}
                    ready={ready}
                    run={run}
                    notify={notify}
                  />
                )}
                {tab === "waves" && (
                  <WaveStudio
                    presets={presets}
                    custom={custom}
                    setCustom={setCustom}
                    addQueue={addQueue}
                    run={run}
                    notify={notify}
                  />
                )}
                {tab === "scenes" && (
                  <Scenes
                    presets={presets}
                    queue={queue}
                    setQueue={setQueue}
                    setTab={setTab}
                    notify={notify}
                  />
                )}
                {["waves", "scenes"].includes(tab) && (
                  <section className="panel queue-panel">
                    <div className="section-heading">
                      <h2>
                        <ListMusic size={18} /> 播放队列{" "}
                        <span className="count">{queue.length}</span>
                      </h2>
                      <button
                        className="subtle"
                        disabled={!queue.length}
                        onClick={() => setQueue([])}
                      >
                        清空
                      </button>
                    </div>
                    {!queue.length ? (
                      <div className="empty-state">
                        <Waves size={30} />
                        <p>还没有安排好的节奏</p>
                        <span>从波形库添加，或选择一个场景组合。</span>
                      </div>
                    ) : (
                      <div className="queue-list">
                        {queue.map((w, i) => (
                          <div className="queue-row" key={`${w.id}:${i}`}>
                            <span className="row-index">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <b>{w.name}</b>
                            <Num
                              aria-label={`${w.name}时长`}
                              value={w.seconds}
                              min={1}
                              max={600}
                              onChange={(seconds) =>
                                setQueue((q) =>
                                  q.map((w, j) =>
                                    j === i ? { ...w, seconds } : w,
                                  ),
                                )
                              }
                            />
                            <small>秒</small>
                            <button
                              className="icon-button"
                              aria-label={`上移${w.name}`}
                              disabled={i === 0}
                              onClick={() =>
                                setQueue((q) => {
                                  const n = [...q];
                                  [n[i - 1], n[i]] = [n[i], n[i - 1]];
                                  return n;
                                })
                              }
                            >
                              ↑
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`移除${w.name}`}
                              onClick={() =>
                                setQueue((q) => q.filter((_, j) => i !== j))
                              }
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="play-settings">
                      <Field label="输出通道">
                        <select
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="0">通道 A</option>
                          <option value="1">通道 B</option>
                          <option value="both">A + B</option>
                        </select>
                      </Field>
                      <Field label="默认时长 / 秒">
                        <Num
                          value={seconds}
                          min={1}
                          max={600}
                          onChange={setSeconds}
                        />
                      </Field>
                      <Field label={`波形幅值 ${scale}%`}>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={scale}
                          onChange={(e) => setScale(Number(e.target.value))}
                        />
                      </Field>
                    </div>
                    <PlaybackTiming value={timing} onChange={setTiming} />
                    <div className="queue-actions">
                      <label className="switch-label">
                        <input
                          type="checkbox"
                          checked={loop}
                          onChange={(e) => setLoop(e.target.checked)}
                        />{" "}
                        循环队列
                      </label>
                      <div>
                        <button
                          disabled={!ready}
                          onClick={async () => {
                            if (await forChannels("player/stop", {}))
                              notify("所选通道波形已停止，基础强度保留");
                          }}
                        >
                          <Square size={15} /> 停止波形
                        </button>
                        <button
                          className="primary"
                          disabled={!ready || !queue.length}
                          onClick={() => start()}
                        >
                          <Play size={15} /> 播放队列
                        </button>
                      </div>
                    </div>
                  </section>
                )}
                {tab === "logs" && (
                  <section className="panel logs">
                    <div className="section-heading">
                      <h2>会话记录</h2>
                      <span className="muted small">仅保留本次会话</span>
                    </div>
                    {!state.logs.length ? (
                      <div className="empty-state">
                        <ListMusic />
                        <p>连接后在这里查看操作记录</p>
                      </div>
                    ) : (
                      [...state.logs].reverse().map((l, i) => (
                        <div
                          className={`log-row ${l.kind}`}
                          key={`${l.time}:${i}`}
                        >
                          <time>
                            {new Date(l.time).toLocaleTimeString("zh-CN", {
                              hour12: false,
                            })}
                          </time>
                          <span>{l.message}</span>
                        </div>
                      ))
                    )}
                  </section>
                )}
              </div>
              <aside className="right-rail">
                <Connection state={state} run={run} navigate={navigate} />
                <section className="panel playback">
                  <div className="section-heading">
                    <h2>正在播放</h2>
                    <Activity size={17} />
                  </div>
                  {[0, 1].map((c) => {
                    const p = state.players.find(
                      (p) => p.deviceId === device?.id && p.channel === c,
                    );
                    const experiment =
                      state.lab?.running &&
                      state.lab.deviceId === device?.id &&
                      state.lab.channels?.includes(c)
                        ? state.lab
                        : null;
                    return (
                      <div
                        className={`playback-item ${c === 1 ? "mint" : ""}`}
                        key={c}
                      >
                        <span className="channel-letter">
                          {c === 0 ? "A" : "B"}
                        </span>
                        <div>
                          <b>{experiment?.label || p?.label || "未播放波形"}</b>
                          <small>
                            {device?.slotState?.[c ? "channelB" : "channelA"]?.isMuted ? "输出已暂停" : experiment
                              ? experiment.waiting
                                ? "等待场景选择 · 当前静默"
                                : `实验室 · ${(experiment.tick / 10).toFixed(1)} 秒`
                              : p
                                ? playbackPhase(p, state.serverTime) ||
                                  `第 ${p.index + 1} / ${p.queueLength} 段 · ${p.duration} 秒`
                                : "等待你的下一个节奏"}
                          </small>
                        </div>
                        <span
                          className={`status-dot ${(p || experiment) && !device?.slotState?.[c ? "channelB" : "channelA"]?.isMuted ? "green" : ""}`}
                        />
                      </div>
                    );
                  })}
                </section>
                <div className="rail-caption">
                  DESIGNED FOR YOUR RHYTHM
                  <br />
                  <span>COYOTE 2.0 · REMOTE</span>
                </div>
              </aside>
            </div>
          )}
          <footer>
            <span>DG-LAB REMOTE CONSOLE</span>
            <span>v{__APP_VERSION__} · 非官方 Web 客户端 · 自托管</span>
          </footer>
        </main>
        {dock}
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.message}
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Connection({ state, run, navigate }) {
  return (
    <section className="panel connection connection-overview">
      <div className="section-heading">
        <h2>
          <Link2 size={17} />
          连接概览
        </h2>
        <span
          className={`status-dot ${state.status === "connected" ? "green" : ""}`}
        />
      </div>
      {state.room ? (
        <>
          <div className="room-code">{state.demo ? "DEMO" : "COYOTE 2.0"}</div>
          <div className="connection-summary">
            {state.demo ? "本地演示房间" : state.peer?.nickname || "远程房间"}
            <br />
            {statusText[state.status]} · {state.devices.length} 台设备
          </div>
          {state.demo ? (
            <button
              className="full"
              onClick={() => run("demo", { enabled: false })}
            >
              <LogOut size={14} />
              退出演示房间
            </button>
          ) : (
            <button className="full" onClick={() => navigate("/admin")}>
              管理账号与连接
              <ArrowUpRight size={15} />
            </button>
          )}
        </>
      ) : (
        <>
          <p className="connection-summary">
            {state.admin?.authenticated
              ? "管理员已认证 · 等待连接"
              : "尚未连接真实设备"}
          </p>
          <button className="full" onClick={() => navigate("/admin")}>
            打开管理页
            <ArrowUpRight size={15} />
          </button>
        </>
      )}
    </section>
  );
}
function Channel({ c, state, device, ready, control, run }) {
  const name = c === 0 ? "A" : "B",
    cs = device?.slotState?.[`channel${name}`] || {},
    intensity = device?.props?.[`intensity${name}`];
  const {
      remote,
      local,
      effective: cap,
    } = channelLimits(device, c, state.limits),
    [target, setTarget] = useState(0),
    [step, setStep] = useState(1),
    [boost, setBoost] = useState(5),
    [duration, setDuration] = useState(3);
  useEffect(() => setTarget((value) => Math.min(value, cap)), [cap]);
  return (
    <section className={`panel channel-card ${c === 1 ? "mint" : ""}`}>
      <div className="channel-top">
        <span className="channel-badge">{name}</span>
        <div>
          <h3>通道 {name}</h3>
          <span>
            {ready
              ? cs.isMuted
                ? "输出已暂停"
                : "设备状态已同步"
              : "等待接管"}
          </span>
        </div>
        <span className={`status-dot ${ready && !cs.isMuted ? "green" : ""}`} />
      </div>
      <div className="instrument-readout">
        <AnalogMeter value={intensity} max={cap} ready={ready} name={name} />
        <div className="intensity">
          <strong>
            {ready && Number.isFinite(intensity)
              ? String(intensity).padStart(2, "0")
              : "—"}
          </strong>
          <div>
            当前强度<small>设备上限 {ready ? (remote ?? "—") : "—"}</small>
            {local !== null && (
              <small>
                自设上限 {local} · 可调至 {cap}
              </small>
            )}
          </div>
        </div>
      </div>
      <div className="intensity-meter" aria-hidden="true">
        <i
          style={{
            width: `${ready ? clamp((intensity / (cap || 1)) * 100, 0, 100) : 0}%`,
          }}
        />
      </div>
      <div className="meter-scale" aria-hidden="true">
        <span>00</span>
        <span>INTENSITY / {ready ? cap : "—"}</span>
      </div>
      {ready &&
        (cs.comfortLimit?.overheat ||
          cs.warmUpScale < 1 ||
          remote === null) && (
          <div className="channel-condition" role="status">
            {remote === null
              ? "等待上限同步"
              : cs.comfortLimit?.overheat
                ? `舒适保护中 · 上限 ${remote}`
                : `预热中 · ${Math.round(cs.warmUpScale * 100)}%`}
          </div>
        )}
      <div className="steps">
        <button
          aria-label={`${name}减少强度`}
          disabled={!ready}
          onClick={() => control(c, "add", -step)}
        >
          <Minus size={18} />
        </button>
        <select
          aria-label={`${name}步长`}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        >
          <option value="1">步长 1</option>
          <option value="5">步长 5</option>
          <option value="10">步长 10</option>
        </select>
        <button
          aria-label={`${name}增加强度`}
          disabled={!ready || remote === null || intensity >= cap}
          onClick={() => control(c, "add", step)}
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="set-target">
        <Num
          aria-label={`${name}目标强度`}
          value={target}
          max={cap}
          onChange={setTarget}
        />
        <button
          disabled={!ready || remote === null}
          onClick={() => control(c, "set", target)}
        >
          设定强度
        </button>
      </div>
      <div className="button-row">
        <button
          disabled={!ready}
          onClick={() => control(c, "mute", !cs.isMuted)}
        >
          {cs.isMuted ? <Play size={15} /> : <Pause size={15} />}
          {cs.isMuted ? "恢复输出" : "暂停输出"}
        </button>
        <button disabled={!ready} onClick={() => control(c, "set", 0)}>
          <RotateCcw size={15} /> 强度归零
        </button>
      </div>
      <details>
        <summary>
          临时增强与上限 <ChevronRight size={14} />
        </summary>
        <div className="inline-fields">
          <Field label="临时增量">
            <Num value={boost} onChange={setBoost} />
          </Field>
          <Field label="持续 / 秒">
            <Num value={duration} min={1} max={30} onChange={setDuration} />
          </Field>
        </div>
        <button
          className="full"
          disabled={!ready}
          onClick={() => control(c, "boost", boost, duration * 1000)}
        >
          临时 +{boost} · {duration}s
        </button>
        <label className="switch-label cap-toggle">
          <input
            type="checkbox"
            checked={local !== null}
            disabled={!ready || remote === null}
            onChange={(e) =>
              run("limit", {
                id: device.id,
                channel: c,
                value: e.target.checked ? cap : null,
              })
            }
          />
          自设上限
        </label>
        {local !== null && (
          <Field label="面板发送上限">
            <Num
              value={local}
              disabled={!ready}
              onChange={(value) =>
                run("limit", { id: device.id, channel: c, value })
              }
            />
          </Field>
        )}
        <div className="readouts">
          <span>
            设备有效上限 <b>{cs.intensityMax ?? "—"}</b>
          </span>
          <span>
            舒适上限 <b>{cs.comfortLimit?.comfortMax ?? "—"}</b>
          </span>
          <span>
            绝对上限 <b>{cs.comfortLimit?.absoluteMax ?? "—"}</b>
          </span>
          <span>
            过热状态{" "}
            <b>
              {cs.comfortLimit?.overheat === undefined
                ? "—"
                : cs.comfortLimit.overheat
                  ? "限制中"
                  : "正常"}
            </b>
          </span>
        </div>
      </details>
    </section>
  );
}
function Feedback({ ready, run, id }) {
  return (
    <div className="feedback">
      {[
        [11, "可以开始吗？"],
        [12, "波形可以吗？"],
        [13, "强度怎么样？"],
        [14, "我要加强了！"],
        [15, "还能接受吗？"],
        [16, "要休息下吗？"],
      ].map(([feel, label]) => (
        <button
          key={feel}
          disabled={!ready}
          onClick={() => run("feel", { id, feel }, "反馈已发送")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function WaveStudio({ presets, custom, setCustom, addQueue, run, notify }) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(null),
    [frequency, setFrequency] = useState(30),
    [amplitude, setAmplitude] = useState(50),
    [shape, setShape] = useState("sine"),
    [name, setName] = useState("我的波形"),
    [content, setContent] = useState("");
  const all = [...presets, ...custom],
    wave = all.find((w) => w.id === selected) || all[0];
  return (
    <>
      <section className="panel waveform-detail">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              {wave?.official ? "OFFICIAL PRESET" : "CUSTOM WAVE"}
            </p>
            <h2>{wave?.name || "加载波形…"}</h2>
          </div>
          <button
            className="primary"
            disabled={!wave}
            onClick={() => addQueue(wave)}
          >
            <Plus size={16} /> 加入队列
          </button>
        </div>
        <Wave frames={wave?.frames} large />
        <div className="wave-detail-footer">
          <span>幅值曲线 · 不代表通道强度</span>
          <span>
            {wave ? `${(wave.frames.length / 10).toFixed(1)}s / 周期` : "—"}
          </span>
        </div>
      </section>
      <div className="section-heading">
        <h2>
          波形库 <span className="count">{all.length}</span>
        </h2>
        <input
          className="search"
          aria-label="搜索波形"
          placeholder="搜索波形…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="wave-grid-cards">
        {all
          .filter((w) => w.name.includes(query))
          .map((w) => (
            <button
              className={`wave-tile ${wave?.id === w.id ? "selected" : ""}`}
              key={w.id}
              onClick={() => setSelected(w.id)}
            >
              <div>
                <b>{w.name}</b>
                <span>{w.official ? "内置" : "自定义"}</span>
              </div>
              <Wave frames={w.frames} />
            </button>
          ))}
      </div>
      <section className="panel">
        <details>
          <summary>
            <h2>制作与导入波形</h2>
            <Plus size={17} />
          </summary>
          <div className="play-settings">
            <Field label="名称">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
              />
            </Field>
            <Field label="频率 / Hz">
              <Num
                value={frequency}
                min={1}
                max={100}
                onChange={setFrequency}
              />
            </Field>
            <Field label="幅值 / %">
              <Num value={amplitude} max={100} onChange={setAmplitude} />
            </Field>
            <Field label="包络">
              <select value={shape} onChange={(e) => setShape(e.target.value)}>
                <option value="sine">呼吸</option>
                <option value="flat">恒定</option>
                <option value="pulse">脉冲</option>
                <option value="ramp">渐强</option>
              </select>
            </Field>
          </div>
          <button
            onClick={async () => {
              const w = await run("pulse/custom", {
                name,
                frequency,
                amplitude,
                shape,
                seconds: 2,
              });
              if (w) {
                setCustom((v) => [...v, w]);
                setSelected(w.id);
              }
            }}
          >
            <Plus size={15} /> 生成自定义波形
          </button>
          <hr />
          <Field label="导入官方 .pulse 波形文本" hint="Dungeonlab+pulse">
            <textarea
              placeholder="Dungeonlab+pulse:…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>
          <div className="button-row">
            <label className="file-button">
              <Upload size={14} /> 读取文件
              <input
                type="file"
                accept=".pulse,.txt"
                onChange={async (e) => {
                  const f = e.target.files[0];
                  if (f) {
                    if (f.size > 100000) return notify("文件过大", true);
                    setContent((await f.text()).trim());
                  }
                }}
              />
            </label>
            <button
              disabled={!content}
              onClick={async () => {
                const w = await run("pulse/import", {
                  content: content.trim(),
                  name,
                });
                if (w) {
                  setCustom((v) => [...v, w]);
                  setSelected(w.id);
                  setContent("");
                }
              }}
            >
              导入波形
            </button>
          </div>
        </details>
      </section>
    </>
  );
}
function Scenes({ presets, queue, setQueue, setTab, notify }) {
  const [saved, setSaved] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem("dg-scenes") || "[]")
          .filter((s) => Array.isArray(s.queue))
          .slice(0, 20);
      } catch {
        return [];
      }
    }),
    [name, setName] = useState("我的场景");
  const pick = (names, seconds) =>
    names
      .map((name) => presets.find((p) => p.name === name))
      .filter(Boolean)
      .map((w) => ({ ...w, seconds }));
  const save = (list) => {
    try {
      localStorage.setItem("dg-scenes", JSON.stringify(list));
      setSaved(list);
    } catch {
      notify("浏览器存储空间不足", true);
    }
  };
  const load = (q) => {
    setQueue(q);
    notify("场景已放入队列，确认后开始播放");
  };
  return (
    <>
      <div className="scene-grid">
        {[
          [
            "01",
            "呼吸之间",
            "呼吸 → 潮汐 → 树荫",
            ["呼吸", "潮汐", "树荫"],
            45,
          ],
          [
            "02",
            "节奏漫游",
            "律动 → 舞步 → 心跳节奏",
            ["律动", "舞步", "心跳节奏"],
            30,
          ],
        ].map(([n, title, desc, names, secs]) => (
          <button
            className="scene-card"
            key={n}
            onClick={() => load(pick(names, secs))}
          >
            <span className="scene-number">{n}</span>
            <Waves size={30} />
            <h3>{title}</h3>
            <p>{desc}</p>
            <span>
              载入组合 <ArrowUpRight size={16} />
            </span>
          </button>
        ))}
        <button
          className="scene-card random"
          onClick={() => {
            const a = [...presets];
            for (let i = a.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [a[i], a[j]] = [a[j], a[i]];
            }
            load(a.slice(0, 5).map((w) => ({ ...w, seconds: 20 })));
          }}
        >
          <span className="scene-number">03</span>
          <Shuffle size={30} />
          <h3>随机漫游</h3>
          <p>随机 5 个波形 · 每段 20 秒</p>
          <span>
            生成一次新组合 <ArrowUpRight size={16} />
          </span>
        </button>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>我的场景</h2>
          <span className="small muted">保存在当前浏览器</span>
        </div>
        <div className="save-scene">
          <input
            aria-label="场景名称"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            disabled={!queue.length || saved.length >= 20}
            onClick={() => {
              save([...saved, { id: localId(), name, queue }]);
              notify("当前队列已保存");
            }}
          >
            保存当前队列
          </button>
        </div>
        {saved.map((s) => (
          <div className="queue-row" key={s.id}>
            <b>{s.name}</b>
            <small>{s.queue.length} 段</small>
            <button onClick={() => load(s.queue)}>载入</button>
            <button
              className="icon-button"
              aria-label={`删除${s.name}`}
              onClick={() => save(saved.filter((x) => x.id !== s.id))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

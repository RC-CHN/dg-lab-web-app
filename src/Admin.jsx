import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  ShieldCheck,
  LockKeyhole,
  LogOut,
  Eye,
  EyeOff,
  Radio,
  Link2,
  RefreshCw,
  Check,
  CircleUserRound,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { api } from "./api.js";
import { Field } from "./App.jsx";
import "./admin.css";
import { ThemeSwitch } from "./Theme.jsx";

function Step({
  number,
  title,
  summary,
  open,
  done,
  available,
  onToggle,
  children,
}) {
  return (
    <section
      className={`panel admin-card wizard-step ${open ? "is-open" : ""}`}
    >
      <h2>
        <button
          id={`step-${number}`}
          className="step-heading"
          aria-expanded={open}
          aria-controls={`step-body-${number}`}
          disabled={!available}
          onClick={onToggle}
        >
          <span className={`step-number ${done ? "complete" : ""}`}>
            {done ? <Check size={18} /> : number}
          </span>
          <span className="step-copy">
            <b>{title}</b>
            <small>{summary}</small>
          </span>
          {available && <ChevronDown size={18} className="step-chevron" />}
        </button>
      </h2>
      <div id={`step-body-${number}`} className="step-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
export default function Admin({
  state,
  online,
  navigate,
  refresh,
  onAuth,
  enterControl,
}) {
  const [password, setPassword] = useState(""),
    [show, setShow] = useState(false);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [accountMode, setAccountMode] = useState("phone"),
    [account, setAccount] = useState(""),
    [officialPassword, setOfficialPassword] = useState(""),
    [token, setToken] = useState("");
  const [code, setCode] = useState(""),
    [roomPassword, setRoomPassword] = useState("");
  const authenticated = !!state.admin?.authenticated;
  const operation = useRef(0);
  const previouslyAuthenticated = useRef(authenticated);
  useEffect(() => {
    if (previouslyAuthenticated.current && !authenticated) {
      operation.current++;
      setBusy("");
      setPassword("");
      setOfficialPassword("");
      setToken("");
      setCode("");
      setRoomPassword("");
      setNotice("管理认证已结束，官方连接和协作邀请已关闭。");
    }
    previouslyAuthenticated.current = authenticated;
  }, [authenticated]);
  const command = async (path, body, message) => {
    if (busy && path !== "admin/logout") return null;
    const attempt = ++operation.current;
    setBusy(path);
    setError("");
    setNotice("");
    try {
      const result = await api(path, body);
      if (attempt !== operation.current) return null;
      if (path.startsWith("admin/")) onAuth(result);
      else await refresh();
      if (message && attempt === operation.current) setNotice(message);
      return result;
    } catch (e) {
      if (attempt === operation.current) setError(e.message);
      return null;
    } finally {
      if (attempt === operation.current) setBusy("");
    }
  };
  const connected = state.status === "connected" && !state.demo;
  const acquired = connected && state.devices.some((d) => d.connected);
  const disabled = !!busy || !online;
  const nextStep =
    !state.user || state.demo ? 1 : !connected ? 2 : !acquired ? 3 : 4;
  const [editing, setEditing] = useState(null);
  const previousStep = useRef(nextStep);
  useEffect(() => {
    if (previousStep.current !== nextStep) {
      setEditing(null);
      if (authenticated)
        requestAnimationFrame(() => {
          const heading = document.getElementById(
            nextStep === 4 ? "connection-ready" : `step-${nextStep}`,
          );
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView({ block: "nearest" });
        });
    }
    previousStep.current = nextStep;
  }, [nextStep, authenticated]);
  const openStep = editing ?? nextStep;
  const toggleStep = (step) => setEditing(openStep === step ? 0 : step);

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <a
          className="admin-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            enterControl();
          }}
        >
          <Activity size={26} />
          <span>
            DG-LAB<small>CONNECTION ADMIN</small>
          </span>
        </a>
        <div className="admin-header-actions">
          <ThemeSwitch />
          <a
            className="admin-back"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              enterControl();
            }}
          >
            <ArrowLeft size={16} />
            <span>返回控制台</span>
          </a>
        </div>
      </header>
      {!state.admin ? (
        <main className="admin-loading" role="status">
          正在读取认证状态…
        </main>
      ) : !authenticated ? (
        <main className="admin-gate">
          <div className="admin-gate-icon">
            <LockKeyhole size={27} />
          </div>
          <p className="eyebrow">PRIVATE ACCESS</p>
          <h1>管理员入口</h1>
          <p className="admin-lead">
            验证面板口令后，管理官方账号、远程房间和设备连接。
          </p>
          {notice && (
            <div className="admin-message" role="status">
              {notice}
            </div>
          )}
          {!state.admin.configured ? (
            <div className="admin-setup" role="status">
              <b>尚未设置管理员口令</b>
              <p>
                在服务器的 <code>.env</code> 中设置至少 12 位的{" "}
                <code>ADMIN_PASSWORD</code>
                ，然后重启服务。配置完成前仅开放演示和受限协作。
              </p>
              <button onClick={refresh}>重新检查配置</button>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await command("admin/login", { password }, "管理员认证成功");
                setPassword("");
              }}
            >
              <Field label="管理员口令">
                <div className="admin-password">
                  <input
                    type={show ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="admin-password-help"
                    autoFocus
                  />
                  <button
                    type="button"
                    aria-label={show ? "隐藏口令" : "显示口令"}
                    aria-pressed={show}
                    onClick={() => setShow((v) => !v)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
              <p id="admin-password-help" className="hint">
                输入部署时设置的管理员口令。
              </p>
              {error && (
                <div className="admin-message error" role="alert">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
              <button className="primary full" disabled={!!busy || !password}>
                {busy ? "正在验证…" : "进入管理面板"}
                <ArrowUpRight size={16} />
              </button>
            </form>
          )}
          <div className="admin-gate-footer">
            <ShieldCheck size={16} />
            <span>仅当前浏览器获得管理权限 · 认证有效 8 小时</span>
          </div>
          <button
            className="subtle full"
            onClick={async () => {
              const r = await command("demo", { enabled: true });
              if (r) navigate("/");
            }}
          >
            先体验演示
          </button>
        </main>
      ) : (
        <main className="admin-main">
          <div className="admin-title">
            <div>
              <p className="eyebrow">ADMIN / CONNECTIONS</p>
              <h1>连接管理</h1>
              <p className="muted">先登录官方账号，再加入房间并接管设备。</p>
            </div>
            <button
              className="subtle admin-logout"
              disabled={busy === "admin/logout"}
              onClick={() =>
                command(
                  "admin/logout",
                  {},
                  "已退出管理，官方连接和协作邀请已关闭",
                )
              }
            >
              <LogOut size={16} />
              退出管理并断开
            </button>
          </div>
          <div className="admin-session">
            <span>
              <ShieldCheck size={15} />
              管理员已认证
            </span>
            <span>
              有效至{" "}
              {new Date(state.admin.expiresAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className={online ? "" : "error-text"}>
              {online ? "面板服务在线" : "连接中断，等待重连"}
            </span>
          </div>
          {error && (
            <div className="admin-message error" role="alert">
              <AlertCircle size={17} />
              {error}
            </div>
          )}
          {notice && (
            <div className="admin-message" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          {acquired ? (
            <section className="connection-ready">
              <div>
                <b>设备已就绪</b>
                <p>连接保持中，可以直接回到控制台。</p>
              </div>
              <button
                id="connection-ready"
                className="primary"
                disabled={!online}
                onClick={() =>
                  enterControl(state.devices.find((d) => d.connected)?.id)
                }
              >
                进入控制台 <ArrowUpRight size={17} />
              </button>
            </section>
          ) : (
            <p className="wizard-progress" role="status">
              第 {nextStep} / 3 步 ·{" "}
              {nextStep === 1
                ? "登录官方账号"
                : nextStep === 2
                  ? "加入远程房间"
                  : "选择要控制的设备"}
            </p>
          )}
          {state.demo && (
            <div className="admin-message demo-message">
              <Radio size={18} />
              <div>
                <b>当前正在体验演示</b>
                <p>退出演示后，即可登录官方账号并连接真实房间。</p>
              </div>
              <button
                disabled={disabled}
                onClick={() =>
                  command("demo", { enabled: false }, "已退出演示")
                }
              >
                退出演示
              </button>
            </div>
          )}
          <div className="admin-grid">
            <Step
              number={1}
              title="官方账号"
              summary={
                state.user && !state.demo
                  ? state.user.nickname
                  : "登录你的 DG-LAB 账号"
              }
              open={openStep === 1}
              done={!!state.user && !state.demo}
              available
              onToggle={() => toggleStep(1)}
            >
              {state.user ? (
                <div className="admin-account-summary">
                  <span className="admin-avatar">
                    <CircleUserRound size={32} />
                  </span>
                  <h3>{state.user.nickname}</h3>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      command("logout", {}, "已退出官方账号并关闭房间")
                    }
                  >
                    <LogOut size={15} />
                    退出官方账号
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await command(
                      "login",
                      accountMode === "token"
                        ? { token }
                        : {
                            [accountMode]: account,
                            password: officialPassword,
                            phoneCountryCode: "86",
                          },
                      "官方账号登录成功",
                    );
                    setOfficialPassword("");
                    setToken("");
                  }}
                >
                  <Field label="官方登录方式">
                    <select
                      disabled={disabled || state.demo}
                      value={accountMode}
                      onChange={(e) => {
                        setAccountMode(e.target.value);
                        setOfficialPassword("");
                        setToken("");
                        setAccount("");
                      }}
                    >
                      <option value="phone">手机号 + 密码（+86）</option>
                      <option value="email">邮箱 + 密码</option>
                      <option value="token">已有登录令牌</option>
                    </select>
                  </Field>
                  {accountMode === "token" ? (
                    <Field label="官方登录令牌">
                      <input
                        type="password"
                        autoComplete="off"
                        value={token}
                        required
                        disabled={disabled || state.demo}
                        onChange={(e) => setToken(e.target.value)}
                      />
                    </Field>
                  ) : (
                    <>
                      <Field
                        label={
                          accountMode === "phone" ? "官方手机号" : "官方邮箱"
                        }
                      >
                        <input
                          type={accountMode === "phone" ? "tel" : "email"}
                          inputMode={accountMode === "phone" ? "tel" : "email"}
                          autoComplete="username"
                          value={account}
                          required
                          disabled={disabled || state.demo}
                          onChange={(e) => setAccount(e.target.value)}
                        />
                      </Field>
                      <Field label="官方账号密码">
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={officialPassword}
                          required
                          disabled={disabled || state.demo}
                          onChange={(e) => setOfficialPassword(e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  <button
                    className="primary full"
                    disabled={disabled || state.demo}
                  >
                    {busy === "login" ? "正在登录官方账号…" : "登录官方账号"}
                    <ArrowUpRight size={16} />
                  </button>
                </form>
              )}
            </Step>
            <Step
              number={2}
              title="远程房间"
              summary={
                connected
                  ? `已加入 ${state.room?.code}`
                  : state.user
                    ? "粘贴房主发来的远程邀请"
                    : "登录官方账号后继续"
              }
              open={openStep === 2}
              done={connected}
              available={!!state.user && !state.demo}
              onToggle={() => toggleStep(2)}
            >
              {state.room && !state.demo ? (
                <div className="admin-room-summary">
                  <div className="admin-room-code">{state.room.code}</div>
                  <p className="muted">
                    {state.peer?.nickname || "房主"} ·{" "}
                    {connected
                      ? "房间已连接"
                      : state.status === "connecting"
                        ? "正在连接"
                        : "连接已断开"}
                  </p>
                  <dl>
                    <div>
                      <dt>可用设备</dt>
                      <dd>{state.devices.length} 台</dd>
                    </div>
                    <div>
                      <dt>连接状态</dt>
                      <dd>{connected ? "在线" : "待恢复"}</dd>
                    </div>
                  </dl>
                  <div className="lab-buttons">
                    <button
                      disabled={disabled || !connected}
                      onClick={() =>
                        command("room/refresh", {}, "设备列表已刷新")
                      }
                    >
                      <RefreshCw size={15} />
                      刷新设备列表
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() => command("room/leave", {}, "已退出房间")}
                    >
                      <LogOut size={15} />
                      退出房间
                    </button>
                  </div>
                  {!connected && (
                    <p className="hint">连接已断开，请退出后重新加入。</p>
                  )}
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await command(
                      "room/join",
                      { code, password: roomPassword },
                      "已加入房间，请接管下面的设备",
                    );
                    if (r) {
                      setCode("");
                      setRoomPassword("");
                    }
                  }}
                >
                  <Field label="远程码或邀请链接">
                    <input
                      placeholder="粘贴官方 App 的远程房间邀请"
                      autoComplete="off"
                      value={code}
                      required
                      disabled={disabled || !state.user || state.demo}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                  <Field label="房间密码（可选）">
                    <input
                      type="password"
                      autoComplete="off"
                      value={roomPassword}
                      disabled={disabled || !state.user || state.demo}
                      onChange={(e) => setRoomPassword(e.target.value)}
                    />
                  </Field>
                  <button
                    className="primary full"
                    disabled={
                      disabled || !state.user || state.demo || !code.trim()
                    }
                  >
                    {busy === "room/join" ? "正在加入房间…" : "加入房间"}
                    <ArrowUpRight size={16} />
                  </button>
                  <p className="hint">
                    {!state.user
                      ? "请先完成官方账号登录。"
                      : "房主需在官方 App 中开启远程房间，并连接 2.0 主机。"}
                  </p>
                </form>
              )}
            </Step>
            <Step
              number={3}
              title="设备接管"
              summary={
                acquired
                  ? `已接管 ${state.devices.filter((d) => d.connected).length} 台设备`
                  : connected
                    ? "选择设备，接管后直接进入控制台"
                    : "加入房间后继续"
              }
              open={openStep === 3}
              done={acquired}
              available={connected}
              onToggle={() => toggleStep(3)}
            >
              {!connected ? (
                <div className="admin-empty">
                  <Radio size={30} />
                  <b>加入房间后，设备会显示在这里</b>
                  <p>接管前不会发送控制指令。</p>
                </div>
              ) : !state.devices.length ? (
                <div className="admin-empty">
                  <b>房间已连接，暂未发现设备</b>
                  <p>请确认房主 App 已连接主机，再刷新设备列表。</p>
                  <button
                    disabled={disabled}
                    onClick={() => command("room/refresh", {})}
                  >
                    刷新设备
                  </button>
                </div>
              ) : (
                state.devices.map((d) => (
                  <div className="admin-device" key={d.id}>
                    <span className="device-symbol">
                      <Radio size={23} />
                    </span>
                    <div>
                      <b>{d.name || d.type}</b>
                      <small>
                        {d.type} ·{" "}
                        {d.connected ? "已接管 · 可进入控制台" : "尚未接管"}
                      </small>
                    </div>
                    <button
                      disabled={disabled || d.type !== "COYOTE_020"}
                      className={d.connected ? "" : "primary"}
                      onClick={async () => {
                        const result = await command(
                          `device/${d.connected ? "detach" : "attach"}`,
                          { id: d.id },
                          d.connected
                            ? "已释放设备"
                            : "已接管设备，可以开始控制",
                        );
                        if (result && !d.connected) enterControl(d.id);
                      }}
                    >
                      {d.type !== "COYOTE_020"
                        ? "暂不支持"
                        : d.connected
                          ? "释放控制"
                          : busy === "device/attach"
                            ? "正在接管…"
                            : "接管并进入控制台"}
                    </button>
                  </div>
                ))
              )}
            </Step>
          </div>
        </main>
      )}
    </div>
  );
}

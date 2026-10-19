import { ThemeSwitch } from "../Theme.jsx";
import React, { useEffect, useRef, useState } from "react";
import { Users, Copy, Link2, Play, Square, LogOut } from "lucide-react";
import { Field, Num, Wave } from "../App.jsx";
import { Slider } from "./common.jsx";
import { api } from "../api.js";

export function Invitation({ device, state, run, notify, role }) {
  const [minutes, setMinutes] = useState(30), [pending, setPending] = useState(false);
  const entry = state.cooperation?.find((i) => i.role === role && i.deviceId === device?.id);
  const url = entry?.token
    ? `${location.origin}/#invite=${entry.token}`
    : "";
  return (
    <div className="invite-box">
      <div className="section-heading">
        <h3>
          <Link2 size={15} /> 协作邀请
        </h3>
        <span className="small muted">
          {entry?.online
            ? "协作者在线"
            : entry?.claimed
              ? "协作者已离线"
              : entry
                ? "等待对方加入"
                : "尚未创建邀请"}
        </span>
      </div>
      <p className="hint">
        链接只授予
        {role === "choice"
          ? "场景选项"
          : role === "amplitude"
            ? "波形幅值"
            : "另一通道的波形"}
        控制权 · 限一人
      </p>
      <div className="play-settings">
        <Field label="有效分钟">
          <Num value={minutes} onChange={setMinutes} min={1} max={60} />
        </Field>
        <div className="lab-buttons">
          <button
            disabled={!device?.connected || pending}
            onClick={async () => {
              setPending(true);
              try { await run("coop/create", { id: device.id, role, minutes }); }
              finally { setPending(false); }
            }}
          >
            创建邀请链接
          </button>
          <button
            disabled={!state.cooperation?.length}
            onClick={async () => {
              await run("coop/revoke", {});
            }}
          >
            撤销邀请
          </button>
        </div>
      </div>
      {entry && (
        <div className="invite-url">
          <input
            aria-label="邀请链接"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                notify("邀请链接已复制");
              } catch {
                notify("请选中链接手动复制");
              }
            }}
          >
            <Copy size={15} /> 复制
          </button>
        </div>
      )}
      {entry && <p className="hint">有效至 {new Date(entry.expires).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</p>}
    </div>
  );
}
export function Coop({ device, state, lab, ready, run, notify }) {
  const [mode, setMode] = useState("split"),
    [period, setPeriod] = useState(40),
    [amplitude, setAmplitude] = useState(50),
    [bpm, setBpm] = useState(80),
    [swapSeconds, setSwapSeconds] = useState(0);
  const input = mode === "split" ? { period, bpm } : { period, amplitude };
  useEffect(() => {
    lab.patch.current = { input };
  }, [mode, period, amplitude, bpm]);
  const role = mode === "split" ? "amplitude" : "channelB",
    guest = state.cooperation?.find((i) => i.role === role);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          <Users size={18} /> 双人协作
        </h2>
        <span className="section-tag">DUET</span>
      </div>
      <Field label="合作方式">
        <select
          value={mode}
          onChange={(e) => {
            lab.stop();
            setMode(e.target.value);
          }}
        >
          <option value="split">我控制节奏，对方控制幅值</option>
          <option value="channels">各控制一轨，可定时交换</option>
        </select>
      </Field>
      <Invitation
        device={device}
        state={state}
        run={run}
        notify={notify}
        role={role}
      />
      <div className="play-settings">
        <Slider
          label="我的周期"
          value={period}
          onChange={setPeriod}
          min={10}
          max={100}
          unit="ms"
        />
        {mode === "split" ? (
          <Field label="我的 BPM">
            <Num value={bpm} onChange={setBpm} min={30} max={200} />
          </Field>
        ) : (
          <Slider
            label="我的波形幅值"
            value={amplitude}
            onChange={setAmplitude}
            unit="%"
          />
        )}
      </div>
      {mode === "channels" && (
        <Field label="自动交换 A/B">
          <select
            value={swapSeconds}
            onChange={(e) => setSwapSeconds(Number(e.target.value))}
          >
            <option value="0">不交换</option>
            {[10, 20, 30, 60, 120].map((n) => (
              <option key={n} value={n}>
                每 {n} 秒交换
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="lab-buttons">
        <button
          className="primary"
          disabled={!ready || lab.pending || !guest?.online}
          onClick={async () => {
            if (
              await lab.start({
                mode: "coop",
                label: "双人协作",
                coopMode: mode,
                swapSeconds,
                duration: 1800,
              })
            ) {
              lab.patch.current = { input };
            }
          }}
        >
          <Play size={15} /> 开始双人协作
        </button>
      </div>
      <p className="hint">双方在线后可开始；离线即停止。</p>
    </section>
  );
}
export function ChoiceButtons({ lab, choose }) {
  const w = lab?.waiting;
  if (!w) return null;
  return (
    <div className="branch-choice">
      <p className="eyebrow">WAITING FOR YOUR CHOICE</p>
      <h3>{w.title}</h3>
      <p className="hint">当前已静默，选择下一段后继续。</p>
      <div className="lab-buttons">
        {w.choices.map((c, i) => (
          <button
            className="primary"
            key={i}
            onClick={() =>
              choose({
                runId: lab.runId,
                epoch: lab.epoch,
                node: w.node,
                revision: w.revision,
                choice: i,
              })
            }
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
export default function Guest({ state, token, onExit, notify, online }) {
  const [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [amplitude, setAmplitude] = useState(0),
    [period, setPeriod] = useState(40);
  const guest = state.guest,
    current = useRef({}),
    sequence = useRef({ runId: null, seq: 0 });
  current.current = { guest, amplitude, period, online };
  useEffect(() => {
    if (!token || !state.csrf || guest) return;
    api("coop/inspect", { token })
      .then(setPreview)
      .catch((e) => setError(e.message));
  }, [token, state.csrf, !!guest]);
  useEffect(() => {
    let busy = false;
    const timer = setInterval(async () => {
      const c = current.current,
        g = c.guest;
      if (busy || !c.online || !g?.active || !g.ownerOnline || document.hidden)
        return;
      busy = true;
      try {
        if (!g.lab?.running || g.lab.mode !== "coop" || g.role === "choice")
          await api("coop/heartbeat", {});
        else {
          if (sequence.current.runId !== g.lab.runId)
            sequence.current = { runId: g.lab.runId, seq: 0 };
          await api("coop/input", {
            runId: g.lab.runId,
            epoch: g.lab.epoch,
            seq: ++sequence.current.seq,
            input:
              g.role === "amplitude"
                ? { amplitude: c.amplitude }
                : { amplitude: c.amplitude, period: c.period },
          });
        }
      } catch (e) {
        setError(e.message);
      } finally {
        busy = false;
      }
    }, 250);
    const stop = () => {
      const r = current.current.guest?.lab;
      if (r?.running)
        api("coop/stop", { runId: r.runId, epoch: r.epoch }).catch(() => {});
    };
    const hide = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  const action = async (path, body) => {
    try {
      await api(path, body);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="guest-shell">
      <div className="guest-theme">
        <ThemeSwitch />
      </div>
      <div className="brand">
        <Users size={27} />
        <span>
          DG-LAB<small>DUET / 协作终端</small>
        </span>
      </div>
      <section className="panel">
        <p className="eyebrow">SHARED RHYTHM</p>
        <h1>{guest ? "一起完成这一段节奏" : "有人邀请你一起协作"}</h1>
        {!guest ? (
          <>
            <p className="muted">
              {preview
                ? `你的权限：${{ amplitude: "波形幅值", channelB: "单轨波形控制", choice: "互动场景选择" }[preview.role]}`
                : "正在读取邀请…"}
            </p>
            {preview?.demo && (
              <p className="banner">这是本地演示，不连接真实设备。</p>
            )}
            <button
              className="primary"
              disabled={!preview || pending || preview.claimed}
              onClick={async () => {
                setPending(true);
                try {
                  await api("coop/join", { token });
                  history.replaceState(null, "", location.pathname);
                  setError("");
                } catch (e) {
                  setError(e.message);
                } finally {
                  setPending(false);
                }
              }}
            >
              {preview?.claimed ? "此邀请已被使用" : "加入协作"}
            </button>
          </>
        ) : !guest.active ? (
          <>
            <p className="muted">{guest.reason}</p>
            <button
              onClick={async () => {
                await action("coop/exit", {});
                onExit();
              }}
            >
              返回自己的面板
            </button>
          </>
        ) : (
          <>
            {guest.demo && (
              <div className="banner">演示协作 · 不连接真实设备</div>
            )}
            <div className="guest-status">
              <span
                className={`status-dot ${guest.ownerOnline && online ? "green" : ""}`}
              />
              {!online
                ? "连接中断"
                : guest.ownerOnline
                  ? "主面板在线"
                  : "主面板已离线"}
              <span>
                {guest.lab?.running ? "实验进行中" : "等待主面板开始"}
              </span>
            </div>
            {guest.role !== "choice" && (
              <>
                <Slider
                  label="我的波形幅值"
                  value={amplitude}
                  onChange={setAmplitude}
                  unit="%"
                />
                {guest.role === "channelB" && (
                  <>
                    <Slider
                      label="我的周期"
                      value={period}
                      onChange={setPeriod}
                      min={10}
                      max={100}
                      unit="ms"
                    />
                    <p className="hint">
                      当前控制通道 {guest.lab?.swap ? "A" : "B"}
                      ；主面板可以设置定时交换。
                    </p>
                  </>
                )}
                <div className="guest-wave">
                  <Wave frames={guest.lab?.frames || []} large />
                </div>
                <p className="hint">
                  这里调整的是波形幅值。通道基础强度由主面板设置。
                </p>
              </>
            )}
            <ChoiceButtons
              lab={guest.lab}
              choose={(body) => action("coop/choose", body)}
            />
            {guest.role === "choice" && !guest.lab?.waiting && (
              <p className="muted">场景到达选择点时，选项会出现在这里。</p>
            )}
            <div className="lab-buttons">
              <button
                className="danger"
                disabled={
                  !guest.lab?.running ||
                  (guest.role === "choice"
                    ? guest.lab.mode !== "scene"
                    : guest.lab.mode !== "coop")
                }
                onClick={() =>
                  action("coop/stop", {
                    runId: guest.lab.runId,
                    epoch: guest.lab.epoch,
                  })
                }
              >
                <Square size={15} /> 停止波形
              </button>
              <button
                onClick={async () => {
                  await action("coop/exit", {});
                  onExit();
                }}
              >
                <LogOut size={15} /> 退出协作
              </button>
            </div>
            <p className="hint">
              邀请到期时间：
              {new Date(guest.expires).toLocaleTimeString("zh-CN", {
                hour12: false,
              })}
            </p>
          </>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}

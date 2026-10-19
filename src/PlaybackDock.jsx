import React, { useEffect, useRef, useState } from "react";
import { Activity, Expand, Radio, Repeat2, Square, X } from "lucide-react";
import { ThemeSwitch } from "./Theme.jsx";
import { feedbackPhrases } from "../shared/feedback.mjs";
import { playbackPhase } from "./PlaybackTiming.jsx";
import { channelView } from "./scope-display.mjs";

const number = (v) =>
  Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "—";
const percent = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
const bool = (v, yes = "开启", no = "关闭") =>
  typeof v === "boolean" ? (v ? yes : no) : "—";
const time = (v) =>
  v ? new Date(v).toLocaleTimeString("zh-CN", { hour12: false }) : "尚未回传";
const elapsed = (ms) =>
  `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;

// Scroll sample timestamps smoothly; do not fabricate sine waves or extrapolate
// amplitudes. A short display buffer interpolates position between 10 Hz samples.
export function ScopeCanvas({
  lanes,
  online,
  channel,
  mini = false,
  enabled = true,
}) {
  const canvas = useRef(),
    latest = useRef({});
  const previous = latest.current;
  latest.current = {
    lanes: lanes.map((lane, c) => ({
      ...lane,
      received: previous.lanes?.[c]?.serverTime === lane.serverTime
        ? previous.lanes[c].received : performance.now(),
    })),
    online,
  };
  useEffect(() => {
    if (!enabled) return;
    const node = canvas.current,
      ctx = node.getContext("2d");
    let raf,
      width = 1,
      height = 1,
      colors,
      lastDraw = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const palette = () => {
      const css = getComputedStyle(node);
      colors = ["--scope-a", "--scope-b", "--scope-grid", "--scope-glow"].map(
        (k) => css.getPropertyValue(k).trim(),
      );
    };
    const resize = () => {
      const rect = node.getBoundingClientRect(),
        scale = Math.min(2, devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      node.width = Math.max(1, Math.round(width * scale));
      node.height = Math.max(1, Math.round(height * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      palette();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    const theme = new MutationObserver(palette);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    resize();
    const draw = (stamp) => {
      raf = requestAnimationFrame(draw);
      if (
        document.hidden ||
        !width ||
        (reduce.matches && stamp - lastDraw < 200)
      )
        return;
      lastDraw = stamp;
      const current = latest.current;
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors[2];
      ctx.beginPath();
      for (let x = 0; x < width; x += mini ? 28 : 48) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += mini ? height / 2 : 24) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
      const channels = channel === undefined ? [0, 1] : [channel];
      channels.forEach((c, index) => {
        const view = current.lanes[c], samples = view.trace?.samples || [];
        const now = (view.serverTime || Date.now()) +
          (current.online && !view.paused ? Math.min(500, performance.now() - view.received) : 0) - 200;
        const lane = height / channels.length,
          base = lane * (index + 1) - (mini ? 3 : 12),
          amplitude = lane - (mini ? 7 : 28);
        const xAt = (t) => ((t - now + 8000) / 8000) * width;
        const yAt = (z) => base - (z / 20) * amplitude;
        ctx.beginPath();
        ctx.strokeStyle = colors[c];
        ctx.globalAlpha = 0.18;
        ctx.moveTo(0, base);
        ctx.lineTo(width, base);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, lane * index, width, lane);
        ctx.clip();
        ctx.beginPath();
        let last = null,
          end;
        for (const sample of samples) {
          const x = xAt(sample[0]),
            y = yAt(sample[c === 0 ? 3 : 6]);
          if (last && sample[0] - last[0] <= 350) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          if (x <= width) end = [x, y];
          else if (last && xAt(last[0]) < width && sample[0] - last[0] <= 350) {
            const px = xAt(last[0]),
              py = yAt(last[c === 0 ? 3 : 6]);
            end = [width, py + ((y - py) * (width - px)) / (x - px)];
          }
          last = sample;
        }
        ctx.lineWidth = mini ? 1.5 : 2;
        ctx.lineJoin = "round";
        ctx.strokeStyle = colors[c];
        ctx.shadowColor = colors[c];
        ctx.shadowBlur = reduce.matches ? 0 : Number(colors[3]) || 0;
        ctx.stroke();
        if (end && current.online && !view.paused && now - (samples.at(-1)?.[0] || 0) < 600) {
          ctx.beginPath();
          ctx.arc(Math.max(0, end[0]), end[1], mini ? 1.6 : 3, 0, Math.PI * 2);
          ctx.fillStyle = colors[c];
          ctx.fill();
        }
        ctx.restore();
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      theme.disconnect();
    };
  }, [channel, mini, enabled]);
  return (
    <canvas
      ref={canvas}
      className={`scope-canvas ${mini ? "mini" : ""}`}
      role="img"
      aria-label={`${channel === undefined ? "A/B 双通道" : channel === 0 ? "A 通道" : "B 通道"}发送波形幅值，最近 8 秒，非电流实测`}
    />
  );
}

function jobFor(state, id, channel) {
  const lab = state.lab;
  if (lab?.running && lab.deviceId === id && lab.channels?.includes(channel))
    return lab;
  return state.players.find((p) => p.deviceId === id && p.channel === channel);
}
function channelStatus(device, channel, online, connected) {
  const cs = device?.slotState?.[channel ? "channelB" : "channelA"];
  if (!online) return "连接中断 · 显示最后状态";
  if (!connected || !device?.connected) return "未接管";
  if (
    device.slotState?.hasDevice === false ||
    device.props?.connectState === "disconnected"
  )
    return "设备离线";
  if (cs?.isMuted === true) return "设备已暂停";
  if (cs?.isMuted === undefined) return "等待状态回传";
  return "设备未暂停";
}
function FeedbackDetails({ device, online }) {
  return (
    <details className="scope-feedback">
      <summary>
        <Radio size={17} /> 设备详情
      </summary>
      <div className="scope-section-heading">
        <span>{online ? "主机回传" : "最后已知值"}</span>
      </div>
      <div className="scope-device-summary">
        <span>
          设备在线 <b>{bool(device?.slotState?.hasDevice, "是", "否")}</b>
        </span>
        <span>
          标记灯{" "}
          <b>
            {{
              yellow: "黄色",
              red: "红色",
              blue: "蓝色",
              green: "绿色",
              purple: "紫色",
            }[device?.slotState?.markLight] ||
              device?.slotState?.markLight ||
              "—"}
          </b>
        </span>
        <span>
          强度最后变更 <b>{time(device?.propsUpdatedAt)}</b>
        </span>
        <span>
          状态最后变更 <b>{time(device?.slotUpdatedAt)}</b>
        </span>
      </div>
      <div className="feedback-channels">
        {[0, 1].map((c) => {
          const name = c ? "B" : "A",
            cs = device?.slotState?.[`channel${name}`] || {},
            comfort = cs.comfortLimit || {};
          const rows = [
            ["回传强度", number(device?.props?.[`intensity${name}`])],
            ["输出暂停", bool(cs.isMuted, "已暂停", "未暂停")],
            ["设备有效上限", number(cs.intensityMax)],
            ["舒适上限", number(comfort.comfortMax)],
            ["绝对上限", number(comfort.absoluteMax)],
            ["预热比例", percent(cs.warmUpScale)],
            ["过热限制", bool(comfort.overheat, "限制中", "未触发")],
            [
              "热量积累",
              Number.isFinite(comfort.overheatPercent)
                ? `${number(comfort.overheatPercent)}%`
                : "—",
            ],
            ["自动增强", bool(comfort.autoIncr)],
            ["自动增强上限", number(comfort.autoIncrMax)],
            [
              "自动增强范围",
              { 0: "未选择", 1: "舒适上限", 2: "绝对上限", 3: "两种上限" }[
                comfort.autoIncrScope
              ] || "—",
            ],
            ["累计增强", number(comfort.totalIncr)],
            [
              "限制模式",
              { complex: "综合限制", simple: "简单限制" }[comfort.mode] ||
                comfort.mode ||
                "—",
            ],
          ];
          return (
            <div
              className={`feedback-channel channel-${name.toLowerCase()}`}
              key={name}
            >
              <h4>CHANNEL {name}</h4>
              <dl>
                {rows.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      <div className="scope-reply">
        <b>最近快捷反馈</b>
        <span>
          {device?.feedback
            ? `${time(device.feedback.time)} · ${feedbackPhrases[device.feedback.feel] || `反馈编号 ${number(device.feedback.feel)}`}`
            : "尚未收到房主反馈"}
        </span>
      </div>
    </details>
  );
}

export default function PlaybackDock({ state, device, online, run, stop }) {
  const dialog = useRef(),
    trigger = useRef();
  const [open, setOpen] = useState(false),
    [inspectId, setInspectId] = useState(null);
  const inspected = state.devices.find((d) => d.id === inspectId) || device;
  const traceFor = (id) => state.scope?.find((s) => s.deviceId === id);
  const savedViews = useRef(new Map());
  const views = new Map(state.devices.map(d => {
    const key = `${d.id}:${d.slotId || ""}`;
    const previous = savedViews.current.get(key);
    return [key, [0, 1].map(c => channelView(previous?.[c], {
      paused: d.slotState?.[c ? "channelB" : "channelA"]?.isMuted === true,
      trace: traceFor(d.id), job: jobFor(state, d.id, c), serverTime: state.serverTime,
    }))];
  }));
  savedViews.current = views;
  const viewsFor = d => views.get(`${d?.id}:${d?.slotId || ""}`) || [{}, {}];
  const deviceViews = viewsFor(device);
  const connected = state.status === "connected";
  const jobs = [0, 1].map((c) => jobFor(state, device?.id, c));
  const label =
    [...new Set(jobs.filter(Boolean).map((j) => j.label))].join(" / ") ||
    "等待播放";
  const active = jobs.some(Boolean),
    autonomous = jobs.some((j) => j?.autonomous),
    loop = jobs.some((j) => j?.loop);
  const close = () => {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  };
  const show = () => {
    setInspectId(device?.id);
    setOpen(true);
    dialog.current.showModal();
  };
  const stopWaves = async () => {
    if (state.lab?.running && state.lab.deviceId === inspected?.id)
      await run("lab/stop", { runId: state.lab.runId, epoch: state.lab.epoch });
    for (const p of state.players.filter((p) => p.deviceId === inspected?.id))
      await run("player/stop", { id: p.deviceId, channel: p.channel });
  };
  return (
    <>
      <section className="control-dock scope-dock" aria-label="全局停止">
        <button
          className="scope-trigger"
          onClick={show}
          ref={trigger}
          aria-label="打开发送波形示波器与设备反馈"
        >
          <div className="scope-mini-screen">
            <ScopeCanvas
              lanes={deviceViews}
              online={online && connected}
              mini
            />
            <span className="scope-mini-letters">
              A<br />B
            </span>
          </div>
          <div className="scope-mini-text">
            <b>
              <span className="scope-mini-a">
                A {deviceViews[0].paused ? "暂停" : number(device?.props?.intensityA)}
              </span>
              <span className="scope-mini-b">
                B {deviceViews[1].paused ? "暂停" : number(device?.props?.intensityB)}
              </span>
              <Expand size={12} />
            </b>
            <span className="scope-mini-job">
              {!online
                ? "连接中断 · 状态待同步"
                : deviceViews.every(v => v.paused) ? "双通道已暂停" : jobs
                    .map((j, c) => deviceViews[c].paused ? null : playbackPhase(j, state.serverTime))
                    .find(Boolean) || `${loop ? "↻ " : ""}${label}`}
            </span>
            <small>
              {deviceViews.every(v => v.paused) ? "显示已暂停" : autonomous ? "后台播放" : active ? "实时输入" : "发送波形"} · 8
              秒轨迹
            </small>
          </div>
        </button>
        <button
          className="danger"
          onClick={stop}
          disabled={!online || !state.devices.some((d) => d.connected)}
        >
          <Square size={16} fill="currentColor" /> 停止并归零
        </button>
      </section>
      <dialog
        className="scope-dialog"
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) {
            const b = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < b.left ||
              e.clientX > b.right ||
              e.clientY < b.top ||
              e.clientY > b.bottom
            )
              close();
          }
        }}
        aria-labelledby="scope-title"
      >
        <header className="scope-dialog-header">
          <div>
            <p className="scope-kicker">PULSE DECK / SIGNAL ROOM</p>
            <h2 id="scope-title">
              <Activity /> 实时示波器
            </h2>
          </div>
          <div className="scope-header-buttons">
            <ThemeSwitch />
            <button aria-label="关闭示波器" onClick={close}>
              <X size={21} />
            </button>
          </div>
        </header>
        <div className="scope-dialog-body">
          <div className="scope-description">
            <div>
              <b>本面板发送波形</b>
              <p>最近 8 秒 · 幅值 / 周期</p>
            </div>
            {state.devices.length > 1 ? (
              <select
                aria-label="查看设备反馈"
                value={inspected?.id}
                onChange={(e) => setInspectId(Number(e.target.value))}
              >
                {state.devices.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name || d.type} / {d.id}
                  </option>
                ))}
              </select>
            ) : (
              <span>{inspected?.name || "等待设备"}</span>
            )}
          </div>
          {!online && (
            <p className="scope-offline" role="status">
              连接中断 · 显示最后状态，后台播放可能仍在继续。
            </p>
          )}
          <div className="scope-channels">
            {[0, 1].map((c) => {
              const name = c ? "B" : "A",
                view = viewsFor(inspected)[c],
                f = view.trace?.frames?.[c],
                job = view.job;
              const known =
                online &&
                connected &&
                inspected?.connected &&
                inspected?.slotState?.hasDevice !== false;
              const status = channelStatus(inspected, c, online, connected),
                age = view.age || 0;
              return (
                <section
                  className={`scope-channel channel-${name.toLowerCase()}`}
                  key={name}
                >
                  <div className="scope-channel-heading">
                    <div>
                      <span className="scope-channel-letter">{name}</span>
                      <div>
                        <b>{job?.label || "未播放波形"}</b>
                        <span>
                          {view.paused ? status : playbackPhase(job, state.serverTime) || status}
                        </span>
                      </div>
                    </div>
                    <div className="scope-strength">
                      <strong>
                        {number(inspected?.props?.[`intensity${name}`])}
                      </strong>
                      <span>
                        强度 / 上限{" "}
                        {number(
                          inspected?.slotState?.[`channel${name}`]
                            ?.intensityMax,
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="scope-screen">
                    <div className="scope-axis">
                      <span>100%</span>
                      <span>0%</span>
                    </div>
                    <ScopeCanvas
                      lanes={viewsFor(inspected)}
                      online={online && connected}
                      channel={c}
                      enabled={open}
                    />
                  </div>
                  <div className="scope-measures">
                    <span>
                      {view.paused ? "暂停时幅值" : "发送幅值"} <b>{known ? `${(f?.[2] || 0) * 5}%` : "—"}</b>
                    </span>
                    <span>
                      周期 <b>{known && f?.[2] ? `${f[0] + f[1]} ms` : "—"}</b>
                    </span>
                    <span>
                      {view.paused ? "显示已暂停" : job
                        ? job.waiting
                          ? "等待选择 · 静默"
                          : job.autonomous
                            ? "服务器播放"
                            : "前台实时输入"
                        : "待机"}
                    </span>
                  </div>
                  {job && (
                    <div className="scope-play-progress">
                      <div>
                        <span>
                          {job.loop ? (
                            <Repeat2 size={13} />
                          ) : (
                            <Activity size={13} />
                          )}
                          {view.paused ? "已暂停" : job.queueLength
                            ? `第 ${job.index + 1} / ${job.queueLength} 段`
                            : job.loop
                              ? "片段循环"
                              : "正在运行"}
                        </span>
                        <span>
                          {elapsed(age)} / {elapsed(job.duration * 1000)}
                        </span>
                      </div>
                      <progress
                        max={job.duration * 1000}
                        value={Math.max(0, age)}
                      />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          {state.lab?.waiting && state.lab.deviceId === inspected?.id && (
            <section className="scope-scene-choice">
              <h3>{state.lab.waiting.title}</h3>
              <div>
                {state.lab.waiting.choices.map((choice, i) => (
                  <button
                    key={i}
                    disabled={!online}
                    onClick={() =>
                      run("lab/choose", {
                        runId: state.lab.runId,
                        epoch: state.lab.epoch,
                        node: state.lab.waiting.node,
                        revision: state.lab.waiting.revision,
                        choice: i,
                      })
                    }
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <FeedbackDetails device={inspected} online={online && connected} />
        </div>
        <footer className="scope-dialog-footer">
          <span>
            {state.demo ? "本地模拟设备" : "房间连接"} ·{" "}
            {state.status === "connected" ? "已连接" : "未连接"}
          </span>
          <button
            onClick={stopWaves}
            disabled={
              !online || ![0, 1].some((c) => jobFor(state, inspected?.id, c))
            }
          >
            停止当前设备波形
          </button>
          <button
            className="danger"
            onClick={stop}
            disabled={!online || !state.devices.some((d) => d.connected)}
          >
            <Square size={15} fill="currentColor" /> 全部停止并归零
          </button>
        </footer>
      </dialog>
    </>
  );
}

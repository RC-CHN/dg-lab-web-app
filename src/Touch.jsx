import React, { useEffect, useRef, useState } from "react";
import { Fingerprint, Flame, Grid2X2, Move, RotateCcw } from "lucide-react";
import { api } from "./api.js";
import { Field, Num, clamp } from "./App.jsx";
import { defaultAxes } from "../shared/touch-v2.mjs";

// One serial request stream per held gesture; releasing always follows the
// final active request. No queued positions can re-activate a released finger.
function gesture(path, base, error) {
  let latest = null,
    running = false,
    released = false;
  const drain = async () => {
    if (running) return;
    running = true;
    while (latest) {
      const body = latest;
      latest = null;
      try {
        await api(path, { ...base, ...body });
      } catch (e) {
        latest = null;
        released = true;
        error(e.message);
        break;
      }
    }
    running = false;
  };
  return {
    update(body) {
      if (!released) {
        latest = { ...body, active: true };
        drain();
      }
    },
    release() {
      if (!released) {
        released = true;
        latest = { active: false };
        drain();
      }
    },
  };
}
export default function Touch({ ready, device, state, presets, notify }) {
  const [mode, setMode] = useState("free"),
    [channelMode, setChannelMode] = useState("separate"),
    [size, setSize] = useState(4),
    [swap, setSwap] = useState(false),
    [intensityMode, setIntensityMode] = useState("classic"),
    [gradientMode, setGradientMode] = useState("both");
  const [axes, setAxes] = useState(structuredClone(defaultAxes)),
    [pointers, setPointers] = useState([]),
    [fireValue, setFireValue] = useState(1),
    [fireSync, setFireSync] = useState(false),
    [firing, setFiring] = useState([]),
    [cells, setCells] = useState([]);
  const pad = useRef(),
    held = useRef(new Map()),
    fires = useRef(new Map()),
    alternate = useRef(1),
    current = useRef({});
  current.current = {
    ready,
    device,
    state,
    mode,
    channelMode,
    size,
    swap,
    intensityMode,
    gradientMode,
    axes,
    fireValue,
    fireSync,
    cells,
    presets,
  };
  const fail = (message) => notify(message, true);
  const sync = () =>
    setPointers(
      [...held.current.values()].map((h) => ({
        x: h.x,
        y: h.y,
        channels: h.channels,
      })),
    );
  const stopTouches = () => {
    for (const h of held.current.values())
      for (const g of h.gestures) g.release();
    held.current.clear();
    sync();
  };
  const stopFires = () => {
    for (const f of fires.current.values())
      for (const g of f.gestures) g.release();
    fires.current.clear();
    setFiring([]);
  };
  const stop = () => {
    stopTouches();
    stopFires();
  };
  const update = (h) => {
    const c = current.current;
    let body = {
      x: h.x,
      y: h.y,
      swapAxes: c.swap,
      intensity: c.axes.intensity,
      frequency: c.axes.frequency,
      mode: c.intensityMode,
      gradientMode: c.gradientMode,
    };
    if (c.mode === "rhythm") {
      const index =
        Math.min(c.size - 1, Math.floor(h.y * c.size)) * c.size +
        Math.min(c.size - 1, Math.floor(h.x * c.size));
      const presetId =
        c.cells[index] || c.presets[index % c.presets.length]?.id;
      if (!presetId) return;
      body = { presetId };
    }
    h.gestures.forEach((g) => g.update(body));
  };
  useEffect(() => {
    const timer = setInterval(() => {
      held.current.forEach(update);
      fires.current.forEach((f) =>
        f.gestures.forEach((g) => g.update({ value: f.value })),
      );
    }, 125);
    const blur = () => stop(),
      visibility = () => {
        if (document.hidden) stop();
      };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", blur);
    return () => {
      clearInterval(timer);
      stop();
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", blur);
    };
  }, []);
  useEffect(() => {
    stop();
  }, [ready, device?.id, state.controlEpoch, mode, channelMode, size]);
  const position = (e) => {
    const r = pad.current.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  };
  const down = (e) => {
    if (!ready || (e.pointerType === "mouse" && e.button !== 0)) return;
    const assigned = [...held.current.values()].flatMap((h) => h.channels);
    let channels;
    if (channelMode === "separate") {
      const c = [0, 1].find((c) => !assigned.includes(c));
      if (c === undefined) return;
      channels = [c];
    } else {
      if (assigned.length) return;
      channels =
        channelMode === "sync"
          ? [0, 1]
          : channelMode === "alternate"
            ? [(alternate.current = 1 - alternate.current)]
            : [channelMode === "channelA" ? 0 : 1];
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = {
      ...position(e),
      channels,
      gestures: channels.map((channel) =>
        gesture(
          "touch",
          { id: device.id, channel, epoch: state.controlEpoch },
          fail,
        ),
      ),
    };
    held.current.set(e.pointerId, h);
    update(h);
    sync();
  };
  const move = (e) => {
    const h = held.current.get(e.pointerId);
    if (h) {
      Object.assign(h, position(e));
      sync();
    }
  };
  const up = (e) => {
    const h = held.current.get(e.pointerId);
    if (h) {
      h.gestures.forEach((g) => g.release());
      held.current.delete(e.pointerId);
      sync();
    }
  };
  const fireStart = (key, channel, value = fireValue) => {
    if (!ready || fires.current.has(key)) return;
    const channels = fireSync ? [0, 1] : [channel];
    if (
      [...fires.current.values()].some((f) =>
        f.channels.some((c) => channels.includes(c)),
      )
    )
      return;
    const f = {
      value,
      channels,
      gestures: channels.map((channel) =>
        gesture(
          "fire",
          { id: device.id, channel, epoch: state.controlEpoch },
          fail,
        ),
      ),
    };
    fires.current.set(key, f);
    f.gestures.forEach((g) => g.update({ value }));
    setFiring([...fires.current.values()].flatMap((f) => f.channels));
  };
  const fireEnd = (key) => {
    const f = fires.current.get(key);
    if (f) {
      f.gestures.forEach((g) => g.release());
      fires.current.delete(key);
      setFiring([...fires.current.values()].flatMap((f) => f.channels));
    }
  };
  return (
    <>
      <section className="panel touch-panel">
        <div className="section-heading">
          <h2>
            <Fingerprint size={19} /> 触控模式
          </h2>
          <span className="section-tag">官方逻辑</span>
        </div>
        <div className="touch-settings">
          <div className="segmented">
            <button
              className={mode === "free" ? "active" : ""}
              onClick={() => setMode("free")}
            >
              <Move size={15} /> 自由触控
            </button>
            <button
              className={mode === "rhythm" ? "active" : ""}
              onClick={() => setMode("rhythm")}
            >
              <Grid2X2 size={15} /> 节奏触控
            </button>
          </div>
          <select
            aria-label="触控通道模式"
            value={channelMode}
            onChange={(e) => setChannelMode(e.target.value)}
          >
            <option value="separate">双指分控 A / B</option>
            <option value="sync">A / B 同步</option>
            <option value="alternate">每次交替 A / B</option>
            <option value="channelA">仅通道 A</option>
            <option value="channelB">仅通道 B</option>
          </select>
        </div>
        <div
          ref={pad}
          className={`touchpad ${mode} ${!ready ? "disabled" : ""}`}
          aria-label="触控区域"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onContextMenu={(e) => e.preventDefault()}
        >
          {mode === "free" ? (
            <>
              <div className="pad-grid" />
              <span className="pad-top">
                {swap ? "波形幅值" : "周期"} · {swap ? "0–100%" : "10–100ms"}
              </span>
              <div className="pad-center">
                <Fingerprint size={48} />
                <strong>
                  {ready ? "按住 · 滑动 · 探索" : "接管设备后开始触控"}
                </strong>
                <span>
                  {intensityMode === "classic" ? "边缘轻，中间强" : "按住渐变"}
                </span>
              </div>
              <span className="pad-bottom">{swap ? "周期" : "波形幅值"} →</span>
            </>
          ) : (
            <div
              className="rhythm-grid"
              style={{ gridTemplateColumns: `repeat(${size},1fr)` }}
            >
              {Array.from({ length: size * size }, (_, i) => {
                const p =
                  presets.find((p) => p.id === cells[i]) ||
                  presets[i % presets.length];
                return (
                  <div key={i}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <b>{p?.name || "…"}</b>
                  </div>
                );
              })}
            </div>
          )}
          {pointers.map((p, i) => (
            <span
              key={i}
              className={`touch-cursor ${p.channels[0] === 1 ? "mint" : ""}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              {p.channels.map((c) => (c === 0 ? "A" : "B")).join("+")}
            </span>
          ))}
        </div>
        <p className="hint">松手后继续原波形</p>
        {mode === "rhythm" ? (
          <details>
            <summary>
              设置节奏格 <Grid2X2 size={15} />
            </summary>
            <Field label="布局">
              <select
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} × {n}
                  </option>
                ))}
              </select>
            </Field>
            <div className="rhythm-config">
              {Array.from({ length: size * size }, (_, i) => (
                <Field key={i} label={`格 ${i + 1}`}>
                  <select
                    value={cells[i] || presets[i % presets.length]?.id || ""}
                    onChange={(e) =>
                      setCells((c) => {
                        const n = [...c];
                        n[i] = e.target.value;
                        return n;
                      })
                    }
                  >
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </details>
        ) : (
          <details>
            <summary>
              轴映射与渐变 <Move size={15} />
            </summary>
            <div className="inline-fields">
              <Field label="幅值模式">
                <select
                  value={intensityMode}
                  onChange={(e) => setIntensityMode(e.target.value)}
                >
                  <option value="classic">经典映射</option>
                  <option value="gradient">渐变循环</option>
                </select>
              </Field>
              {intensityMode === "gradient" && (
                <Field label="渐变区">
                  <select
                    value={gradientMode}
                    onChange={(e) => setGradientMode(e.target.value)}
                  >
                    <option value="both">左右双区</option>
                    <option value="left">左侧递减</option>
                    <option value="right">右侧递增</option>
                  </select>
                </Field>
              )}
              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={swap}
                  onChange={(e) => setSwap(e.target.checked)}
                />{" "}
                交换 X / Y
              </label>
            </div>
            <div className="axis-editors">
              {["intensity", "frequency"].map((key) => (
                <div key={key}>
                  <h4>{key === "intensity" ? "波形幅值 / %" : "周期 / ms"}</h4>
                  {axes[key].map((p, i) => (
                    <div className="axis-row" key={i}>
                      <span>位置</span>
                      <input
                        aria-label={`${key}节点${i + 1}位置`}
                        type="number"
                        min={0}
                        max={1}
                        step="0.01"
                        disabled={i === 0 || i === axes[key].length - 1}
                        value={p.position}
                        onChange={(e) =>
                          setAxes((a) => ({
                            ...a,
                            [key]: a[key].map((p, j) =>
                              i === j
                                ? { ...p, position: Number(e.target.value) }
                                : p,
                            ),
                          }))
                        }
                      />
                      <span>值</span>
                      <Num
                        aria-label={`${key}节点${i + 1}值`}
                        value={p.value}
                        min={key === "frequency" ? 10 : 0}
                        max={100}
                        onChange={(value) =>
                          setAxes((a) => ({
                            ...a,
                            [key]: a[key].map((p, j) =>
                              i === j ? { ...p, value } : p,
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <button onClick={() => setAxes(structuredClone(defaultAxes))}>
              <RotateCcw size={14} /> 恢复官方轴映射
            </button>
          </details>
        )}
      </section>
      <section className="panel fire-panel">
        <div className="section-heading">
          <h2>
            <Flame size={19} /> 一键开火
          </h2>
          <label className="switch-label">
            <input
              type="checkbox"
              checked={fireSync}
              onChange={(e) => {
                stopFires();
                setFireSync(e.target.checked);
              }}
            />{" "}
            A / B 同步
          </label>
        </div>
        <p className="muted small">按住增强，松手恢复</p>
        <div className="fire-controls">
          <Field label="开火增量 · 1–30">
            <Num value={fireValue} min={1} max={30} onChange={setFireValue} />
          </Field>
          {[0, 1].map((c) => (
            <button
              key={c}
              className={`fire-button ${c === 1 ? "mint" : ""} ${firing.includes(c) ? "firing" : ""}`}
              disabled={!ready || (fireSync && c === 1)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                fireStart(`p${e.pointerId}`, c);
              }}
              onPointerUp={(e) => fireEnd(`p${e.pointerId}`)}
              onPointerCancel={(e) => fireEnd(`p${e.pointerId}`)}
              onLostPointerCapture={(e) => fireEnd(`p${e.pointerId}`)}
              onPointerLeave={(e) => fireEnd(`p${e.pointerId}`)}
              onKeyDown={(e) => {
                if ([" ", "Enter"].includes(e.key)) {
                  e.preventDefault();
                  if (!e.repeat) fireStart(`k${c}`, c);
                }
              }}
              onKeyUp={(e) => {
                if ([" ", "Enter"].includes(e.key)) {
                  e.preventDefault();
                  fireEnd(`k${c}`);
                }
              }}
              onBlur={() => stopFires()}
            >
              <Flame size={25} />
              <strong>+{fireValue}</strong>
              <span>
                {fireSync && c === 0 ? "A + B" : c === 0 ? "通道 A" : "通道 B"}{" "}
                · {firing.includes(c) ? "开火中" : "按住开火"}
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

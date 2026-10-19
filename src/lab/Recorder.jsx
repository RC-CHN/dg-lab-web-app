import React, { useEffect, useRef, useState } from "react";
import { Circle, Square, Fingerprint } from "lucide-react";
import { Field, Num } from "../App.jsx";
import { touchFrame } from "../../shared/touch-v2.mjs";
import { ZERO, transformTrack } from "../../shared/lab.mjs";
import { ClipActions, zeroTrack } from "./common.jsx";

export default function Recorder({ lab, ready, save, play, active }) {
  const [tracks, setTracks] = useState([zeroTrack(10), zeroTrack(10)]),
    [recording, setRecording] = useState(false),
    [target, setTarget] = useState(0),
    [overdub, setOverdub] = useState(false),
    [monitor, setMonitor] = useState(false),
    [seconds, setSeconds] = useState(0),
    [cursor, setCursor] = useState(null),
    [speed, setSpeed] = useState(1),
    [reverse, setReverse] = useState(false),
    [name, setName] = useState("触控录音");
  const hold = useRef(null),
    capture = useRef(null),
    pad = useRef(),
    current = useRef({});
  current.current = { target, tracks, overdub, monitor };
  const end = () => {
    const r = capture.current;
    if (!r) return;
    capture.current = null;
    clearInterval(r.timer);
    hold.current = null;
    setCursor(null);
    setRecording(false);
    if (r.runId && lab.live.current?.runId === r.runId) lab.stop();
    if (r.frames.length) {
      const length = Math.max(r.frames.length, r.other.length);
      const output = [zeroTrack(length), zeroTrack(length)];
      output[r.target] = r.frames.concat(zeroTrack(length - r.frames.length));
      output[1 - r.target] = r.overdub
        ? Array.from({ length }, (_, i) => r.other[i % r.other.length])
        : zeroTrack(length);
      setTracks(output);
    }
  };
  const begin = async () => {
    const monitoredRun = monitor
      ? await lab.start({
          mode: "stream",
          label: "触控录制监听",
          duration: 600,
        })
      : null;
    if (monitor && !monitoredRun) return;
    const r = {
      target,
      runId: monitoredRun?.runId,
      overdub,
      other: tracks[1 - target],
      frames: [],
      timer: null,
    };
    capture.current = r;
    setRecording(true);
    setSeconds(0);
    r.timer = setInterval(() => {
      if (capture.current !== r) return;
      if (r.runId && lab.live.current?.runId !== r.runId) {
        end();
        return;
      }
      const f = hold.current ? touchFrame(hold.current) : [...ZERO];
      r.frames.push(f);
      setSeconds(r.frames.length / 10);
      if (current.current.monitor) {
        const pair = [[...ZERO], [...ZERO]];
        pair[r.target] = f;
        pair[1 - r.target] = r.overdub
          ? r.other[(r.frames.length - 1) % r.other.length]
          : [...ZERO];
        lab.patch.current = { frames: pair };
      }
      if (r.frames.length >= 6000) end();
    }, 100);
  };
  useEffect(() => {
    if (!active) end();
  }, [active]);
  useEffect(() => {
    const blur = () => end();
    window.addEventListener("blur", blur);
    return () => {
      end();
      window.removeEventListener("blur", blur);
    };
  }, []);
  const point = (e) => {
    const r = pad.current.getBoundingClientRect();
    const p = {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
    hold.current = p;
    setCursor(p);
  };
  const transformed = tracks.map((t) => transformTrack(t, { speed, reverse }));
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>触控录制与叠录</h2>
        <span className={`record-clock ${recording ? "active" : ""}`}>
          {seconds.toFixed(1)}s / 600s
        </span>
      </div>
      <p className="hint">先录 A，再切换 B 叠录。</p>
      <div className="play-settings">
        <Field label="录制轨道">
          <select
            disabled={recording}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          >
            <option value="0">通道 A</option>
            <option value="1">通道 B</option>
          </select>
        </Field>
        <label className="switch-label">
          <input
            type="checkbox"
            disabled={recording}
            checked={overdub}
            onChange={(e) => setOverdub(e.target.checked)}
          />{" "}
          循环保留另一轨
        </label>
        <label className="switch-label">
          <input
            type="checkbox"
            disabled={recording || !ready}
            checked={monitor}
            onChange={(e) => setMonitor(e.target.checked)}
          />{" "}
          录制时输出监听
        </label>
      </div>
      <div
        ref={pad}
        className="touchpad record-pad"
        onPointerDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          point(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e);
        }}
        onPointerUp={() => {
          hold.current = null;
          setCursor(null);
        }}
        onPointerCancel={() => {
          hold.current = null;
          setCursor(null);
        }}
        onLostPointerCapture={() => {
          hold.current = null;
          setCursor(null);
        }}
      >
        <div className="pad-grid" />
        <div className="pad-center">
          <Fingerprint size={42} />
          <strong>
            {recording ? "按住并绘出你的节奏" : "点击开始录制，再操作触控板"}
          </strong>
          <span>松手记录为静默 · 每秒 10 帧</span>
        </div>
        {cursor && (
          <span
            className="touch-cursor"
            style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
          >
            {target === 0 ? "A" : "B"}
          </span>
        )}
      </div>
      <div className="lab-buttons">
        <button
          className={recording ? "danger" : "primary"}
          disabled={lab.pending}
          onClick={recording ? end : begin}
        >
          {recording ? <Square size={15} /> : <Circle size={15} />}{" "}
          {recording ? "结束录制" : "开始录制"}
        </button>
      </div>
      <div className="play-settings">
        <Field label="回放速度">
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.25, 0.5, 1, 1.5, 2, 4].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </Field>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={reverse}
            onChange={(e) => setReverse(e.target.checked)}
          />{" "}
          倒放
        </label>
      </div>
      <ClipActions
        tracks={transformed}
        name={name}
        setName={setName}
        onSave={save}
        onPlay={play}
        ready={ready && !recording}
        pending={lab.pending}
      />
    </section>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Play, Music2, Hand } from "lucide-react";
import { Field, Num, Wave } from "../App.jsx";
import { Source, Slider } from "./common.jsx";
import {
  ZERO,
  estimateBpm,
  audioEnvelope,
  frameOf,
  clamp,
} from "../../shared/lab.mjs";

function TapTempo({ onBpm }) {
  const taps = useRef([]);
  return (
    <button
      onClick={() => {
        const now = performance.now();
        if (now - (taps.current.at(-1) || 0) > 2500) taps.current = [];
        taps.current.push(now);
        taps.current = taps.current.slice(-8);
        const bpm = estimateBpm(taps.current);
        if (bpm) onBpm(clamp(bpm, 30, 200));
      }}
    >
      <Hand size={15} /> 敲击定拍
    </button>
  );
}
export function DJ({ sources, lab, ready, state }) {
  const [left, setLeft] = useState(sources[0]?.id || ""),
    [right, setRight] = useState(sources[1]?.id || ""),
    [mix, setMix] = useState(state.lab?.mode === "mix" ? state.lab.mix : 0),
    [bpm, setBpm] = useState(state.lab?.mode === "mix" ? state.lab.bpm : 100),
    [quantize, setQuantize] = useState(true),
    [alternate, setAlternate] = useState(false),
    [channels, setChannels] = useState("both");
  const a = sources.find((s) => s.id === left) || sources[0],
    b = sources.find((s) => s.id === right) || sources[1] || a;
  useEffect(() => {
    lab.patch.current = { mix, bpm };
  }, [mix, bpm]);
  const start = async () => {
    if (
      await lab.start({
        mode: "mix",
        label: "波形 DJ",
        left: a.frames,
        right: b.frames,
        mix,
        bpm,
        quantize,
        alternate,
        channels: channels === "both" ? [0, 1] : [Number(channels)],
        duration: 1800,
      })
    ) {
      lab.patch.current = { mix, bpm };
    }
  };
  return (
    <section className="panel dj-panel">
      <div className="section-heading">
        <h2>波形 DJ 台</h2>
        <span className="section-tag">4 BEATS / LOOP</span>
      </div>
      <div className="dj-decks">
        <div>
          <Source
            label="左唱盘"
            value={left}
            onChange={setLeft}
            sources={sources}
          />
          <Wave frames={a?.frames} />
        </div>
        <div>
          <Source
            label="右唱盘"
            value={right}
            onChange={setRight}
            sources={sources}
          />
          <Wave frames={b?.frames} color="var(--mint)" />
        </div>
      </div>
      <div className="dj-fader">
        <Slider label="混合位置（左 → 右）" value={mix} onChange={setMix} />
        <div>
          <span>{a?.name}</span>
          <span>{b?.name}</span>
        </div>
      </div>
      <div className="play-settings">
        <Field label="BPM">
          <Num value={bpm} onChange={setBpm} min={30} max={200} />
        </Field>
        <Field label="输出通道">
          <select
            value={channels}
            onChange={(e) => setChannels(e.target.value)}
          >
            <option value="both">A + B</option>
            <option value="0">仅 A</option>
            <option value="1">仅 B</option>
          </select>
        </Field>
        <TapTempo onBpm={setBpm} />
      </div>
      <div className="lab-toggles">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={quantize}
            onChange={(e) => setQuantize(e.target.checked)}
          />{" "}
          推子变化对齐下一拍
        </label>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={alternate}
            onChange={(e) => setAlternate(e.target.checked)}
          />{" "}
          每拍交替左右唱盘
        </label>
      </div>
      <p className="hint">四拍循环 · 推子与 BPM 实时生效</p>
      <div className="lab-buttons">
        <button
          className="primary"
          disabled={!ready || lab.pending || !a || !b}
          onClick={start}
        >
          <Play size={15} /> 开始混合
        </button>

        <span className="muted small">
          {state.lab?.mode === "mix" && state.lab.running
            ? `当前混合 ${state.lab.mix}%`
            : "等待开始"}
        </span>
      </div>
    </section>
  );
}
export function Music({ sources, lab, ready, notify, state }) {
  const [sourceMode, setSourceMode] = useState(
      state.lab?.mode === "tempo" ? "manual" : "audio",
    ),
    [url, setUrl] = useState(""),
    [fileName, setFileName] = useState(""),
    [bpm, setBpm] = useState(state.lab?.mode === "tempo" ? state.lab.bpm : 100),
    [gain, setGain] = useState(3),
    [running, setRunning] = useState(false),
    [level, setLevel] = useState(0),
    [selected, setSelected] = useState(sources.slice(0, 3).map((s) => s.id)),
    [switchEvery, setSwitchEvery] = useState(4),
    [detected, setDetected] = useState(null);
  const element = useRef(),
    ctx = useRef(),
    analyser = useRef(),
    timer = useRef(),
    current = useRef({}),
    objectURL = useRef(),
    ownedRun = useRef(null),
    generation = useRef(0);
  current.current = { bpm, gain, sourceMode, sources, selected, switchEvery };
  const stopLocal = () => {
    generation.current++;
    clearInterval(timer.current);
    timer.current = null;
    ownedRun.current = null;
    setRunning(false);
    setLevel(0);
    if (element.current && !element.current.paused) element.current.pause();
  };
  const stop = () => {
    stopLocal();
    lab.stop();
  };
  useEffect(() => {
    if (ownedRun.current && state.lab?.runId !== ownedRun.current) stopLocal();
  }, [state.lab?.runId, state.controlEpoch]);
  useEffect(() => {
    if (sourceMode === "manual") lab.patch.current = { bpm };
  }, [bpm, sourceMode]);
  useEffect(() => {
    const blur = () => {
      if (current.current.sourceMode === "audio") stop();
    };
    window.addEventListener("blur", blur);
    return () => {
      stopLocal();
      if (current.current.sourceMode === "audio") lab.stop();
      ctx.current?.close();
      if (objectURL.current) URL.revokeObjectURL(objectURL.current);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const start = async () => {
    stopLocal();
    const attempt = ++generation.current;
    try {
      if (sourceMode === "manual") {
        const waves = (selected.length ? selected : [sources[0]?.id])
          .map((id) => sources.find((s) => s.id === id)?.frames)
          .filter(Boolean);
        await lab.start({
          mode: "tempo",
          label: "手动节拍",
          waves,
          bpm,
          switchEvery,
          duration: 1800,
        });
        lab.patch.current = { bpm };
        return;
      }
      if (sourceMode === "audio") {
        if (!url) throw Error("请先选择本地音频");
        if (!ctx.current) {
          ctx.current = new AudioContext();
          analyser.current = ctx.current.createAnalyser();
          analyser.current.fftSize = 2048;
          const node = ctx.current.createMediaElementSource(element.current);
          node.connect(analyser.current);
          analyser.current.connect(ctx.current.destination);
        }
        await ctx.current.resume();
        await element.current.play();
      }
      const startedRun = await lab.start({
        mode: "stream",
        label: sourceMode === "audio" ? "音乐联动" : "手动节拍",
        duration: 1800,
      });
      if (!startedRun) {
        stop();
        return;
      }
      if (attempt !== generation.current) {
        stop();
        return;
      }
      ownedRun.current = startedRun.runId;
      setRunning(true);
      const samples = new Float32Array(2048),
        taps = [];
      let tick = 0,
        energy = 0,
        average = 0.05,
        lastBeat = 0,
        beats = 0;
      const started = performance.now();
      timer.current = setInterval(() => {
        if (lab.live.current?.runId !== ownedRun.current) {
          stopLocal();
          return;
        }
        const c = current.current;
        let amplitude, phase;
        if (c.sourceMode === "audio") {
          analyser.current.getFloatTimeDomainData(samples);
          const rms = audioEnvelope(samples, c.gain);
          average = average * 0.92 + rms * 0.08;
          const now = performance.now();
          if (rms > Math.max(0.08, average * 1.35) && now - lastBeat > 300) {
            lastBeat = now;
            beats++;
            taps.push(now);
            if (taps.length > 8) taps.shift();
            const estimate = estimateBpm(taps);
            if (estimate) setDetected(estimate);
          }
          energy = energy * 0.35 + rms * 0.65;
          amplitude = energy;
          phase = (now - lastBeat) / 1000;
        } else {
          const beat = ((performance.now() - started) / 60000) * c.bpm;
          beats = Math.floor(beat);
          phase = beat % 1;
          amplitude = Math.exp(-phase * 5);
        }
        const ids = c.selected.length ? c.selected : [c.sources[0]?.id],
          wave =
            c.sources.find(
              (s) =>
                s.id === ids[Math.floor(beats / c.switchEvery) % ids.length],
            ) || c.sources[0];
        const f = wave?.frames[tick++ % wave.frames.length] || ZERO,
          out = f[2] ? frameOf(f[0] + f[1], f[2] * 5 * amplitude) : [...ZERO];
        lab.patch.current = { frames: [out, out] };
        setLevel(Math.round(amplitude * 100));
      }, 100);
    } catch (e) {
      stop();
      notify(e.message || "无法读取音频", true);
    }
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          <Music2 size={18} /> 音乐与节拍联动
        </h2>
        <span className="section-tag">LOCAL AUDIO</span>
      </div>
      <Field label="节拍来源">
        <select
          disabled={running}
          value={sourceMode}
          onChange={(e) => setSourceMode(e.target.value)}
        >
          <option value="audio">本地音频</option>
          <option value="manual">手动 BPM / 敲击定拍</option>
        </select>
      </Field>
      <div style={{ display: sourceMode === "audio" ? "block" : "none" }}>
        <Field label="选择音频文件">
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              stop();
              const f = e.target.files[0];
              if (!f) return;
              if (objectURL.current) URL.revokeObjectURL(objectURL.current);
              objectURL.current = URL.createObjectURL(f);
              setUrl(objectURL.current);
              setFileName(f.name);
              setDetected(null);
            }}
          />
        </Field>
        <audio
          ref={element}
          src={url || undefined}
          controls
          onEnded={stop}
          onPause={() => {
            if (timer.current) stop();
          }}
        />
        <p className="hint">
          {fileName || "尚未选择文件"}{" "}
          {detected ? `· 检测约 ${detected} BPM` : ""}
        </p>
        <Slider
          label="音量响应增益"
          value={gain}
          onChange={setGain}
          min={0.5}
          max={8}
          step={0.5}
        />
      </div>
      {sourceMode === "manual" && (
        <div className="play-settings">
          <Field label="BPM">
            <Num value={bpm} onChange={setBpm} min={30} max={200} />
          </Field>
          <TapTempo onBpm={setBpm} />
        </div>
      )}
      <div className="music-meter">
        <i style={{ width: `${level}%` }} />
        <span>{level}% 幅值响应</span>
      </div>
      <Field label="每几拍切换波形">
        <select
          value={switchEvery}
          onChange={(e) => setSwitchEvery(Number(e.target.value))}
        >
          {[1, 2, 4, 8, 16].map((n) => (
            <option key={n} value={n}>
              {n} 拍
            </option>
          ))}
        </select>
      </Field>
      <div className="music-picks">
        {sources.map((s) => (
          <label className="switch-label" key={s.id}>
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) =>
                setSelected((v) =>
                  e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id),
                )
              }
            />
            {s.name}
          </label>
        ))}
      </div>
      <div className="lab-buttons">
        <button
          className="primary"
          disabled={!ready || lab.pending || running}
          onClick={start}
        >
          <Play size={15} /> 开始音乐联动
        </button>
      </div>
      <p className="hint">
        {sourceMode === "manual"
          ? "可后台播放 · 最长 30 分钟"
          : "播放时请保持此页面在前台"}
      </p>
    </section>
  );
}

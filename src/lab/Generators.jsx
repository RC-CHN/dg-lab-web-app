import React, { useRef, useState } from "react";
import { Copy, FlipHorizontal2, Waves, Shuffle } from "lucide-react";
import { Field, Num } from "../App.jsx";
import {
  echoTracks,
  curveFrames,
  randomFrames,
  clamp,
} from "../../shared/lab.mjs";
import { Source, Slider, ClipActions, zeroTrack } from "./common.jsx";
import { localId } from "../api.js";

export function Echo({ sources, save, play, ready, lab }) {
  const [source, setSource] = useState(sources[0]?.id || ""),
    [delay, setDelay] = useState(0.6),
    [decay, setDecay] = useState(60),
    [repeats, setRepeats] = useState(3),
    [invert, setInvert] = useState(false),
    [pingPong, setPingPong] = useState(true),
    [name, setName] = useState("A/B 回声");
  const frames = (sources.find((s) => s.id === source) || sources[0])
      ?.frames || [[0, 0, 0]],
    tracks = echoTracks(frames, {
      delay,
      decay: decay / 100,
      repeats,
      invert,
      pingPong,
    });
  return (
    <section className="panel">
      <h2>A / B 回声</h2>
      <p className="hint">让 B 通道延迟回应 A 通道。</p>
      <Source
        label="声音源 / 波形片段"
        value={source}
        onChange={setSource}
        sources={sources}
      />
      <div className="play-settings">
        <Slider
          label="延迟"
          value={delay}
          onChange={setDelay}
          min={0.1}
          max={5}
          step={0.1}
          unit="s"
        />
        <Slider label="每次保留" value={decay} onChange={setDecay} unit="%" />
        <Field label="重复次数">
          <Num value={repeats} onChange={setRepeats} min={1} max={8} />
        </Field>
      </div>
      <div className="lab-toggles">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={pingPong}
            onChange={(e) => setPingPong(e.target.checked)}
          />{" "}
          A/B 交替回声
        </label>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={invert}
            onChange={(e) => setInvert(e.target.checked)}
          />{" "}
          奇数次反向幅值
        </label>
      </div>
      <ClipActions
        tracks={tracks}
        name={name}
        setName={setName}
        onSave={save}
        onPlay={play}
        ready={ready}
        pending={lab.pending}
      />
    </section>
  );
}
function Curve({ label, values, setValues, min, max }) {
  const svg = useRef(),
    previous = useRef(null),
    [copy, setCopy] = useState(null);
  const draw = (e) => {
    const r = svg.current.getBoundingClientRect(),
      i = Math.round(
        clamp((e.clientX - r.left) / r.width, 0, 1) * (values.length - 1),
      ),
      v = Math.round(
        max - clamp((e.clientY - r.top) / r.height, 0, 1) * (max - min),
      );
    const prev = previous.current;
    setValues((old) => {
      const a = [...old];
      if (prev) {
        for (let j = Math.min(i, prev.i); j <= Math.max(i, prev.i); j++)
          a[j] = Math.round(
            prev.v + ((v - prev.v) * (j - prev.i)) / (i - prev.i || 1),
          );
      }
      a[i] = v;
      return a;
    });
    previous.current = { i, v };
  };
  return (
    <div className="curve-editor">
      <div className="section-heading">
        <h3>{label}</h3>
        <small>
          {min}–{max}
        </small>
      </div>
      <svg
        ref={svg}
        viewBox="0 0 500 130"
        preserveAspectRatio="none"
        aria-label={label}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          previous.current = null;
          draw(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) draw(e);
        }}
        onPointerUp={() => (previous.current = null)}
        onPointerCancel={() => (previous.current = null)}
      >
        <path d="M0 32H500 M0 65H500 M0 97H500" />
        <polyline
          points={values
            .map(
              (v, i) =>
                `${(i / (values.length - 1)) * 500},${130 - ((v - min) / (max - min)) * 130}`,
            )
            .join(" ")}
        />
      </svg>
      <div className="lab-buttons">
        <button onClick={() => setValues([...values].reverse())}>
          <FlipHorizontal2 size={13} /> 镜像
        </button>
        <button onClick={() => setValues(values.map((v) => max + min - v))}>
          上下反转
        </button>
        <button
          onClick={() =>
            setValues(
              values.map((v, i) =>
                Math.round(
                  (values[Math.max(0, i - 1)] +
                    v +
                    values[Math.min(values.length - 1, i + 1)]) /
                    3,
                ),
              ),
            )
          }
        >
          <Waves size={13} /> 平滑
        </button>
        <button onClick={() => setCopy([...values])}>
          <Copy size={13} /> 复制
        </button>
        <button disabled={!copy} onClick={() => setValues([...copy])}>
          粘贴
        </button>
      </div>
      <details>
        <summary>用数值精细编辑</summary>
        <div className="curve-numbers">
          {values.map((v, i) => (
            <label key={i}>
              {i + 1}
              <input
                aria-label={`${label}点${i + 1}`}
                type="number"
                min={min}
                max={max}
                value={v}
                onChange={(e) =>
                  setValues(
                    values.map((v, j) =>
                      j === i ? clamp(Number(e.target.value), min, max) : v,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
export function Drawing({ save, play, ready, lab }) {
  const [amplitude, setAmplitude] = useState(
      Array.from({ length: 32 }, (_, i) =>
        Math.round((1 - Math.cos((i / 31) * Math.PI * 2)) * 40),
      ),
    ),
    [period, setPeriod] = useState(Array(32).fill(40)),
    [seconds, setSeconds] = useState(4),
    [name, setName] = useState("手绘波形"),
    [pieces, setPieces] = useState([]);
  const current = curveFrames(amplitude, period, seconds),
    frames = [...pieces.flat(), ...current].slice(0, 6000),
    tracks = [frames, zeroTrack(frames.length)];
  return (
    <section className="panel">
      <h2>画线生成波形</h2>
      <p className="hint">
        横轴是时间，上图画幅值，下图画周期；可以把多个片段依次拼起来。
      </p>
      <Curve
        label="幅值 / %"
        values={amplitude}
        setValues={setAmplitude}
        min={0}
        max={100}
      />
      <Curve
        label="周期 / ms"
        values={period}
        setValues={setPeriod}
        min={10}
        max={100}
      />
      <div className="play-settings">
        <Field label="当前片段时长 / 秒">
          <Num value={seconds} onChange={setSeconds} min={1} max={60} />
        </Field>
        <div className="lab-buttons">
          <button
            disabled={pieces.flat().length + current.length > 5400}
            onClick={() => setPieces((p) => [...p, current])}
          >
            追加当前片段
          </button>
          <button
            disabled={!pieces.length}
            onClick={() => setPieces((p) => p.slice(0, -1))}
          >
            撤销拼接
          </button>
        </div>
      </div>
      <p className="hint">已拼接 {pieces.length} 段，下面预览包括当前片段。</p>
      <ClipActions
        tracks={tracks}
        name={name}
        setName={setName}
        onSave={save}
        onPlay={play}
        ready={ready}
        pending={lab.pending}
      />
    </section>
  );
}
export function Randomizer({ save, play, ready, lab }) {
  const [seed, setSeed] = useState("my-rhythm-001"),
    [seconds, setSeconds] = useState(30),
    [density, setDensity] = useState(60),
    [smoothness, setSmoothness] = useState(50),
    [chaos, setChaos] = useState(50),
    [name, setName] = useState("有规律的随机");
  const a = randomFrames({ seed, seconds, density, smoothness, chaos }),
    b = randomFrames({
      seed: `${seed}:B`,
      seconds,
      density,
      smoothness,
      chaos,
    });
  return (
    <section className="panel">
      <h2>有规律的随机</h2>
      <p className="hint">相同种子与设置，可以重现同一段节奏。</p>
      <div className="play-settings">
        <Field label="随机种子">
          <input
            value={seed}
            maxLength={100}
            onChange={(e) => setSeed(e.target.value)}
          />
        </Field>
        <Field label="生成时长 / 秒">
          <Num min={1} max={600} value={seconds} onChange={setSeconds} />
        </Field>
      </div>
      <div className="play-settings">
        <Slider label="密集程度" value={density} onChange={setDensity} />
        <Slider label="平滑程度" value={smoothness} onChange={setSmoothness} />
        <Slider label="变化程度" value={chaos} onChange={setChaos} />
      </div>
      <button onClick={() => setSeed(localId().slice(0, 12))}>
        <Shuffle size={15} /> 换一个种子
      </button>
      <ClipActions
        tracks={[a, b]}
        name={name}
        setName={setName}
        onSave={save}
        onPlay={play}
        ready={ready}
        pending={lab.pending}
      />
    </section>
  );
}

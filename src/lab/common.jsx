import React from "react";
import { Play, Save, Download, Upload } from "lucide-react";
import { Field, Num, Wave } from "../App.jsx";
import { ZERO, validateFrames } from "../../shared/lab.mjs";
import { localId } from "../api.js";

export function Source({ label, value, onChange, sources }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!sources.some((s) => s.id === value) && (
          <option value={value}>原片段已移除，请重新选择</option>
        )}
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
}) {
  return (
    <Field label={`${label} · ${value}${unit}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
export function Tracks({ tracks }) {
  return (
    <div className="lab-tracks">
      {tracks.map((frames, c) => (
        <div key={c}>
          <span>{c === 0 ? "A" : "B"}</span>
          <Wave
            frames={frames}
            color={c === 0 ? "var(--accent)" : "var(--mint)"}
          />
          <small>{(frames.length / 10).toFixed(1)}s</small>
        </div>
      ))}
    </div>
  );
}
export function ClipActions({
  tracks,
  name,
  setName,
  onSave,
  onPlay,
  ready,
  pending,
}) {
  return (
    <>
      <Tracks tracks={tracks} />
      <div className="lab-save-row">
        <input
          aria-label="片段名称"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <button onClick={() => onSave(name, tracks)}>
          <Save size={15} /> 保存片段
        </button>
        <button
          className="primary"
          disabled={!ready || pending}
          onClick={() => onPlay(tracks, name)}
        >
          <Play size={15} /> 播放双轨
        </button>
      </div>
    </>
  );
}
export const zeroTrack = (n) => Array.from({ length: n }, () => [...ZERO]);
export function downloadJSON(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function validateClip(clip) {
  if (
    !clip ||
    typeof clip.name !== "string" ||
    !Array.isArray(clip.tracks) ||
    clip.tracks.length !== 2
  )
    throw Error("片段格式无效");
  clip.tracks.forEach((t) => validateFrames(t));
  return {
    id: localId(),
    name: clip.name.slice(0, 40),
    tracks: clip.tracks,
  };
}

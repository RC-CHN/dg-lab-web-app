import React, { useEffect, useState } from "react";
import { Square, Download, Upload, Trash2, Play } from "lucide-react";
import { Field, Num } from "../App.jsx";
import { validateFrames } from "../../shared/lab.mjs";
import useLab from "./useLab.js";
import Recorder from "./Recorder.jsx";
import { Echo, Drawing, Randomizer } from "./Generators.jsx";
import { DJ, Music } from "./Live.jsx";
import { Coop } from "./Coop.jsx";
import Branches from "./Branches.jsx";
import { Tracks, downloadJSON, validateClip } from "./common.jsx";
import "./laboratory.css";

export default function Laboratory({
  mode,
  device,
  state,
  presets,
  ready,
  run,
  notify,
}) {
  const [loop, setLoop] = useState(true),
    [duration, setDuration] = useState(1800),
    [visited, setVisited] = useState([]),
    [clips, setClips] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem("dg-lab-clips") || "[]")
          .slice(0, 30)
          .map((c) => {
            c.tracks.forEach((f) => validateFrames(f));
            return c;
          });
      } catch {
        return [];
      }
    });
  const lab = useLab({ device, state, notify }),
    sources = [
      ...presets,
      ...clips.flatMap((c) =>
        c.tracks.map((frames, i) => ({
          id: `${c.id}:${i}`,
          name: `${c.name} / ${i === 0 ? "A" : "B"}`,
          frames,
        })),
      ),
    ];
  useEffect(() => {
    if (mode) setVisited((v) => (v.includes(mode) ? v : [...v, mode]));
  }, [mode]);
  const persist = (list) => {
    try {
      localStorage.setItem("dg-lab-clips", JSON.stringify(list));
      setClips(list);
      return true;
    } catch {
      notify("浏览器空间不足，请导出或删除部分片段", true);
      return false;
    }
  };
  const save = (name, tracks) => {
    try {
      if (clips.length >= 30) throw Error("最多保留 30 个片段，请先导出或删除");
      const clip = validateClip({ name, tracks });
      if (persist([...clips, clip]))
        notify("已保存；可在回声、DJ 和场景中选用");
    } catch (e) {
      notify(e.message, true);
    }
  };
  const play = (tracks, label) =>
    lab.start({
      mode: "tracks",
      source: mode || "record",
      tracks,
      label,
      loop,
      duration,
    });
  const common = {
    device,
    state,
    lab,
    sources,
    ready,
    run,
    notify,
    save,
    play,
  };
  return (
    <div className="laboratory" hidden={!mode}>
      <section className="lab-transport">
        <div>
          <span className={`status-dot ${state.lab?.running ? "green" : ""}`} />
          <b>{state.lab?.running ? state.lab.label : "尚未播放"}</b>
          <small>
            {state.lab?.running
              ? `${(state.lab.tick / 10).toFixed(1)}s / ${state.lab.duration}s`
              : state.lab?.reason || "准备就绪"}
          </small>
        </div>
        <button onClick={lab.stop} disabled={!state.lab?.running}>
          <Square size={14} /> 停止波形
        </button>
      </section>
      {["record", "echo", "draw", "random"].includes(mode) && (
        <div className="lab-play-preferences">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />{" "}
            片段循环
          </label>
          <Field label="播放最长时间 / 秒">
            <Num value={duration} onChange={setDuration} min={1} max={1800} />
          </Field>
        </div>
      )}
      {visited.map((key) => {
        const Component = {
          record: Recorder,
          echo: Echo,
          dj: DJ,
          draw: Drawing,
          random: Randomizer,
          coop: Coop,
          branch: Branches,
          music: Music,
        }[key];
        return (
          <div key={key} hidden={mode !== key}>
            <Component
              {...common}
              active={mode === key}
              lab={lab.scoped(key)}
            />
          </div>
        );
      })}
      <section className="panel clip-library">
        <div className="section-heading">
          <h2>
            我的片段库 <span className="count">{clips.length} / 30</span>
          </h2>
          <div className="lab-buttons">
            <button
              disabled={!clips.length}
              onClick={() =>
                downloadJSON("dglab-clips.json", { version: 1, clips })
              }
            >
              <Download size={14} /> 导出
            </button>
            <label className="file-button">
              <Upload size={14} /> 导入
              <input
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  try {
                    if (file.size > 4000000) throw Error("文件超过 4MB");
                    const data = JSON.parse(await file.text()),
                      items = Array.isArray(data.clips) ? data.clips : [data];
                    if (items.length + clips.length > 30)
                      throw Error("片段总数超过 30");
                    const valid = items.map(validateClip);
                    if (persist([...clips, ...valid])) notify("片段已导入");
                  } catch (error) {
                    notify(error.message, true);
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        {!clips.length ? (
          <p className="hint">还没有片段。录制或制作后保存在这里。</p>
        ) : (
          clips.map((c) => (
            <details key={c.id}>
              <summary>
                <b>{c.name}</b>
                <span>
                  {(Math.max(...c.tracks.map((t) => t.length)) / 10).toFixed(1)}
                  s
                </span>
              </summary>
              <Tracks tracks={c.tracks} />
              <div className="lab-buttons">
                <button
                  disabled={!ready || lab.pending}
                  onClick={() => play(c.tracks, c.name)}
                >
                  <Play size={14} /> 播放片段
                </button>
                <button onClick={() => downloadJSON("dglab-clip.json", c)}>
                  <Download size={14} /> 导出此片段
                </button>
                <button
                  aria-label={`删除片段${c.name}`}
                  onClick={() => persist(clips.filter((x) => x.id !== c.id))}
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
            </details>
          ))
        )}
      </section>
    </div>
  );
}

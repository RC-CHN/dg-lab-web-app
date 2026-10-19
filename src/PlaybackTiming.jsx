import React from "react";
import { Field, Num } from "./App.jsx";

export const defaultTiming = { delay: 0, stopAfter: 0, interval: null };
export function playbackPhase(player, now) {
  if (player?.phase === "delay")
    return `倒计时 ${Math.max(0, Math.ceil((player.phaseUntil - now) / 1000))} 秒`;
  if (player?.phase === "rest")
    return `间歇休息 ${Math.max(0, Math.ceil((player.phaseUntil - now) / 1000))} 秒`;
  return null;
}
export default function PlaybackTiming({ value, onChange }) {
  const update = (patch) => onChange({ ...value, ...patch });
  return (
    <details className="playback-timing">
      <summary>定时启停</summary>
      <div className="inline-fields">
        <Field label="延时开始 / 秒">
          <Num
            value={value.delay}
            max={86400}
            onChange={(delay) => update({ delay })}
          />
        </Field>
        <Field label="开始后停止 / 分钟">
          <Num
            value={value.stopAfter / 60}
            max={1440}
            onChange={(minutes) =>
              update({ stopAfter: Math.round(minutes * 60) })
            }
          />
        </Field>
      </div>
      <p className="hint">0 表示不设定时</p>
      <label className="switch-label">
        <input
          type="checkbox"
          checked={!!value.interval}
          onChange={(e) =>
            update({
              interval: e.target.checked
                ? { work: [30, 30], rest: [10, 10] }
                : null,
            })
          }
        />{" "}
        间隔播放
      </label>
      {value.interval && (
        <div className="timing-ranges">
          {[
            ["work", "输出"],
            ["rest", "休息"],
          ].map(([key, label]) => (
            <fieldset key={key}>
              <legend>{label} / 秒</legend>
              {[0, 1].map((i) => (
                <Field key={i} label={i ? "最长" : "最短"}>
                  <Num
                    aria-label={`${label}${i ? "最长" : "最短"}秒`}
                    value={value.interval[key][i]}
                    min={1}
                    max={3600}
                    onChange={(v) => {
                      const range = [...value.interval[key]];
                      range[i] = v;
                      if (range[0] > range[1]) range[1 - i] = v;
                      update({ interval: { ...value.interval, [key]: range } });
                    }}
                  />
                </Field>
              ))}
            </fieldset>
          ))}
        </div>
      )}
      {value.interval && (
        <p className="hint">相同数值为固定间隔，不同数值为随机范围</p>
      )}
    </details>
  );
}

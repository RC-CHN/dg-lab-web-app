import React, { useState } from "react";
import { Copy, Link2, UserPlus, X } from "lucide-react";
import { Field, Num } from "../App.jsx";
import { Slider } from "./common.jsx";
import { COOP_GUEST_LIMIT } from "../../shared/lab.mjs";

export function VectorControls({ value, onChange }) {
  return (
    <div className="vector-controls">
      <div className="play-settings">
        {["A", "B"].map((c) => (
          <Slider
            key={c}
            label={`我的 ${c} 路贡献`}
            value={value[`amplitude${c}`]}
            unit="%"
            step={5}
            onChange={(v) => onChange({ ...value, [`amplitude${c}`]: v })}
          />
        ))}
      </div>
      <button onClick={() => onChange({ amplitudeA: 0, amplitudeB: 0 })}>
        清空我的贡献
      </button>
    </div>
  );
}

export function VectorSummary({ vector, running, selfId = "owner" }) {
  return (
    <div className="vector-summary">
      <div className="section-heading">
        <h3>A/B 合成</h3>
        <span className="small muted">{running ? "实时叠加" : "等待开始"}</span>
      </div>
      <div className="vector-meters">
        {["A", "B"].map((c) => {
          const value = vector?.[`amplitude${c}`] ?? 0,
            raw = vector?.[`raw${c}`] ?? 0,
            cap = vector?.[`cap${c}`] ?? 100;
          return (
            <div key={c} className={`vector-meter channel-${c.toLowerCase()}`}>
              <div>
                <b>{c}</b>
                <output aria-label={`${c} 路合成幅值`}>
                  {Math.round(value)}%
                </output>
              </div>
              <div className="vector-meter-track" aria-hidden="true">
                <i style={{ width: `${value}%` }} />
                <span style={{ left: `${cap}%` }} />
              </div>
              <small>
                {raw > cap
                  ? `合计 ${Math.round(raw)}% · 已封顶 ${cap}%`
                  : `上限 ${cap}%`}
              </small>
            </div>
          );
        })}
      </div>
      {!!vector?.participants?.length && (
        <div className="vector-contributors" aria-label="实时贡献">
          {vector.participants.map((p) => (
            <div key={p.id}>
              <span>
                {p.name}
                {p.id === selfId ? " · 我" : ""}
              </span>
              <span>
                A <b>{p.amplitudeA}%</b>
              </span>
              <span>
                B <b>{p.amplitudeB}%</b>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MultiInvitation({ device, state, run, notify }) {
  const [minutes, setMinutes] = useState(30),
    [name, setName] = useState(""),
    [pending, setPending] = useState(false);
  const entries = (state.cooperation || []).filter(
    (i) => i.role === "vector" && i.deviceId === device?.id,
  );
  return (
    <div className="invite-box multi-invitation">
      <div className="section-heading">
        <h3>
          <Link2 size={15} /> 邀请玩家
        </h3>
        <span className="small muted">
          {entries.filter((i) => i.online).length} 人在线 · {entries.length}/
          {COOP_GUEST_LIMIT} 个席位
        </span>
      </div>
      <div className="play-settings">
        <Field label="玩家备注">
          <input
            value={name}
            maxLength={24}
            placeholder="可选，如：小明"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="有效分钟">
          <Num value={minutes} onChange={setMinutes} min={1} max={60} />
        </Field>
      </div>
      <button
        disabled={
          !device?.connected || pending || entries.length >= COOP_GUEST_LIMIT
        }
        onClick={async () => {
          setPending(true);
          try {
            const result = await run("coop/create", {
              id: device.id,
              role: "vector",
              minutes,
              name,
            });
            if (result) setName("");
          } finally {
            setPending(false);
          }
        }}
      >
        <UserPlus size={15} /> 创建邀请链接
      </button>
      <div className="invite-roster">
        {entries.map((entry) => {
          const url = `${location.origin}/#invite=${entry.token}`;
          return (
            <div className="invite-player" key={entry.id}>
              <div className="section-heading">
                <b>{entry.name}</b>
                <span className="small muted">
                  {entry.online ? "在线" : entry.claimed ? "已离线" : "待加入"}
                </span>
              </div>
              <div className="invite-url">
                <input
                  aria-label={`${entry.name}的邀请链接`}
                  value={url}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <button
                  aria-label={`复制${entry.name}的邀请链接`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      notify("邀请链接已复制");
                    } catch {
                      notify("请选中链接手动复制");
                    }
                  }}
                >
                  <Copy size={15} />
                </button>
                <button
                  aria-label={`移除${entry.name}`}
                  onClick={() => run("coop/revoke", { id: entry.id })}
                >
                  <X size={15} />
                </button>
              </div>
              <small className="muted">
                有效至{" "}
                {new Date(entry.expires).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </div>
          );
        })}
      </div>
      <p className="hint">每人一个链接 · 含主控最多 8 人</p>
      {!!entries.length && (
        <button onClick={() => run("coop/revoke", {})}>撤销全部邀请</button>
      )}
    </div>
  );
}

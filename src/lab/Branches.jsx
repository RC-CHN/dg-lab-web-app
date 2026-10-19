import React, { useState } from "react";
import { Plus, Play, Download } from "lucide-react";
import { Field, Num } from "../App.jsx";
import { Source, downloadJSON } from "./common.jsx";
import { ChoiceButtons, Invitation } from "./Coop.jsx";

export default function Branches({
  sources,
  device,
  state,
  lab,
  ready,
  run,
  notify,
}) {
  const initial = () =>
    [0, 1, 2].map((n) => ({
      title: [
        "接下来想听哪种节奏？",
        "保持这个节奏，还是回到开头？",
        "这一段之后呢？",
      ][n],
      sourceId: sources[n]?.id || sources[0]?.id,
      seconds: 10,
      choices:
        n === 0
          ? [
              { label: "舒缓一点", to: 1 },
              { label: "换个节奏", to: 2 },
            ]
          : [
              { label: "再来一段", to: 0 },
              { label: "结束", to: -1 },
            ],
    }));
  const [nodes, setNodes] = useState(initial),
    [name, setName] = useState("互动小剧场"),
    [saved, setSaved] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem("dg-branches") || "[]").slice(
          0,
          10,
        );
      } catch {
        return [];
      }
    });
  const update = (index, patch) =>
    setNodes((ns) => ns.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  const config = () => ({
    mode: "scene",
    label: name,
    duration: 1800,
    nodes: nodes.map((n, index) => {
      const source = sources.find((s) => s.id === n.sourceId);
      if (!source)
        throw Error(`节点 ${index + 1} 的片段已移除，请重新选择波形`);
      return {
        title: n.title,
        seconds: n.seconds,
        frames: source.frames,
        choices: n.choices,
      };
    }),
  });
  const withConfig = (action) => {
    try {
      action(config());
    } catch (e) {
      notify(e.message, true);
    }
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>互动场景编排</h2>
        <button
          disabled={nodes.length >= 16}
          onClick={() =>
            setNodes((n) => [
              ...n,
              {
                title: "请选择下一段",
                sourceId: sources[0]?.id,
                seconds: 10,
                choices: [{ label: "结束", to: -1 }],
              },
            ])
          }
        >
          <Plus size={15} /> 添加节点
        </button>
      </div>
      <p className="hint">播放后选择下一段；没有选项则结束。</p>
      <Field label="场景名称">
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="branch-nodes">
        {nodes.map((n, i) => (
          <details key={i} open={nodes.length <= 3}>
            <summary>
              <b>
                {String(i + 1).padStart(2, "0")} / {n.title}
              </b>
              <span>{n.seconds}s</span>
            </summary>
            <Field label="播放后显示的问题">
              <input
                value={n.title}
                maxLength={60}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            </Field>
            <div className="play-settings">
              <Source
                label="此节点波形"
                value={n.sourceId}
                onChange={(sourceId) => update(i, { sourceId })}
                sources={sources}
              />
              <Field label="播放秒数">
                <Num
                  value={n.seconds}
                  onChange={(seconds) => update(i, { seconds })}
                  min={1}
                  max={120}
                />
              </Field>
            </div>
            {n.choices.map((c, j) => (
              <div className="branch-edge" key={j}>
                <input
                  aria-label={`节点${i + 1}选项${j + 1}`}
                  value={c.label}
                  maxLength={40}
                  onChange={(e) =>
                    update(i, {
                      choices: n.choices.map((v, k) =>
                        j === k ? { ...v, label: e.target.value } : v,
                      ),
                    })
                  }
                />
                <span>→</span>
                <select
                  aria-label={`节点${i + 1}跳转${j + 1}`}
                  value={c.to}
                  onChange={(e) =>
                    update(i, {
                      choices: n.choices.map((v, k) =>
                        j === k ? { ...v, to: Number(e.target.value) } : v,
                      ),
                    })
                  }
                >
                  <option value="-1">结束实验</option>
                  {nodes.map((_, k) => (
                    <option key={k} value={k}>
                      节点 {k + 1}
                    </option>
                  ))}
                </select>
                <button
                  aria-label={`删除节点${i + 1}选项${j + 1}`}
                  onClick={() =>
                    update(i, { choices: n.choices.filter((_, k) => j !== k) })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="subtle"
              disabled={n.choices.length >= 4}
              onClick={() =>
                update(i, {
                  choices: [...n.choices, { label: "继续", to: -1 }],
                })
              }
            >
              + 添加选项
            </button>
          </details>
        ))}
      </div>
      <div className="lab-buttons">
        <button
          className="primary"
          disabled={!ready || lab.pending}
          onClick={() => withConfig((c) => lab.start(c))}
        >
          <Play size={15} /> 开始互动场景
        </button>
        <button
          disabled={nodes.length <= 1}
          onClick={() =>
            setNodes((n) =>
              n.slice(0, -1).map((x) => ({
                ...x,
                choices: x.choices.map((c) => ({
                  ...c,
                  to: c.to >= n.length - 1 ? -1 : c.to,
                })),
              })),
            )
          }
        >
          移除末尾节点
        </button>
        <button
          onClick={() => {
            try {
              const item = { name, nodes },
                list = [...saved, item].slice(-10);
              localStorage.setItem("dg-branches", JSON.stringify(list));
              setSaved(list);
              notify("互动场景已保存");
            } catch {
              notify("保存失败，浏览器空间可能不足", true);
            }
          }}
        >
          保存编排
        </button>
        <button
          onClick={() => withConfig((c) => downloadJSON("dglab-scene.json", c))}
        >
          <Download size={15} /> 导出波形场景
        </button>
      </div>
      {saved.length > 0 && (
        <Field label="载入本地编排">
          <select
            defaultValue=""
            onChange={(e) => {
              const item = saved[Number(e.target.value)];
              if (item) {
                setName(item.name);
                setNodes(item.nodes);
              }
            }}
          >
            <option value="" disabled>
              选择已保存编排
            </option>
            {saved.map((s, i) => (
              <option key={i} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ChoiceButtons
        lab={state.lab}
        choose={(body) => run("lab/choose", body)}
      />
      <Invitation
        device={device}
        state={state}
        run={run}
        notify={notify}
        role="choice"
      />
    </section>
  );
}

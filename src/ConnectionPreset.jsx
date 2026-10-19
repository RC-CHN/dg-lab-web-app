import React, { useEffect, useState } from "react";
import { Save, PlugZap, Trash2 } from "lucide-react";
import { Field } from "./App.jsx";
import RoomCodeInput from "./RoomCodeInput.jsx";

export default function ConnectionPreset({
  preset,
  disabled,
  inRoom,
  command,
}) {
  const [mode, setMode] = useState("phone"),
    [account, setAccount] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [roomPassword, setRoomPassword] = useState(""),
    [clearRoomPassword, setClearRoomPassword] = useState(false),
    [country, setCountry] = useState("86"),
    [readingQr, setReadingQr] = useState(false),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    setMode(preset?.email ? "email" : "phone");
    setAccount(preset?.email || preset?.phone || "");
    setCode(preset?.code || "");
    setCountry(preset?.phoneCountryCode || "86");
    setPassword("");
    setRoomPassword("");
    setClearRoomPassword(false);
  }, [preset?.revision]);
  if (!preset?.available) return null;
  return (
    <section className="panel admin-card connection-preset">
      <div className="section-heading">
        <h2>连接预设</h2>
        <span className="small muted">
          {preset.configured ? "已持久保存" : "尚未保存"}
        </span>
      </div>
      {preset.configured && (
        <>
          <p className="muted preset-account">
            {preset.phone || preset.email} · 房间 {preset.code}
          </p>
          <button
            className="primary"
            disabled={disabled || inRoom}
            onClick={() =>
              command(
                "connection/connect",
                {},
                "预设房间已连接，选择设备即可接管",
              )
            }
          >
            <PlugZap size={16} /> 连接预设房间
          </button>
        </>
      )}
      <details
        open={editing}
        onToggle={(e) => setEditing(e.currentTarget.open)}
      >
        <summary>
          {preset.configured ? "修改或清除预设" : "设置连接预设"}
        </summary>
        {editing && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await command(
                "connection/save",
                {
                  phone: mode === "phone" ? account : "",
                  email: mode === "email" ? account : "",
                  password,
                  code,
                  roomPassword,
                  clearRoomPassword,
                  phoneCountryCode: country,
                },
                "连接预设已持久保存",
              );
              if (result) {
                setPassword("");
                setRoomPassword("");
                setEditing(false);
              }
            }}
          >
            <Field label="预设账号类型">
              <select
                value={mode}
                disabled={disabled}
                onChange={(e) => {
                  setMode(e.target.value);
                  setAccount("");
                }}
              >
                <option value="phone">手机号</option>
                <option value="email">邮箱</option>
              </select>
            </Field>
            <Field label="预设官方账号">
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                required
                disabled={disabled}
                autoComplete="off"
              />
            </Field>
            {mode === "phone" && (
              <Field label="预设电话区号">
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  maxLength={4}
                  inputMode="numeric"
                  disabled={disabled}
                />
              </Field>
            )}
            <Field label="预设官方密码">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={
                  preset.hasPassword ? "已保存，留空保留" : "填写官方账号密码"
                }
                disabled={disabled}
              />
            </Field>
            <RoomCodeInput
              value={code}
              onChange={setCode}
              disabled={disabled || !editing}
              onBusy={setReadingQr}
              label="预设房间码"
              successMessage="已识别，保存预设即可"
            />
            <Field label="预设房间密码">
              <input
                type="password"
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={
                  preset.hasRoomPassword ? "已保存，留空保留" : "没有则留空"
                }
                disabled={disabled}
              />
            </Field>
            {preset.hasRoomPassword && (
              <label>
                <input
                  type="checkbox"
                  checked={clearRoomPassword}
                  onChange={(e) => setClearRoomPassword(e.target.checked)}
                />{" "}
                清除房间密码
              </label>
            )}
            <div className="lab-buttons">
              <button className="primary" disabled={disabled || readingQr}>
                <Save size={16} /> 保存预设
              </button>
              {preset.configured && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={async () => {
                    await command(
                      "connection/clear",
                      {},
                      "已清除服务器保存的账号和房间",
                    );
                  }}
                >
                  <Trash2 size={16} /> 清除已保存预设
                </button>
              )}
            </div>
          </form>
        )}
      </details>
    </section>
  );
}

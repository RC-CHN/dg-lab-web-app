import React, { useEffect, useRef, useState } from "react";
import { ClipboardPaste, ImagePlus } from "lucide-react";
import { readRoomQr } from "./room-qr.js";

export default function RoomCodeInput({ value, onChange, disabled, onBusy, label = "远程码或邀请链接", successMessage = "已识别，点击加入房间" }) {
  const input = useRef(), fileInput = useRef(), generation = useRef(0);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState(null);
  const canReadClipboard = !!navigator.clipboard?.read && window.isSecureContext;
  const cancel = () => { generation.current++; setReading(false); onBusy(false); };
  useEffect(() => {
    if (disabled) { cancel(); setMessage(null); }
    return () => { generation.current++; };
  }, [disabled]);
  const read = async (getFile) => {
    if (disabled) return;
    const attempt = ++generation.current;
    setReading(true); onBusy(true); setMessage(null);
    try {
      const code = await readRoomQr(await getFile());
      if (generation.current !== attempt) return;
      onChange(code);
      setMessage({ text: successMessage });
      input.current?.focus();
    } catch (error) {
      if (generation.current === attempt)
        setMessage({ error: true, text: error.name === "NotAllowedError"
          ? "无法读取剪贴板，请直接粘贴或选择图片" : error.message });
    } finally {
      if (generation.current === attempt) { setReading(false); onBusy(false); }
    }
  };
  useEffect(() => {
    if (disabled) return;
    const paste = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') && target !== input.current) return;
      const image = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith("image/"))?.getAsFile();
      if (!image) return;
      event.preventDefault();
      void read(async () => image);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  });
  return (
    <div className="room-code-input" aria-busy={reading}>
      <label className="field">
        <span>{label}</span>
        <input ref={input} placeholder="粘贴邀请链接或二维码图片" autoComplete="off"
          value={value} required disabled={disabled}
          onChange={event => { cancel(); setMessage(null); onChange(event.target.value); }} />
      </label>
      <div className="room-qr-actions">
        {canReadClipboard && <button type="button" disabled={disabled || reading}
          onClick={() => read(async () => {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const type = item.types.find(t => t.startsWith("image/"));
              if (type) return item.getType(type);
            }
            throw new Error("剪贴板中没有图片");
          })}><ClipboardPaste size={16} />粘贴图片</button>}
        <button type="button" disabled={disabled || reading} onClick={() => fileInput.current?.click()}>
          <ImagePlus size={16} />选择二维码图片
        </button>
        <input ref={fileInput} type="file" accept="image/*" hidden aria-label="二维码图片"
          disabled={disabled || reading} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) void read(async () => file);
          }} />
      </div>
      <p className={`room-qr-message ${message?.error ? "error" : ""}`} role={message?.error ? "alert" : "status"}>
        {reading ? "正在识别二维码…" : message?.text || "也可直接粘贴二维码图片"}
      </p>
    </div>
  );
}

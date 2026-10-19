import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
} from "react";
import { Palette, Check, Gamepad2, Sun, CassetteTape } from "lucide-react";
const ThemeContext = createContext(null);
const STORAGE_KEY = "dg-panel-theme";
const valid = (value) =>
  ["arcade", "retro", "classic"].includes(value) ? value : "arcade";
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return valid(localStorage.getItem(STORAGE_KEY));
    } catch {
      return "arcade";
    }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        { arcade: "#090c10", retro: "#e7dfcf", classic: "#151719" }[theme],
      );
  }, [theme]);
  useEffect(() => {
    const sync = (e) => {
      if (e.key === STORAGE_KEY || e.key === null) setTheme(valid(e.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const choose = (value) => {
    setTheme(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* Private browsers can keep a session-only preference. */
    }
  };
  return (
    <ThemeContext.Provider value={{ theme, choose }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeSwitch() {
  const { theme, choose } = useContext(ThemeContext);
  const [open, setOpen] = useState(false);
  const root = useRef(null),
    trigger = useRef(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className="theme-switch"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="theme-trigger"
        aria-label="外观主题"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <Palette size={17} />
        <span>主题</span>
      </button>
      {open && (
        <div
          className="theme-menu"
          id={id}
          role="group"
          aria-label="选择外观主题"
        >
          <p>选择你的控制器外观</p>
          {[
            ["arcade", Gamepad2, "暗黑街机", "荧光双通道 / 实体按键"],
            ["retro", CassetteTape, "复古音响", "奶油机身 / 模拟指针表"],
            ["classic", Sun, "原版暖色", "柔和琥珀 / 经典面板"],
          ].map(([key, Icon, name, description]) => (
            <button
              key={key}
              className={`theme-option theme-${key}`}
              aria-pressed={theme === key}
              onClick={() => {
                choose(key);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span className="theme-swatch">
                <Icon size={22} />
              </span>
              <span>
                <b>{name}</b>
                <small>{description}</small>
              </span>
              {theme === key && <Check size={17} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function DeckSignature() {
  return (
    <div className="deck-signature" aria-hidden="true">
      <span>
        DUAL CHANNEL
        <br />
        REMOTE CONTROLLER
      </span>
      <strong>
        02<span>↗</span>
      </strong>
      <div className="signature-stripes" />
    </div>
  );
}

export function AnalogMeter({ value, max, ready, name }) {
  const known = ready && Number.isFinite(value) && max > 0;
  const ratio = known ? Math.min(1, Math.max(0, value / max)) : 0;
  const point = (r, fraction) => {
    const angle = ((-150 + fraction * 120) * Math.PI) / 180;
    return [150 + Math.cos(angle) * r, 132 + Math.sin(angle) * r];
  };
  return (
    <svg
      className="analog-meter"
      viewBox="0 0 300 146"
      role="img"
      aria-label={`${name}通道强度表，${known ? `当前 ${value}，有效上限 ${max}` : "暂无有效刻度"}`}
      data-ratio={known ? ratio : "unknown"}
    >
      <path className="meter-arc" d="M54.74 77 A110 110 0 0 1 245.26 77" />
      {Array.from({ length: 21 }, (_, i) => {
        const [x1, y1] = point(110, i / 20),
          [x2, y2] = point(i % 5 === 0 ? 96 : 103, i / 20);
        return (
          <line
            key={i}
            className={i >= 17 ? "meter-tick hot" : "meter-tick"}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
          />
        );
      })}
      <text x="38" y="70">
        0
      </text>
      <text x="150" y="13">
        50
      </text>
      <text x="264" y="70">
        100
      </text>
      <text className="meter-legend" x="150" y="99">
        % OF LIMIT
      </text>
      {known && (
        <line
          className="meter-needle"
          x1="150"
          y1="132"
          x2="150"
          y2="29"
          style={{
            transformOrigin: "150px 132px",
            transform: `rotate(${(ratio - 0.5) * 120}deg)`,
            transition: "transform 180ms linear",
          }}
        />
      )}
      <circle className="meter-pivot" cx="150" cy="132" r="6" />
      {!known && (
        <text x="150" y="120">
          —
        </text>
      )}
    </svg>
  );
}

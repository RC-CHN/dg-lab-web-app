import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function useLab({ device, state, notify }) {
  const live = useRef(null),
    patches = useRef(new Map()),
    stopping = useRef(null),
    generation = useRef(0),
    [pending, setPending] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const patchFor = (source) => {
    if (!patches.current.has(source))
      patches.current.set(source, { current: {} });
    return patches.current.get(source);
  };
  const stop = async (source) => {
    const r =
      live.current ||
      (stateRef.current.lab?.running ? stateRef.current.lab : null);
    if (source && r?.source !== source) return;
    generation.current++;
    live.current = null;
    if (!r) return stopping.current;
    patchFor(r.source).current = {};
    const request = api("lab/stop", { runId: r.runId, epoch: r.epoch }).catch(
      () => undefined,
    );
    stopping.current = request;
    const result = await request;
    if (stopping.current === request) stopping.current = null;
    return result;
  };
  const start = async (config) => {
    const stopped = await stop();
    const attempt = ++generation.current;
    setPending(true);
    try {
      const r = await api("lab/start", {
        id: device?.id,
        epoch: stateRef.current.controlEpoch,
        revision: stopped?.revision ?? stateRef.current.lab?.revision,
        config,
      });
      if (attempt !== generation.current) {
        await api("lab/stop", { runId: r.runId, epoch: r.epoch }).catch(
          () => {},
        );
        return null;
      }
      live.current = {
        ...r,
        seq: r.sequence ?? -1,
        busy: false,
        lastUpdate: 0,
        lastPatch: "",
      };
      return r;
    } catch (e) {
      notify(e.message, true);
      return null;
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    const timer = setInterval(async () => {
      const r = live.current;
      if (!r || r.busy) return;
      const now = performance.now();
      if (r.mode !== "stream" && now - r.lastUpdate < 190) return;
      const patch = patchFor(r.source).current,
        signature = JSON.stringify(patch);
      // Prepared runs need no browser heartbeat. Only send actual knob changes.
      if (r.autonomous && (signature === "{}" || signature === r.lastPatch))
        return;
      r.lastUpdate = now;
      r.busy = true;
      try {
        await api("lab/update", {
          runId: r.runId,
          epoch: r.epoch,
          seq: ++r.seq,
          ...patch,
        });
        r.lastPatch = signature;
      } catch (e) {
        if (live.current === r) {
          live.current = null;
          patchFor(r.source).current = {};
          notify(e.message, true);
        }
      } finally {
        r.busy = false;
      }
    }, 100);
    const releaseLiveInput = () => {
      if (live.current && !live.current.autonomous) stop();
    };
    const visibility = () => {
      if (document.hidden) releaseLiveInput();
    };
    window.addEventListener("blur", releaseLiveInput);
    window.addEventListener("pagehide", releaseLiveInput);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      generation.current++;
      releaseLiveInput();
      window.removeEventListener("blur", releaseLiveInput);
      window.removeEventListener("pagehide", releaseLiveInput);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    const r = state.lab;
    if (
      !r?.running ||
      state.status !== "connected" ||
      r.epoch !== state.controlEpoch
    ) {
      live.current = null;
    } else if (r.autonomous && live.current?.runId !== r.runId) {
      patchFor(r.source).current = {};
      live.current = {
        ...r,
        seq: r.sequence ?? -1,
        busy: false,
        lastUpdate: 0,
        lastPatch: "",
      };
    } else if (live.current?.runId === r.runId) {
      live.current.seq = Math.max(live.current.seq, r.sequence ?? -1);
    } else if (live.current && live.current.runId !== r.runId)
      live.current = null;
  }, [state.lab, state.controlEpoch, state.status]);
  const scoped = (source) => ({
    start: (config) => start({ ...config, source }),
    stop: () => stop(source),
    patch: patchFor(source),
    pending,
    live,
  });
  return { start, stop: () => stop(), scoped, pending, live };
}

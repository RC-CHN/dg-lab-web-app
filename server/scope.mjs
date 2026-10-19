// Samples successful outgoing wave commands. These are NOT electrical measurements.
// Priority 2 is the temporary touch overlay; priority 1 is the underlying player.
export class ScopeHistory {
  constructor(changed) {
    this.changed = changed;
    this.devices = new Map();
    this.timer = null;
    this.ticks = 0;
  }
  capture(actions, now = Date.now()) {
    let touched = false;
    for (const a of actions) {
      if (a.t !== 0 || a.ver !== 2 || !Array.isArray(a.v) || !a.v.length)
        continue;
      if (a.c !== 0 && a.c !== 1) continue;
      let d = this.devices.get(a.s);
      if (!d) {
        d = {
          deviceId: a.s,
          lanes: [new Map(), new Map()],
          samples: [],
          lastSentAt: [0, 0],
        };
        this.devices.set(a.s, d);
      }
      d.lanes[a.c].set(a.p ?? 1, {
        frames: a.v.map((f) => [...f]),
        at: now,
        until: now + a.d,
      });
      d.lastSentAt[a.c] = now;
      touched = true;
    }
    if (!touched) return;
    if (!this.timer) {
      this.sample(now);
      this.timer = setInterval(() => {
        this.sample();
        if (++this.ticks % 2 === 0) this.changed();
        if (
          [...this.devices.values()].every(
            (d) => Date.now() - Math.max(...d.lastSentAt) > 8200,
          )
        ) {
          clearInterval(this.timer);
          this.timer = null;
          this.changed();
        }
      }, 100);
      this.timer.unref();
    }
  }
  current(d, now) {
    return d.lanes.map((lane) => {
      let task;
      for (const [priority, value] of [...lane].sort((a, b) => b[0] - a[0])) {
        if (value.until <= now) {
          lane.delete(priority);
          continue;
        }
        task = value;
        break;
      }
      return task
        ? [
            ...task.frames[
              Math.min(
                task.frames.length - 1,
                Math.floor((now - task.at) / 100),
              )
            ],
          ]
        : [0, 0, 0];
    });
  }
  sample(now = Date.now()) {
    for (const d of this.devices.values()) {
      const frames = this.current(d, now);
      d.samples.push([now, ...frames[0], ...frames[1]]);
      d.samples = d.samples.filter((s) => now - s[0] <= 8000).slice(-82);
    }
  }
  snapshot(now = Date.now()) {
    return [...this.devices.values()].map((d) => ({
      deviceId: d.deviceId,
      frames: this.current(d, now),
      lastSentAt: [...d.lastSentAt],
      samples: d.samples,
    }));
  }
  remove(id) {
    this.devices.delete(id);
  }
  clear() {
    clearInterval(this.timer);
    this.timer = null;
    this.devices.clear();
  }
}

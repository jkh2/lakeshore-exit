export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let engineGain: GainNode | null = null;
  let muted = false;
  let yelled = false;

  function ensure() {
    if (ctx && master) return ctx;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("no audio");
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);

    const seconds = 2;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.65;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    src.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    src.start();

    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = "sawtooth";
    o2.type = "sawtooth";
    o1.frequency.value = 76;
    o2.frequency.value = 81;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(engineGain);
    engineGain.connect(master);
    o1.start();
    o2.start();
    return ctx;
  }

  function beep(freq: number, delay: number, dur: number, vol: number, type: OscillatorType = "square") {
    if (!ctx || !master || muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    resume() {
      try {
        const c = ensure();
        if (c.state === "suspended") void c.resume();
      } catch {
        /* ignore */
      }
    },
    setMuted(next: boolean) {
      muted = next;
      if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.7, ctx.currentTime, 0.05);
    },
    update(wind: number, engine: number, airspeed: number) {
      try {
        if (!ctx || !windGain || !engineGain || !windFilter) return;
        const w = muted ? 0 : wind;
        const e = muted ? 0 : engine;
        windGain.gain.setTargetAtTime(w, ctx.currentTime, 0.12);
        engineGain.gain.setTargetAtTime(e, ctx.currentTime, 0.15);
        windFilter.frequency.setTargetAtTime(
          280 + Math.min(airspeed, 90) * 16,
          ctx.currentTime,
          0.2,
        );
      } catch {
        /* ignore */
      }
    },
    beep(freq: number, dur = 0.12, vol = 0.07) {
      try {
        ensure();
        beep(freq, 0, dur, vol);
      } catch {
        /* ignore */
      }
    },
    triple() {
      try {
        ensure();
        beep(860, 0, 0.1, 0.08);
        beep(860, 0.16, 0.1, 0.08);
        beep(1040, 0.34, 0.16, 0.09);
      } catch {
        /* ignore */
      }
    },
    fabric() {
      try {
        if (!ctx || !master || muted) {
          ensure();
        }
        if (!ctx || !master || muted) return;
        const dur = 0.28;
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const ch = buffer.getChannelData(0);
        for (let i = 0; i < ch.length; i++) {
          const t = i / ch.length;
          ch[i] = (Math.random() * 2 - 1) * (1 - t);
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.2, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        src.connect(f);
        f.connect(g);
        g.connect(master);
        src.start();
      } catch {
        /* ignore */
      }
    },
    alarm() {
      try {
        ensure();
        beep(220, 0, 0.22, 0.08, "sawtooth");
        beep(180, 0.18, 0.28, 0.08, "sawtooth");
      } catch {
        /* ignore */
      }
    },
    /** Cartoon yell, then a slap. Fatal impacts only. */
    death() {
      try {
        const c = ensure();
        if (muted || yelled || !master) return;
        yelled = true;
        if (c.state === "suspended") void c.resume();
        const now = c.currentTime;
        if (windGain) windGain.gain.setValueAtTime(0, now);
        if (engineGain) engineGain.gain.setValueAtTime(0, now);

        const o = c.createOscillator();
        const o2 = c.createOscillator();
        o.type = "sawtooth";
        o2.type = "triangle";
        o.frequency.setValueAtTime(820, now + 0.02);
        o.frequency.exponentialRampToValueAtTime(520, now + 0.22);
        o.frequency.exponentialRampToValueAtTime(190, now + 0.62);
        o2.frequency.setValueAtTime(860, now + 0.02);
        o2.frequency.exponentialRampToValueAtTime(210, now + 0.62);
        const lfo = c.createOscillator();
        const lfoG = c.createGain();
        lfo.frequency.setValueAtTime(9, now + 0.02);
        lfo.frequency.linearRampToValueAtTime(22, now + 0.5);
        lfoG.gain.value = 42;
        lfo.connect(lfoG);
        lfoG.connect(o.frequency);
        lfo.start(now + 0.02);
        lfo.stop(now + 0.68);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 4.5;
        bp.frequency.setValueAtTime(1800, now + 0.02);
        bp.frequency.exponentialRampToValueAtTime(420, now + 0.6);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.34, now + 0.06);
        g.gain.setValueAtTime(0.28, now + 0.34);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.66);
        o.connect(bp);
        o2.connect(bp);
        bp.connect(g);
        g.connect(master);
        o.start(now + 0.02);
        o2.start(now + 0.02);
        o.stop(now + 0.7);
        o2.stop(now + 0.7);

        const splatAt = now + 0.5;
        const dur = 0.22;
        const sbuf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
        const sd = sbuf.getChannelData(0);
        for (let i = 0; i < sd.length; i++) {
          const t = i / sd.length;
          sd[i] = (Math.random() * 2 - 1) * (1 - t) * (1 - t);
        }
        const ssrc = c.createBufferSource();
        ssrc.buffer = sbuf;
        const slp = c.createBiquadFilter();
        slp.type = "lowpass";
        slp.frequency.setValueAtTime(1800, splatAt);
        slp.frequency.exponentialRampToValueAtTime(70, splatAt + dur);
        const sg = c.createGain();
        sg.gain.setValueAtTime(0.85, splatAt);
        sg.gain.exponentialRampToValueAtTime(0.0001, splatAt + dur);
        ssrc.connect(slp);
        slp.connect(sg);
        sg.connect(master);
        ssrc.start(splatAt);

        const th = c.createOscillator();
        th.type = "sine";
        th.frequency.setValueAtTime(190, splatAt);
        th.frequency.exponentialRampToValueAtTime(32, splatAt + 0.28);
        const tg = c.createGain();
        tg.gain.setValueAtTime(0.72, splatAt);
        tg.gain.exponentialRampToValueAtTime(0.0001, splatAt + 0.3);
        th.connect(tg);
        tg.connect(master);
        th.start(splatAt);
        th.stop(splatAt + 0.32);
      } catch {
        /* ignore */
      }
    },
    resetDeath() {
      yelled = false;
    },
    dispose() {
      windGain = null;
      engineGain = null;
      master = null;
      if (ctx) void ctx.close();
      ctx = null;
    },
  };
}

export type AudioBus = ReturnType<typeof createAudio>;

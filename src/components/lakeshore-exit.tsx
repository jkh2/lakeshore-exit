import { useEffect, useRef, useState, type PointerEvent } from "react";
import { clsx } from "clsx";
import { AlertTriangle, Plane, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { cardinal, describeOutcome } from "@/game/grade";
import { loadSave } from "@/game/save";
import {
  DECISION_FT,
  DEFAULT_EXIT_FT,
  DEFAULT_MAL_PCT,
  HARD_DECK_FT,
  MAX_EXIT_FT,
  MIN_EXIT_FT,
  PULL_NOW_FT,
} from "@/game/constants";
import { createBridge, type Bridge, type Hud, type Outcome, type Phase } from "@/game/types";

function commas(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function holdPulse(set: (v: boolean) => void) {
  let timer = 0;
  return {
    down(e: PointerEvent) {
      e.preventDefault();
      e.stopPropagation();
      window.clearTimeout(timer);
      set(true);
    },
    up() {
      timer = window.setTimeout(() => set(false), 90);
    },
  };
}

export function LakeshoreExit() {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const tapeRef = useRef<HTMLCanvasElement>(null);
  const altRef = useRef<HTMLDivElement>(null);
  const fallRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const dzRef = useRef<HTMLDivElement>(null);
  const dzArrowRef = useRef<HTMLDivElement>(null);
  const doorRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<Bridge>(createBridge());
  const onFrame = useRef<(hud: Hud) => void>(() => {});

  const [phase, setPhase] = useState<Phase>("menu");
  const [banner, setBanner] = useState("");
  const [bannerLevel, setBannerLevel] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [needsLook, setNeedsLook] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [canopy, setCanopy] = useState<"none" | "main" | "reserve">("none");
  const [altitudeFt, setAltitudeFt] = useState(DEFAULT_EXIT_FT);
  const [malPct, setMalPct] = useState(DEFAULT_MAL_PCT);
  const [muted, setMuted] = useState(false);
  const [bootError, setBootError] = useState("");
  const [record, setRecord] = useState({ bestM: null as number | null, jumps: 0, rides: 0 });

  const cache = useRef({
    phase: "menu" as Phase,
    banner: "",
    level: 0,
    prompt: "",
    needsLook: false,
    outcome: null as Outcome | null,
    canopy: "none" as "none" | "main" | "reserve",
    jumps: -1,
    best: null as number | null,
    rides: -1,
  });

  onFrame.current = (hud) => {
    if (altRef.current) altRef.current.textContent = commas(hud.altitudeFt);
    if (fallRef.current) fallRef.current.textContent = `${Math.round(hud.fallMph)}`;
    if (groundRef.current) groundRef.current.textContent = `${Math.round(hud.groundMph)}`;
    if (compassRef.current) {
      compassRef.current.textContent = `${String(Math.round(hud.compassDeg)).padStart(3, "0")}° ${cardinal(hud.compassDeg)}`;
    }
    if (spotRef.current) spotRef.current.textContent = hud.spot;
    if (poseRef.current) poseRef.current.textContent = hud.pose;
    if (dzRef.current) dzRef.current.textContent = `${Math.round(hud.dzDist)} m`;
    if (dzArrowRef.current) dzArrowRef.current.style.transform = `rotate(${-hud.dzRel}deg)`;
    if (doorRef.current) {
      doorRef.current.style.opacity = hud.doorVisible ? "1" : "0";
      doorRef.current.style.left = `${hud.doorU * 100}%`;
      doorRef.current.style.top = `${hud.doorV * 100}%`;
    }
    if (lightRef.current) {
      lightRef.current.textContent = hud.green ? "GREEN LIGHT" : "RED LIGHT";
      lightRef.current.classList.toggle("is-green", hud.green);
      lightRef.current.classList.toggle("is-red", !hud.green);
    }
    const c = cache.current;
    if (c.phase !== hud.phase) {
      c.phase = hud.phase;
      setPhase(hud.phase);
    }
    if (c.banner !== hud.banner) {
      c.banner = hud.banner;
      setBanner(hud.banner);
    }
    if (c.level !== hud.bannerLevel) {
      c.level = hud.bannerLevel;
      setBannerLevel(hud.bannerLevel);
    }
    if (c.prompt !== hud.prompt) {
      c.prompt = hud.prompt;
      setPrompt(hud.prompt);
    }
    if (c.needsLook !== hud.needsLook) {
      c.needsLook = hud.needsLook;
      setNeedsLook(hud.needsLook);
    }
    if (c.outcome !== hud.outcome) {
      c.outcome = hud.outcome;
      setOutcome(hud.outcome);
    }
    if (c.canopy !== hud.canopy) {
      c.canopy = hud.canopy;
      setCanopy(hud.canopy);
    }
    if (c.jumps !== hud.save.jumps || c.best !== hud.save.bestM || c.rides !== hud.save.rides) {
      c.jumps = hud.save.jumps;
      c.best = hud.save.bestM;
      c.rides = hud.save.rides;
      setRecord({ bestM: hud.save.bestM, jumps: hud.save.jumps, rides: hud.save.rides });
    }
  };

  useEffect(() => {
    const saved = loadSave();
    const alt = Math.min(MAX_EXIT_FT, Math.max(MIN_EXIT_FT, saved.altitudeFt));
    const mal = Math.min(40, Math.max(0, saved.malPct));
    bridgeRef.current.altitudeFt = alt;
    bridgeRef.current.malChance = mal / 100;
    setAltitudeFt(alt);
    setMalPct(mal);
    setRecord({ bestM: saved.bestM, jumps: saved.jumps, rides: saved.rides });
    const bridge = bridgeRef.current;
    let stop = () => {};
    let gone = false;
    void import("@/game/engine")
      .then((mod) => {
        if (gone || !viewRef.current) return;
        stop = mod.mountGame(viewRef.current, tapeRef, bridge, (hud) => onFrame.current(hud));
      })
      .catch((err: unknown) => {
        if (!gone) setBootError(err instanceof Error ? err.message : "Could not start the jump");
      });
    return () => {
      gone = true;
      stop();
    };
  }, []);

  const bridge = bridgeRef.current;
  const air = phase === "freefall" || phase === "deploying" || phase === "malfunction" || phase === "canopy";
  const showHud = phase !== "menu" && !outcome;
  const copy = outcome ? describeOutcome(outcome) : null;
  const jumpPulse = holdPulse((v) => {
    bridge.jump = v;
  });
  const pullPulse = holdPulse((v) => {
    bridge.pull = v;
  });
  const cutPulse = holdPulse((v) => {
    bridge.cut = v;
  });
  const reservePulse = holdPulse((v) => {
    bridge.reserve = v;
  });

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink text-fg">
      <canvas ref={viewRef} className="absolute inset-0 h-full w-full touch-none" />
      <div className="visor pointer-events-none absolute inset-0" />

      {showHud ? (
        <div className="pointer-events-none absolute inset-0">
          <div
            ref={doorRef}
            className="absolute -translate-x-1/2 -translate-y-1/2 font-display text-sm tracking-widest text-amber"
          >
            DOOR
          </div>
          {banner ? (
            <div
              role="alert"
              className={clsx(
                "absolute top-14 left-1/2 w-[min(40rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md px-4 py-3 text-center font-display text-3xl font-semibold tracking-wide text-ink md:top-6 md:text-5xl",
                bannerLevel >= 2 ? "warning-fast bg-signal" : "warning-live bg-amber",
              )}
            >
              {banner}
            </div>
          ) : null}

          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <div ref={lightRef} className="light-pill w-fit rounded-sm px-2 py-1 font-display text-sm tracking-widest" />
            <div ref={spotRef} className="font-display text-lg tracking-wide text-fg" />
            <div ref={compassRef} className="font-display text-2xl tabular-nums text-fg" />
          </div>

          <div className="absolute top-4 right-4 text-right">
            <div className="font-display text-xs tracking-widest text-muted">
              {canopy === "reserve" ? "RESERVE" : canopy === "main" ? "MAIN" : phase === "cabin" ? "CABIN" : "FREEFALL"}
            </div>
            <div className="mt-2 font-display text-sm text-muted">
              FALL <span ref={fallRef} className="text-fg tabular-nums" /> MPH
            </div>
            <div className="font-display text-sm text-muted">
              GROUND <span ref={groundRef} className="text-fg tabular-nums" /> MPH
            </div>
            <div ref={poseRef} className="mt-1 font-display text-lg tracking-widest text-amber" />
          </div>

          <div className="absolute bottom-28 left-4 flex items-end gap-3 md:bottom-8">
            <canvas ref={tapeRef} width={168} height={560} className="h-52 w-16 rounded-sm md:h-72 md:w-20" />
            <div>
              <div ref={altRef} className="font-display text-5xl leading-none tabular-nums md:text-7xl" />
              <div className="mt-1 font-display text-sm tracking-widest text-muted">FT AGL</div>
              {air ? (
                <p className="mt-2 max-w-44 font-display text-sm leading-tight text-amber">
                  Critical pull {commas(DECISION_FT)}
                  <span className="mt-1 block text-signal">Hard deck {commas(HARD_DECK_FT)}</span>
                </p>
              ) : null}
            </div>
          </div>

          {prompt ? (
            <div className="absolute bottom-36 left-1/2 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 text-center font-display text-xl tracking-wide text-fg md:bottom-10">
              {prompt}
            </div>
          ) : null}

          <div
            className={clsx(
              "absolute bottom-36 left-1/2 -translate-x-1/2 items-center gap-2",
              air ? "flex" : "hidden",
            )}
          >
            <div ref={dzArrowRef} className="grid size-8 place-items-center text-amber">
              <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
                <path d="M12 3 L16 14 H13 L13 21 H11 L11 14 H8 Z" fill="currentColor" />
              </svg>
            </div>
            <div className="font-display text-lg tabular-nums">
              DZ <span ref={dzRef} />
            </div>
          </div>

          <p className="absolute right-4 bottom-4 hidden max-w-xs text-right text-sm text-muted md:block">
            {phase === "cabin"
              ? "WASD walk · mouse look · space jumps from the door"
              : phase === "freefall"
                ? "A/D turn · W arch · S dive · space pulls"
                : phase === "malfunction"
                  ? "X cut away · R reserve"
                  : phase === "canopy"
                    ? "A/D turn · W drive · S flare · land facing the lake"
                    : "Opening"}
          </p>

          {needsLook ? (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-panel/80 px-4 py-2 font-display tracking-widest text-fg">
              CLICK TO LOOK
            </div>
          ) : null}

          <div className="touch-ui pointer-events-auto absolute bottom-4 left-4">
            <Stick
              onChange={(x, y) => {
                bridge.moveX = x;
                bridge.moveY = y;
              }}
            />
          </div>
          <div className="touch-ui pointer-events-auto absolute right-4 bottom-4 flex flex-col gap-2">
            {phase === "cabin" ? (
              <TouchButton label="JUMP" onDown={jumpPulse.down} onUp={jumpPulse.up} />
            ) : null}
            {phase === "freefall" ? (
              <TouchButton label="PULL" onDown={pullPulse.down} onUp={pullPulse.up} />
            ) : null}
            {phase === "malfunction" ? (
              <>
                <TouchButton label="CUT AWAY" onDown={cutPulse.down} onUp={cutPulse.up} />
                <TouchButton label="RESERVE" onDown={reservePulse.down} onUp={reservePulse.up} />
              </>
            ) : null}
            {phase === "canopy" ? (
              <TouchButton
                label="FLARE"
                onDown={(e) => {
                  e.preventDefault();
                  bridge.flare = true;
                }}
                onUp={() => {
                  bridge.flare = false;
                }}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <canvas ref={tapeRef} width={168} height={560} className="hidden" />
      )}

      <button
        type="button"
        className="pointer-events-auto absolute top-3 left-1/2 z-20 grid size-11 -translate-x-1/2 place-items-center rounded-md border border-line bg-panel/80 text-fg"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={() => {
          const next = !bridge.muted;
          bridge.muted = next;
          setMuted(next);
        }}
      >
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>

      {phase === "menu" ? (
        <aside className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[86dvh] overflow-y-auto p-3 md:inset-y-0 md:left-0 md:w-[26rem] md:max-h-none md:p-6">
          <div className="rounded-2xl border border-line bg-panel/90 p-5 backdrop-blur-md">
            <div className="flex items-center gap-2 text-amber">
              <Plane className="size-5" aria-hidden="true" />
              <p className="font-display text-sm tracking-[0.22em]">TWIN OTTER · CHICAGO</p>
            </div>
            <h1 className="mt-2 font-display text-5xl leading-none font-semibold tracking-wide">Lakeshore Exit</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Look around the cabin, walk to the door, and leave over Lake Michigan. The beach is west. The breeze is off the lake.
            </p>

            <label className="mt-5 block" htmlFor="exit-alt">
              <span className="flex items-baseline justify-between font-display text-lg tracking-wide">
                Exit altitude
                <span className="tabular-nums text-amber">{commas(altitudeFt)} ft</span>
              </span>
              <input
                id="exit-alt"
                type="range"
                min={MIN_EXIT_FT}
                max={MAX_EXIT_FT}
                step={500}
                value={altitudeFt}
                suppressHydrationWarning
                onChange={(e) => {
                  const v = Number(e.target.value);
                  bridge.altitudeFt = v;
                  setAltitudeFt(v);
                }}
              />
              <span className="text-xs text-muted">8,000 to 20,000 ft above the lake</span>
            </label>

            <label className="mt-4 block" htmlFor="mal-chance">
              <span className="flex items-baseline justify-between font-display text-lg tracking-wide">
                Main malfunction
                <span className="tabular-nums text-amber">{malPct}%</span>
              </span>
              <input
                id="mal-chance"
                type="range"
                min={0}
                max={40}
                step={1}
                value={malPct}
                suppressHydrationWarning
                onChange={(e) => {
                  const v = Number(e.target.value);
                  bridge.malChance = v / 100;
                  setMalPct(v);
                }}
              />
              <span className="text-xs text-muted">If it fails: cut away, then reserve. You will not have long.</span>
            </label>

            <div className="mt-5 flex gap-3 rounded-lg border border-line bg-ink/60 p-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" />
              <div className="text-sm leading-relaxed">
                <p className="font-display text-lg tracking-wide text-amber">Critical altitude {commas(DECISION_FT)} ft</p>
                <p className="mt-1 text-muted">
                  The altimeter yells when you pass it still in freefall. Pull there. Hard deck is {commas(HARD_DECK_FT)} ft.
                  Below {commas(PULL_NOW_FT)} the warning does not let up.
                </p>
              </div>
            </div>

            <button
              type="button"
              className="mt-5 h-12 w-full rounded-md bg-amber font-display text-xl tracking-widest text-ink"
              onClick={() => {
                bridge.command = "start";
              }}
            >
              Start the jump
            </button>
            {bootError ? <p className="mt-3 text-sm text-signal">{bootError}</p> : null}
            {record.jumps > 0 ? (
              <p className="mt-3 text-sm text-muted">
                {record.jumps} jumps · {record.rides} rides down
                {record.bestM !== null ? ` · best ${record.bestM} m` : ""}
              </p>
            ) : null}

            <ul className="mt-4 space-y-1 text-sm text-muted">
              <li>Cabin: look around, WASD to the door, space to exit.</li>
              <li>Freefall: A and D turn, W arches, S dives, space pulls.</li>
              <li>Canopy: A and D turn, S flares. Land facing the lake, into the wind.</li>
            </ul>
          </div>
        </aside>
      ) : null}

      <div className={clsx("impact-black absolute inset-0 z-30", phase === "impact" && "is-on")} />

      {outcome && copy ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center p-4">
          <section
            className={clsx(
              "pointer-events-auto w-full max-w-md rounded-2xl border border-line bg-panel p-5",
              outcome.kind === "impact" && "debrief-late",
            )}
          >
            <p className="font-display text-sm tracking-[0.2em] text-muted">DEBRIEF</p>
            <h2 className="mt-1 font-display text-5xl leading-none font-semibold">{copy.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{copy.lede}</p>
            <ol className="mt-4 space-y-1 text-sm text-fg">
              {outcome.log.map((line, i) => (
                <li key={`${line}-${i}`}>{line}</li>
              ))}
            </ol>
            <button
              type="button"
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-amber font-display text-xl tracking-widest text-ink"
              onClick={() => {
                bridge.command = "again";
              }}
            >
              <RotateCcw className="size-5" aria-hidden="true" />
              Back to the manifest
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function TouchButton({
  label,
  onDown,
  onUp,
}: {
  label: string;
  onDown: (e: PointerEvent) => void;
  onUp: () => void;
}) {
  return (
    <button
      type="button"
      className="h-14 min-w-24 rounded-md bg-amber px-3 font-display text-lg tracking-widest text-ink"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
    >
      {label}
    </button>
  );
}

function Stick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef(0);

  function apply(clientX: number, clientY: number) {
    const el = pad.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = (clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    setKnob({ x: x * 32, y: y * 32 });
    onChange(x, -y);
  }

  return (
    <div
      ref={pad}
      className="relative size-28 rounded-full border border-line bg-panel/70"
      onPointerDown={(e) => {
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== id.current) return;
        apply(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== id.current) return;
        id.current = 0;
        setKnob({ x: 0, y: 0 });
        onChange(0, 0);
      }}
    >
      <div
        className="absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

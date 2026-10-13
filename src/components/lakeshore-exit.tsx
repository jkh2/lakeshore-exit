import { useEffect, useRef, useState, type PointerEvent } from "react";
import { clsx } from "clsx";
import { AlertTriangle, Bird, Building2, Plane, RotateCcw, Star, Volume2, VolumeX } from "lucide-react";
import { cardinal, describeOutcome } from "@/game/grade";
import { loadSave, writeSave } from "@/game/save";
import {
  BASE_HARD_FT,
  BASE_PULL_FT,
  DECISION_FT,
  DEFAULT_EXIT_FT,
  FT_PER_M,
  DEFAULT_MAL_PCT,
  HARD_DECK_FT,
  LIGHTS,
  MAX_EXIT_FT,
  MIN_EXIT_FT,
  PADS,
} from "@/game/constants";
import {
  createBridge,
  type Bridge,
  type Hud,
  type JumpMode,
  type JumpScore,
  type Light,
  type Outcome,
  type PadId,
  type Phase,
  type Ride,
  type Suit,
} from "@/game/types";

const LIGHT_LABEL: Record<Light, string> = { day: "Midday", golden: "Golden hour", dusk: "Dusk" };

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
  const dzLabelRef = useRef<HTMLSpanElement>(null);
  const doorRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const baseLabelRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<Bridge>(createBridge());
  const onFrame = useRef<(hud: Hud) => void>(() => {});

  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<JumpMode>("skydive");
  const [ride, setRide] = useState<Ride>("plane");
  const [roof, setRoof] = useState<PadId>("southloop");
  const [suit, setSuit] = useState<Suit>("rig");
  const [banner, setBanner] = useState("");
  const [bannerLevel, setBannerLevel] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [needsLook, setNeedsLook] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [canopy, setCanopy] = useState<"none" | "main" | "reserve">("none");
  const [altitudeFt, setAltitudeFt] = useState(DEFAULT_EXIT_FT);
  const [malPct, setMalPct] = useState(DEFAULT_MAL_PCT);
  const [muted, setMuted] = useState(false);
  const [light, setLight] = useState<Light | null>(null);
  const [bootError, setBootError] = useState("");
  const [record, setRecord] = useState<Hud["save"]>({ bestM: null, bestScore: null, jumps: 0, rides: 0 });

  const cache = useRef({
    phase: "menu" as Phase,
    mode: "skydive" as JumpMode,
    banner: "",
    level: 0,
    prompt: "",
    needsLook: false,
    outcome: null as Outcome | null,
    canopy: "none" as "none" | "main" | "reserve",
    jumps: -1,
    best: null as number | null,
    bestScore: null as number | null,
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
    if (dzLabelRef.current) dzLabelRef.current.textContent = hud.dzLabel;
    if (dzArrowRef.current) dzArrowRef.current.style.transform = `rotate(${-hud.dzRel}deg)`;
    if (doorRef.current) {
      doorRef.current.style.opacity = hud.doorVisible ? "1" : "0";
      doorRef.current.style.left = `${hud.doorU * 100}%`;
      doorRef.current.style.top = `${hud.doorV * 100}%`;
    }
    if (baseRef.current) {
      baseRef.current.style.opacity = hud.baseVisible ? "1" : "0";
      baseRef.current.style.left = `${hud.baseU * 100}%`;
      baseRef.current.style.top = `${hud.baseV * 100}%`;
    }
    if (baseLabelRef.current) baseLabelRef.current.textContent = hud.baseLabel;
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
    if (c.mode !== hud.mode) {
      c.mode = hud.mode;
      setMode(hud.mode);
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
    const s = hud.save;
    if (c.jumps !== s.jumps || c.best !== s.bestM || c.bestScore !== s.bestScore || c.rides !== s.rides) {
      c.jumps = s.jumps;
      c.best = s.bestM;
      c.bestScore = s.bestScore;
      c.rides = s.rides;
      setRecord({ ...s });
    }
  };

  useEffect(() => {
    const saved = loadSave();
    const alt = Math.min(MAX_EXIT_FT, Math.max(MIN_EXIT_FT, saved.altitudeFt));
    const mal = Math.min(40, Math.max(0, saved.malPct));
    bridgeRef.current.altitudeFt = alt;
    bridgeRef.current.malChance = mal / 100;
    bridgeRef.current.ride = saved.ride;
    bridgeRef.current.roof = saved.roof;
    bridgeRef.current.suit = saved.suit;
    setAltitudeFt(alt);
    setMalPct(mal);
    setRide(saved.ride);
    setRoof(saved.roof);
    setSuit(saved.suit);
    setRecord({ bestM: saved.bestM, bestScore: saved.bestScore, jumps: saved.jumps, rides: saved.rides });
    setLight(saved.light);
  }, []);

  // A new time of day rebuilds the world on a fresh canvas behind the menu.
  useEffect(() => {
    if (!light) return;
    const bridge = bridgeRef.current;
    bridge.light = light;
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
  }, [light]);

  const bridge = bridgeRef.current;
  const air = phase === "freefall" || phase === "deploying" || phase === "malfunction" || phase === "canopy";
  const base = mode === "base";
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
  const choose = (r: Ride, pad: PadId) => {
    bridge.ride = r;
    bridge.roof = pad;
    setRide(r);
    setRoof(pad);
    writeSave({ ...loadSave(), ride: r, roof: pad });
  };
  const fromRoof = ride === "roof";
  const chooseSuit = (next: Suit) => {
    bridge.suit = next;
    setSuit(next);
    writeSave({ ...loadSave(), suit: next });
  };
  const winged = suit === "wing";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink text-fg">
      <canvas key={light ?? "boot"} ref={viewRef} className="absolute inset-0 h-full w-full touch-none" />
      <div className="visor pointer-events-none absolute inset-0" />

      {showHud ? (
        <div className="hud-ink pointer-events-none absolute inset-0">
          <div
            ref={doorRef}
            className="absolute -translate-x-1/2 -translate-y-1/2 font-display text-sm tracking-widest text-amber"
          >
            DOOR
          </div>
          <div ref={baseRef} className="absolute opacity-0">
            <div
              className="absolute size-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber/90"
            />
            <div
              ref={baseLabelRef}
              className="absolute bottom-6 -translate-x-1/2 rounded-sm bg-panel/60 px-1.5 font-display text-sm whitespace-nowrap tracking-widest text-amber"
            />
          </div>
          {banner ? (
            <div
              role="alert"
              className={clsx(
                "absolute top-14 left-1/2 w-[min(40rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md px-4 py-3 text-center font-display text-3xl font-semibold tracking-wide text-ink desk:top-6 desk:text-5xl",
                bannerLevel >= 2 ? "warning-fast bg-signal" : "warning-live bg-amber",
              )}
            >
              {banner}
            </div>
          ) : null}

          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <div ref={compassRef} className="font-display text-2xl tabular-nums text-fg" />
          </div>

          {/* Before the jump the jump light and the time to green sit front and center. */}
          {phase === "cabin" ? (
            <div className="absolute top-[30%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-center short:top-[44%] short:gap-1">
              <div
                ref={lightRef}
                className="light-pill rounded-sm px-3 py-1 font-display text-lg tracking-widest"
              />
              <div
                ref={spotRef}
                className="font-display text-5xl leading-none whitespace-nowrap tabular-nums text-fg short:text-4xl desk:text-6xl"
              />
            </div>
          ) : null}

          <div className="absolute top-4 right-4 text-right">
            <div className="font-display text-xs tracking-widest text-muted">
              {canopy === "reserve"
                ? "RESERVE"
                : canopy === "main"
                  ? "MAIN"
                  : phase === "cabin"
                    ? "CABIN"
                    : phase === "roof"
                      ? "ROOF"
                      : base
                        ? "BASE"
                        : "FREEFALL"}
            </div>
            <div className="mt-2 font-display text-sm text-muted">
              FALL <span ref={fallRef} className="text-fg tabular-nums" /> MPH
            </div>
            <div className="font-display text-sm text-muted">
              GROUND <span ref={groundRef} className="text-fg tabular-nums" /> MPH
            </div>
            <div ref={poseRef} className="mt-1 font-display text-lg tracking-widest text-amber" />
          </div>

          {/* On touch screens the tape sits above the stick, or beside it when the screen is short. */}
          <div className="absolute bottom-36 left-4 flex items-end gap-3 short:bottom-4 short:left-36 desk:bottom-8">
            <canvas
              ref={tapeRef}
              width={168}
              height={560}
              className="h-52 w-16 rounded-sm short:h-36 short:w-12 desk:h-72 desk:w-20"
            />
            <div>
              <div
                ref={altRef}
                className="font-display text-5xl leading-none tabular-nums short:text-4xl desk:text-7xl"
              />
              <div className="mt-1 font-display text-sm tracking-widest text-muted">FT AGL</div>
              {air || phase === "roof" ? (
                <p className="mt-2 max-w-44 font-display text-sm leading-tight text-amber short:hidden">
                  {base ? `Pull by ${commas(BASE_PULL_FT)}` : `Critical pull ${commas(DECISION_FT)}`}
                  <span className="mt-1 block text-signal">
                    {base ? `Too low ${commas(BASE_HARD_FT)}` : `Hard deck ${commas(HARD_DECK_FT)}`}
                  </span>
                </p>
              ) : null}
            </div>
          </div>

          {prompt ? (
            <div className="absolute top-32 left-1/2 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 text-center font-display text-lg tracking-wide text-fg desk:top-auto desk:bottom-10 desk:text-xl">
              {/* Up top on touch screens it sits over bright sky, so it gets a backing. */}
              <span className="rounded-md bg-panel/70 px-3 py-1 box-decoration-clone desk:bg-transparent desk:p-0">
                {prompt}
              </span>
            </div>
          ) : null}

          <div
            className={clsx(
              "absolute top-42 left-1/2 -translate-x-1/2 items-center gap-2 rounded-md bg-panel/70 py-1 pr-3 pl-1 desk:top-auto desk:bottom-36 desk:bg-transparent desk:p-0",
              air || phase === "roof" ? "flex" : "hidden",
            )}
          >
            <div ref={dzArrowRef} className="grid size-8 place-items-center text-amber">
              <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
                <path d="M12 3 L16 14 H13 L13 21 H11 L11 14 H8 Z" fill="currentColor" />
              </svg>
            </div>
            <div className="font-display text-lg tabular-nums">
              <span ref={dzLabelRef}>DZ</span> <span ref={dzRef} />
            </div>
          </div>

          <p className="absolute right-4 bottom-4 hidden max-w-xs text-right text-sm text-muted desk:block">
            {phase === "cabin"
              ? "WASD walk · mouse look · run out the door on green"
              : phase === "roof"
                ? "WASD walk · shift runs · step off an edge, or space to run and jump"
                : phase === "freefall"
                ? winged
                  ? "A/D bank · W dive · S flare · mouse looks · space pulls"
                  : base
                    ? "A/D turn · W arch · S dive · space pulls · count your delay"
                    : "A/D turn · W arch · S dive · space pulls"
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
            {phase === "cabin" || phase === "roof" ? (
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
              {winged ? (
                <Bird className="size-5" aria-hidden="true" />
              ) : fromRoof ? (
                <Building2 className="size-5" aria-hidden="true" />
              ) : (
                <Plane className="size-5" aria-hidden="true" />
              )}
              <p className="font-display text-sm tracking-[0.22em]">
                {winged
                  ? fromRoof
                    ? "WINGSUIT BASE · CHICAGO"
                    : "WINGSUIT · TWIN OTTER"
                  : fromRoof
                    ? "ROOFTOP BASE · CHICAGO"
                    : "TWIN OTTER · CHICAGO"}
              </p>
            </div>
            <h1 className="mt-2 font-display text-5xl leading-none font-semibold tracking-wide">Lakeshore Exit</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {winged
                ? fromRoof
                  ? "Fly a wingsuit off a Chicago tower. The suit fills in a couple of seconds, then you get a short flight past the skyline before the pull. Willis Tower gives the longest."
                  : "Leave the Twin Otter in a wingsuit and fly the lakefront. The suit goes two and a half feet forward for every foot down, so go see the city."
                : fromRoof
                  ? "Stand on top of a Chicago tower, walk to the edge and jump. You get seconds, not minutes, before the pull."
                  : "Look around the cabin, walk to the door, and leave over Lake Michigan. The beach is west. The breeze is off the lake."}
            </p>

            <div className="mt-4" role="radiogroup" aria-labelledby="ride-label">
              <span id="ride-label" className="block font-display text-lg tracking-wide">
                Jump from
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["plane", "roof"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={ride === r}
                    className={clsx(
                      "flex h-10 items-center justify-center gap-2 rounded-md border font-display text-base tracking-wide",
                      ride === r ? "border-amber bg-amber text-ink" : "border-line bg-ink/60 text-fg",
                    )}
                    onClick={() => choose(r, roof)}
                  >
                    {r === "plane" ? (
                      <Plane className="size-4" aria-hidden="true" />
                    ) : (
                      <Building2 className="size-4" aria-hidden="true" />
                    )}
                    {r === "plane" ? "The plane" : "A rooftop"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3" role="radiogroup" aria-labelledby="suit-label">
              <span id="suit-label" className="block font-display text-lg tracking-wide">
                Suit
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["rig", "wing"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={suit === v}
                    className={clsx(
                      "flex h-10 items-center justify-center gap-2 rounded-md border font-display text-base tracking-wide",
                      suit === v ? "border-amber bg-amber text-ink" : "border-line bg-ink/60 text-fg",
                    )}
                    onClick={() => chooseSuit(v)}
                  >
                    {v === "wing" ? <Bird className="size-4" aria-hidden="true" /> : null}
                    {v === "wing" ? "Wingsuit" : "Standard"}
                  </button>
                ))}
              </div>
            </div>

            {fromRoof ? (
              <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rooftop">
                {PADS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={roof === p.id}
                    className={clsx(
                      "rounded-md border px-2.5 py-1.5 text-left",
                      roof === p.id ? "border-amber bg-amber/15" : "border-line bg-ink/60",
                    )}
                    onClick={() => choose("roof", p.id)}
                  >
                    <span className="block font-display text-base leading-tight tracking-wide">{p.name}</span>
                    <span className="block text-xs tabular-nums text-muted">{commas(p.heightM * FT_PER_M)} ft up</span>
                  </button>
                ))}
              </div>
            ) : null}

            {fromRoof ? null : (
              <>
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
              </>
            )}

            <div className="mt-3" role="radiogroup" aria-labelledby="light-label">
              <span id="light-label" className="block font-display text-lg tracking-wide">
                Time of day
              </span>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {LIGHTS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={light === l}
                    className={clsx(
                      "h-9 rounded-md border font-display text-base tracking-wide",
                      light === l ? "border-amber bg-amber text-ink" : "border-line bg-ink/60 text-fg",
                    )}
                    onClick={() => {
                      if (l === light) return;
                      writeSave({ ...loadSave(), light: l });
                      setLight(l);
                    }}
                  >
                    {LIGHT_LABEL[l]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex gap-3 rounded-lg border border-line bg-ink/60 p-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" />
              <div className="text-sm leading-relaxed">
                {fromRoof ? (
                  <>
                    <p className="font-display text-lg tracking-wide text-amber">Pull by {commas(BASE_PULL_FT)} ft</p>
                    <p className="mt-1 text-muted">
                      No reserve and no altimeter alarm off a building. Count your delay, pull, and fly to the nearest park.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-lg tracking-wide text-amber">Critical altitude {commas(DECISION_FT)} ft</p>
                    <p className="mt-1 text-muted">
                      The altimeter yells if you pass it still in freefall. Pull there. Hard deck {commas(HARD_DECK_FT)} ft.
                    </p>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              className="mt-5 h-12 w-full rounded-md bg-amber font-display text-xl tracking-widest text-ink"
              onClick={() => {
                bridge.command = "start";
              }}
            >
              {fromRoof ? "Go to the roof" : "Start the jump"}
            </button>
            {bootError ? <p className="mt-3 text-sm text-signal">{bootError}</p> : null}
            {record.jumps > 0 ? (
              <p className="mt-3 text-sm text-muted">
                {record.jumps} jumps · {record.rides} rides down
                {record.bestM !== null ? ` · best ${record.bestM} m` : ""}
                {record.bestScore !== null ? ` · top score ${record.bestScore}` : ""}
              </p>
            ) : null}

            <ul className="mt-4 space-y-1 text-sm text-muted">
              {fromRoof ? (
                <>
                  <li>Roof: WASD walks, shift runs. Step off an edge, or press space to run and jump.</li>
                  {winged ? (
                    <li>
                      Wingsuit: let the suit fill, then fly. A and D bank, W dives, S flares. Fly close past the towers
                      for points. Space pulls.
                    </li>
                  ) : (
                    <li>Freefall: you start from a standstill, so speed builds slowly. Space pulls.</li>
                  )}
                  <li>Canopy: it opens in about a second. Fly the arrow to open ground and land facing the lake.</li>
                </>
              ) : (
                <>
                  <li>Cabin: look around and walk to the door. On the green light the bar lifts: run out.</li>
                  {winged ? (
                    <li>
                      Wingsuit: the suit fills in about two seconds. A and D bank, W dives for speed, S flares to slow
                      down. The mouse looks around. Space pulls.
                    </li>
                  ) : (
                    <li>Freefall: A and D turn, W arches, S dives, space pulls.</li>
                  )}
                  <li>Canopy: A and D turn, S flares. Land facing the lake, into the wind. The marked rooftops count too.</li>
                </>
              )}
            </ul>
          </div>
        </aside>
      ) : null}

      <div className={clsx("impact-black absolute inset-0 z-30", phase === "impact" && "is-on")} />

      {outcome && copy ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center p-4">
          <section
            className={clsx(
              "pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-panel p-5",
              outcome.kind === "impact" && "debrief-late",
            )}
          >
            <p className="font-display text-sm tracking-[0.2em] text-muted">DEBRIEF</p>
            <h2 className="mt-1 font-display text-5xl leading-none font-semibold">{copy.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{copy.lede}</p>
            <Scorecard score={outcome.score} />
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-display tracking-widest text-muted">
                JUMP LOG
              </summary>
              <ol className="mt-2 space-y-1 text-fg">
                {outcome.log.map((line, i) => (
                  <li key={`${line}-${i}`}>{line}</li>
                ))}
              </ol>
            </details>
            {outcome.canBase ? (
              <button
                type="button"
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-amber font-display text-xl tracking-widest text-ink"
                onClick={() => {
                  bridge.command = "base";
                }}
              >
                <Building2 className="size-5" aria-hidden="true" />
                BASE jump off {outcome.roof === "a rooftop" || !outcome.roof ? "this roof" : outcome.roof}
              </button>
            ) : null}
            <div className={clsx("grid grid-cols-2 gap-2", outcome.canBase ? "mt-2" : "mt-5")}>
              <button
                type="button"
                className={clsx(
                  "flex h-12 items-center justify-center gap-2 rounded-md font-display text-lg tracking-widest",
                  outcome.canBase ? "border border-line bg-ink/60 text-fg" : "bg-amber text-ink",
                )}
                onClick={() => {
                  bridge.command = "retry";
                }}
              >
                <RotateCcw className="size-5" aria-hidden="true" />
                Jump again
              </button>
              <button
                type="button"
                className="h-12 rounded-md border border-line bg-ink/60 font-display text-lg tracking-widest text-fg"
                onClick={() => {
                  bridge.command = "again";
                }}
              >
                Manifest
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Scorecard({ score }: { score: JumpScore }) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-end gap-3">
        <p className="font-display text-6xl leading-none font-semibold tabular-nums text-amber">
          {score.total}
          <span className="ml-1 text-xl text-muted">/{score.max}</span>
        </p>
        <div className="mb-1">
          <div className="flex gap-0.5" role="img" aria-label={`${score.stars} of 3 stars`}>
            {[0, 1, 2].map((i) => (
              <Star
                key={i}
                aria-hidden="true"
                className={clsx("size-5", i < score.stars ? "fill-amber text-amber" : "text-line")}
              />
            ))}
          </div>
          {score.newBest ? (
            <p className="mt-1 w-fit rounded-sm bg-amber px-1.5 font-display text-xs tracking-widest text-ink">
              NEW BEST
            </p>
          ) : null}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-sm">
        {score.items.map((item) => (
          <div key={item.label} className="contents">
            <dt className="font-display tracking-wide text-muted">{item.label}</dt>
            <dd className={item.pts > 0 ? "text-fg" : "text-muted"}>{item.note}</dd>
            <dd className="text-right tabular-nums">
              <span className={item.pts === item.max ? "text-amber" : "text-fg"}>{item.pts}</span>
              <span className="text-muted">/{item.max}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
      className="h-14 min-w-24 touch-none rounded-md bg-amber px-3 font-display text-lg tracking-widest text-ink select-none"
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
  const id = useRef<number | null>(null);

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

  function release(e: PointerEvent) {
    if (e.pointerId !== id.current) return;
    id.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  }

  // touch-none keeps the browser from taking the drag over as a scroll or zoom, which
  // cancels the pointer and used to leave the stick frozen wherever it was.
  return (
    <div
      ref={pad}
      className="relative size-28 touch-none rounded-full border border-line bg-panel/70 select-none"
      onPointerDown={(e) => {
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== id.current) return;
        apply(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {/* Centered by the transform alone: the translate utilities would shift it a second time. */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 size-12 rounded-full bg-amber"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

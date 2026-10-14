import { useEffect, useRef, useState, type PointerEvent } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  Bird,
  Building2,
  Cloud,
  Film,
  Plane,
  RotateCcw,
  SkipForward,
  Star,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cardinal, describeOutcome } from "@/game/grade";
import { loadSave, writeSave } from "@/game/save";
import { EarnedGoals, LicenseCard, LogbookPanel } from "@/components/logbook";
import {
  BASE_HARD_FT,
  BASE_PULL_FT,
  DECISION_FT,
  DEFAULT_EXIT_FT,
  DEFAULT_HOP_FT,
  FT_PER_M,
  DEFAULT_MAL_PCT,
  HARD_DECK_FT,
  HOP_MAX_FT,
  HOP_MIN_FT,
  LIGHTS,
  MAX_EXIT_FT,
  MIN_EXIT_FT,
  PADS,
  RIDES,
  RINGS_HOP_MIN_FT,
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
const RIDE_LABEL: Record<Ride, string> = {
  plane: "The plane",
  heli: "Helicopter",
  balloon: "Balloon",
  roof: "A rooftop",
};

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
  const replayBarRef = useRef<HTMLDivElement>(null);
  const replayAltRef = useRef<HTMLDivElement>(null);
  const replaySpeedRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<Bridge>(createBridge());
  const onFrame = useRef<(hud: Hud) => void>(() => {});

  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<JumpMode>("skydive");
  const [ride, setRide] = useState<Ride>("plane");
  const [roof, setRoof] = useState<PadId>("southloop");
  const [suit, setSuit] = useState<Suit>("rig");
  const [rings, setRings] = useState(false);
  const [banner, setBanner] = useState("");
  const [bannerLevel, setBannerLevel] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [needsLook, setNeedsLook] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [replay, setReplay] = useState(false);
  // This jump has been replayed: the impact flash and the slow debrief have already played once.
  const [watched, setWatched] = useState(false);
  const [shot, setShot] = useState("");
  const [canopy, setCanopy] = useState<"none" | "main" | "reserve">("none");
  const [altitudeFt, setAltitudeFt] = useState(DEFAULT_EXIT_FT);
  const [hopFt, setHopFt] = useState(DEFAULT_HOP_FT);
  const [malPct, setMalPct] = useState(DEFAULT_MAL_PCT);
  const [muted, setMuted] = useState(false);
  const [light, setLight] = useState<Light | null>(null);
  const [bootError, setBootError] = useState("");
  const [record, setRecord] = useState<Hud["save"]>({ bestM: null, bestScore: null, jumps: 0, rides: 0, goals: {} });
  const [logbook, setLogbook] = useState(false);

  const cache = useRef({
    phase: "menu" as Phase,
    mode: "skydive" as JumpMode,
    banner: "",
    level: 0,
    prompt: "",
    needsLook: false,
    outcome: null as Outcome | null,
    replay: false,
    shot: "",
    canopy: "none" as "none" | "main" | "reserve",
    jumps: -1,
    best: null as number | null,
    bestScore: null as number | null,
    rides: -1,
    goals: -1,
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
      setWatched(false);
    }
    const r = hud.replay;
    if (c.replay !== !!r) {
      c.replay = !!r;
      setReplay(!!r);
      if (r) setWatched(true);
    }
    if (r) {
      if (c.shot !== r.shot) {
        c.shot = r.shot;
        setShot(r.shot);
      }
      if (replayBarRef.current) replayBarRef.current.style.transform = `scaleX(${r.progress})`;
      if (replayAltRef.current) replayAltRef.current.textContent = `${commas(r.altFt)} FT`;
      if (replaySpeedRef.current) {
        replaySpeedRef.current.textContent =
          r.speed > 1.05 ? `${r.speed < 3 ? r.speed.toFixed(1) : Math.round(r.speed)}× SPEED` : r.speed < 0.95 ? "SLOW MOTION" : "";
      }
    }
    if (c.canopy !== hud.canopy) {
      c.canopy = hud.canopy;
      setCanopy(hud.canopy);
    }
    const s = hud.save;
    const goals = Object.keys(s.goals).length;
    if (
      c.jumps !== s.jumps ||
      c.best !== s.bestM ||
      c.bestScore !== s.bestScore ||
      c.rides !== s.rides ||
      c.goals !== goals
    ) {
      c.jumps = s.jumps;
      c.best = s.bestM;
      c.bestScore = s.bestScore;
      c.rides = s.rides;
      c.goals = goals;
      setRecord({ ...s });
    }
  };

  useEffect(() => {
    const saved = loadSave();
    const alt = Math.min(MAX_EXIT_FT, Math.max(MIN_EXIT_FT, saved.altitudeFt));
    const mal = Math.min(40, Math.max(0, saved.malPct));
    const hop = Math.min(HOP_MAX_FT, Math.max(HOP_MIN_FT, saved.hopFt));
    bridgeRef.current.altitudeFt = alt;
    bridgeRef.current.hopFt = hop;
    bridgeRef.current.malChance = mal / 100;
    bridgeRef.current.ride = saved.ride;
    bridgeRef.current.roof = saved.roof;
    bridgeRef.current.suit = saved.suit;
    bridgeRef.current.rings = saved.rings;
    setAltitudeFt(alt);
    setHopFt(hop);
    setMalPct(mal);
    setRide(saved.ride);
    setRoof(saved.roof);
    setSuit(saved.suit);
    setRings(saved.rings);
    setRecord({
      bestM: saved.bestM,
      bestScore: saved.bestScore,
      jumps: saved.jumps,
      rides: saved.rides,
      goals: saved.goals,
    });
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
  /** A helicopter or a balloon: a slow ride up, then dead air. */
  const hop = ride === "heli" || ride === "balloon";
  const chooseSuit = (next: Suit) => {
    bridge.suit = next;
    setSuit(next);
    writeSave({ ...loadSave(), suit: next });
  };
  const winged = suit === "wing";
  const chooseRings = (next: boolean) => {
    bridge.rings = next;
    setRings(next);
    writeSave({ ...loadSave(), rings: next });
  };
  /** The ring challenge, where it can be flown: not off a building. */
  const ringRun = rings && !fromRoof;
  const hopMin = ringRun ? RINGS_HOP_MIN_FT : HOP_MIN_FT;

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
                    : phase === "aboard"
                      ? ride === "heli"
                        ? "HELICOPTER"
                        : "BALLOON"
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
              {air || phase === "roof" || phase === "aboard" ? (
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
              air || phase === "roof" || phase === "aboard" ? "flex" : "hidden",
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
              : phase === "aboard"
                ? ride === "heli"
                  ? "Mouse look · space pushes off once the pilot clears you"
                  : "WASD steps around the basket · mouse look · space climbs over the rim"
              : phase === "roof"
                ? "WASD walk · shift runs · step off an edge, or space to run and jump"
                : phase === "freefall"
                ? winged
                  ? "A/D bank · W dive · S flare · mouse looks · space pulls"
                  : base
                    ? "A/D turn · W arch · S dive · space pulls · count your delay"
                    : hop
                      ? "Hold W to arch until stable · A/D turn · S dive · space pulls"
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
            {phase === "cabin" || phase === "roof" || phase === "aboard" ? (
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
              {winged ? <Bird className="size-5" aria-hidden="true" /> : <RideIcon ride={ride} className="size-5" />}
              <p className="font-display text-sm tracking-[0.22em]">{EYEBROW[ride][winged ? 1 : 0]}</p>
            </div>
            <h1 className="mt-2 font-display text-5xl leading-none font-semibold tracking-wide">Lakeshore Exit</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">{BLURB[ride][winged ? 1 : 0]}</p>

            <div className="mt-4" role="radiogroup" aria-labelledby="ride-label">
              <span id="ride-label" className="block font-display text-lg tracking-wide">
                Jump from
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {RIDES.map((r) => (
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
                    <RideIcon ride={r} className="size-4" />
                    {RIDE_LABEL[r]}
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

            {fromRoof ? null : (
              <div className="mt-3" role="radiogroup" aria-labelledby="challenge-label">
                <span id="challenge-label" className="block font-display text-lg tracking-wide">
                  Freefall
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {([false, true] as const).map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      role="radio"
                      aria-checked={rings === v}
                      className={clsx(
                        "flex h-10 items-center justify-center gap-2 rounded-md border font-display text-base tracking-wide",
                        rings === v ? "border-amber bg-amber text-ink" : "border-line bg-ink/60 text-fg",
                      )}
                      onClick={() => chooseRings(v)}
                    >
                      {v ? (
                        <RingsIcon className="size-4" />
                      ) : ride === "plane" && !winged ? (
                        <Users className="size-4" aria-hidden="true" />
                      ) : (
                        <Cloud className="size-4" aria-hidden="true" />
                      )}
                      {v ? "Rings" : ride === "plane" && !winged ? "Formation" : "Open sky"}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                <span className="tabular-nums text-amber">{commas(hop ? Math.max(hopMin, hopFt) : altitudeFt)} ft</span>
              </span>
              <input
                id="exit-alt"
                type="range"
                min={hop ? hopMin : MIN_EXIT_FT}
                max={hop ? HOP_MAX_FT : MAX_EXIT_FT}
                step={500}
                value={hop ? Math.max(hopMin, hopFt) : altitudeFt}
                suppressHydrationWarning
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (hop) {
                    bridge.hopFt = v;
                    setHopFt(v);
                  } else {
                    bridge.altitudeFt = v;
                    setAltitudeFt(v);
                  }
                }}
              />
              <span className="text-xs text-muted">
                {hop
                  ? `${commas(hopMin)} to ${commas(HOP_MAX_FT)} ft above the lake${ringRun ? ", with room for rings" : ""}`
                  : `${commas(MIN_EXIT_FT)} to ${commas(MAX_EXIT_FT)} ft above the lake`}
              </span>
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
                      {hop ? "Dead air first: arch until you are stable. " : ""}
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
              {START[ride]}
            </button>
            {bootError ? <p className="mt-3 text-sm text-signal">{bootError}</p> : null}
            <LicenseCard record={record} onOpen={() => setLogbook(true)} />

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
              ) : hop ? (
                <>
                  <li>
                    {ride === "heli"
                      ? "Helicopter: look around. Once the pilot clears you, press space (or W) to push off the skid."
                      : "Balloon: WASD steps around the basket. Face out and press space to climb over the rim."}
                  </li>
                  {winged ? (
                    <li>
                      Wingsuit: with no airspeed to start, the suit has to dive before it flies. A and D bank, W dives, S
                      flares. Space pulls.
                    </li>
                  ) : (
                    <li>Dead air: hold W to arch until you are stable, then A and D turn, S dives, space pulls.</li>
                  )}
                  {ringRun ? <li>{RINGS_HELP[winged ? 1 : 0]}</li> : null}
                  <li>Canopy: A and D turn, S flares. Land facing the lake, into the wind.</li>
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
                  {ringRun ? <li>{RINGS_HELP[winged ? 1 : 0]}</li> : null}
                  <li>Canopy: A and D turn, S flares. Land facing the lake, into the wind. The marked rooftops count too.</li>
                </>
              )}
            </ul>

            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              © 2026 James Keith Harwood II. All rights reserved.{" "}
              <a
                className="whitespace-nowrap underline underline-offset-2"
                href={`${import.meta.env.BASE_URL}THIRD-PARTY-NOTICES.txt`}
                target="_blank"
                rel="noopener"
              >
                Open-source notices
              </a>
            </p>
          </div>
        </aside>
      ) : null}

      <div className={clsx("impact-black absolute inset-0 z-30", phase === "impact" && !replay && (watched ? "is-held" : "is-on"))} />

      {replay ? (
        <div className="pointer-events-none absolute inset-0 z-40 font-display tracking-widest">
          <div className="replay-bar replay-top absolute inset-x-0 top-0 flex items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2 text-sm sm:text-base">
              <span className="replay-dot size-2.5 rounded-full bg-signal" aria-hidden="true" />
              <span className="text-fg">REPLAY</span>
              <span className="text-muted">· {shot}</span>
            </div>
            <div className="text-right text-sm leading-tight sm:text-base">
              <div ref={replayAltRef} className="text-fg" />
              <div ref={replaySpeedRef} className="text-xs text-amber sm:text-sm" />
            </div>
          </div>
          <div className="replay-bar replay-bottom pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 sm:px-6">
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/15">
              <div ref={replayBarRef} className="h-full origin-left bg-amber" style={{ transform: "scaleX(0)" }} />
            </div>
            <span className="hidden text-xs text-muted desk:inline">SPACE NEXT · ESC DONE</span>
            <button
              type="button"
              className="flex h-10 items-center gap-1.5 rounded-md border border-line bg-ink/70 px-3 text-sm text-fg"
              onClick={() => {
                bridge.command = "replayNext";
              }}
            >
              <SkipForward className="size-4" aria-hidden="true" />
              Next shot
            </button>
            <button
              type="button"
              className="h-10 rounded-md bg-amber px-4 text-sm text-ink"
              onClick={() => {
                bridge.command = "replayEnd";
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {outcome && copy && !replay ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center p-4">
          <section
            className={clsx(
              "pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-panel p-5",
              outcome.kind === "impact" && !watched && "debrief-late",
            )}
          >
            <p className="font-display text-sm tracking-[0.2em] text-muted">
              DEBRIEF{outcome.n > 0 ? ` · JUMP ${outcome.n}` : ""}
            </p>
            <h2 className="mt-1 font-display text-5xl leading-none font-semibold">{copy.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{copy.lede}</p>
            <Scorecard score={outcome.score} />
            <EarnedGoals outcome={outcome} />
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
            <button
              type="button"
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md border border-line bg-ink/60 font-display text-lg tracking-widest text-fg"
              onClick={() => {
                bridge.command = "replay";
              }}
            >
              <Film className="size-5" aria-hidden="true" />
              Watch the replay
            </button>
            {outcome.canBase ? (
              <button
                type="button"
                className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-amber font-display text-xl tracking-widest text-ink"
                onClick={() => {
                  bridge.command = "base";
                }}
              >
                <Building2 className="size-5" aria-hidden="true" />
                BASE jump off {outcome.roof === "a rooftop" || !outcome.roof ? "this roof" : outcome.roof}
              </button>
            ) : null}
            <div className="mt-2 grid grid-cols-2 gap-2">
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
      {logbook && phase === "menu" ? <LogbookPanel onClose={() => setLogbook(false)} /> : null}
    </main>
  );
}

/** The menu's eyebrow for each ride: standard rig, then wingsuit. */
const EYEBROW: Record<Ride, [string, string]> = {
  plane: ["TWIN OTTER · CHICAGO", "WINGSUIT · TWIN OTTER"],
  heli: ["HELICOPTER · CHICAGO", "WINGSUIT · HELICOPTER"],
  balloon: ["HOT-AIR BALLOON · CHICAGO", "WINGSUIT · BALLOON"],
  roof: ["ROOFTOP BASE · CHICAGO", "WINGSUIT BASE · CHICAGO"],
};

const BLURB: Record<Ride, [string, string]> = {
  plane: [
    "Look around the cabin, walk to the door, and leave over Lake Michigan. The beach is west. The breeze is off the lake.",
    "Leave the Twin Otter in a wingsuit and fly the lakefront. The suit goes two and a half feet forward for every foot down, so go see the city.",
  ],
  heli: [
    "Sit in the open door of a helicopter hovering off the beach, then push off into dead air. There is no wind to fly on at first: arch hard and ride out the tumble.",
    "Push off a hovering helicopter in a wingsuit. With no airspeed to start, let the suit dive until it bites, then fly the lakefront.",
  ],
  balloon: [
    "Drift in over the lake under a balloon in the city's colors, then climb over the rim. The quietest exit there is, and the deadest air: arch hard until the wind catches you.",
    "Step off a hot-air balloon in a wingsuit. Dive until the suit bites, then fly in over the beach past the other balloons.",
  ],
  roof: [
    "Stand on top of a Chicago tower, walk to the edge and jump. You get seconds, not minutes, before the pull.",
    "Fly a wingsuit off a Chicago tower. The suit fills in a couple of seconds, then you get a short flight past the skyline before the pull. Willis Tower gives the longest.",
  ],
};

const START: Record<Ride, string> = {
  plane: "Start the jump",
  heli: "Board the helicopter",
  balloon: "Board the balloon",
  roof: "Go to the roof",
};

/** Lucide has a plane and a building; the helicopter and the balloon are drawn to match them. */
/** How the ring challenge flies: standard rig, then wingsuit. */
const RINGS_HELP: [string, string] = [
  "Rings: you track toward where you look, so look at the gold ring to fly into it. W slows the fall, S speeds it up.",
  "Gates: once the suit flies, a course of gates curls out ahead. Fly through the gold one, then the next.",
];

/** Three hoops, one behind the other. */
function RingsIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <ellipse cx="12" cy="12" rx="6" ry="2" />
      <ellipse cx="12" cy="18.5" rx="4" ry="1.5" />
    </svg>
  );
}

function RideIcon({ ride, className }: { ride: Ride; className: string }) {
  if (ride === "plane") return <Plane className={className} aria-hidden="true" />;
  if (ride === "roof") return <Building2 className={className} aria-hidden="true" />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ride === "heli" ? (
        <>
          <path d="M3 4h16" />
          <path d="M11 4v5" />
          <path d="M7 9h6a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6z" />
          <path d="M16 12h5" />
          <path d="M21 10v4" />
          <path d="M5 20h11" />
          <path d="M8 15v5" />
          <path d="M13 15v5" />
        </>
      ) : (
        <>
          <path d="M12 2a6 6 0 0 0-6 6c0 3.5 3.5 6.5 4.5 8h3c1-1.5 4.5-4.5 4.5-8a6 6 0 0 0-6-6z" />
          <path d="M10.5 16l.5 3" />
          <path d="M13.5 16l-.5 3" />
          <rect x="10" y="19" width="4" height="3" rx="0.5" />
        </>
      )}
    </svg>
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

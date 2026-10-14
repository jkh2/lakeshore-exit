import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { BookOpen, Circle, CircleCheck, Star, X } from "lucide-react";
import {
  GOALS,
  LICENSES,
  licenseOf,
  nextLicense,
  type GoalsDone,
  type LicenseId,
  type LogEntry,
} from "@/game/logbook";
import { loadSave } from "@/game/save";
import type { Hud, Outcome } from "@/game/types";

const commas = (n: number) => Math.round(n).toLocaleString("en-US");

/** A license letter on a small card: filled once held, outlined while still to earn. */
export function LicenseBadge({
  id,
  held,
  size = "md",
}: {
  id: LicenseId | null;
  held: boolean;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "grid shrink-0 place-items-center rounded-md border-2 font-display leading-none font-semibold",
        size === "lg" ? "size-14 text-4xl" : "size-11 text-2xl",
        held ? "border-amber bg-amber text-ink" : "border-line text-muted",
      )}
    >
      {id ?? "S"}
    </span>
  );
}

/** On the menu: the license you hold, your record, and the next few goals to work on. */
export function LicenseCard({ record, onOpen }: { record: Hud["save"]; onOpen: () => void }) {
  const held = licenseOf(record.goals);
  const next = nextLicense(record.goals);
  const stats = [
    record.jumps > 0
      ? `${record.jumps} jump${record.jumps === 1 ? "" : "s"}`
      : "No jumps logged yet",
    record.bestM !== null ? `best ${record.bestM} m` : "",
    record.bestScore !== null ? `top score ${record.bestScore}` : "",
  ].filter(Boolean);
  return (
    <div className="mt-4 rounded-xl border border-line bg-ink/60 p-3">
      <div className="flex items-center gap-3">
        <LicenseBadge id={held} held={held !== null} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-tight tracking-wide">
            {held ? `${held} license` : "Student"}
          </p>
          <p className="text-xs text-muted">{stats.join(" · ")}</p>
        </div>
        <button
          type="button"
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-line px-3 font-display text-sm tracking-widest text-fg"
          onClick={onOpen}
        >
          <BookOpen className="size-4" aria-hidden="true" />
          Logbook
        </button>
      </div>
      {next ? (
        <div className="mt-2.5 border-t border-line pt-2">
          <p className="font-display text-xs tracking-[0.18em] text-muted">
            NEXT: {next.id} LICENSE · {5 - next.todo.length} OF 5 DONE
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {next.todo.slice(0, 3).map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                <Circle className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                {g.title}
              </li>
            ))}
            {next.todo.length > 3 ? (
              <li className="pl-5.5 text-xs text-muted">
                and {next.todo.length - 3} more in the logbook
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <p className="mt-2 border-t border-line pt-2 text-sm text-muted">
          All four licenses. Blue skies.
        </p>
      )}
    </div>
  );
}

/** On the debrief: a license just earned, and the goals this jump checked off. */
export function EarnedGoals({ outcome }: { outcome: Outcome }) {
  if (!outcome.licensed && outcome.earned.length === 0) return null;
  const lic = LICENSES.find((l) => l.id === outcome.licensed);
  return (
    <div className="mt-4 border-t border-line pt-4">
      {lic ? (
        <div className="license-new mb-3 flex items-center gap-3 rounded-xl border border-amber bg-amber/10 p-3">
          <LicenseBadge id={lic.id} held size="lg" />
          <div>
            <p className="font-display text-2xl leading-none font-semibold tracking-wide text-amber">
              {lic.name.toUpperCase()} EARNED
            </p>
            <p className="mt-1 text-sm text-muted">{lic.blurb}</p>
          </div>
        </div>
      ) : null}
      <ul className="space-y-1 text-sm">
        {outcome.earned.map((g) => (
          <li key={g.title} className="flex items-center gap-2">
            <CircleCheck className="size-4 shrink-0 text-amber" aria-hidden="true" />
            <span>{g.title}</span>
            <span className="ml-auto shrink-0 font-display text-xs tracking-widest text-muted">
              {g.license} LICENSE
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RIDE_NAME: Record<LogEntry["ride"], string> = {
  plane: "Plane",
  heli: "Helicopter",
  balloon: "Balloon",
  roof: "Rooftop",
};

function rideLine(e: LogEntry) {
  const from = e.mode === "base" ? `BASE${e.from ? ` off ${e.from}` : ""}` : RIDE_NAME[e.ride];
  return e.suit === "wing" ? `${from} · wingsuit` : from;
}

function landing(e: LogEntry) {
  if (e.kind === "impact") return "Went in";
  if (e.kind === "water") return "In the lake";
  if (e.area === "beach") return `Beach · ${e.distM} m from the disc`;
  if (e.area === "roof")
    return `${e.roof ?? "A rooftop"}${e.padM !== null ? ` · ${e.padM} m from the mark` : ""}`;
  return e.area === "park" ? "In a park" : "In the street";
}

function details(e: LogEntry) {
  const bits: string[] = [];
  if (e.exitFt !== null) bits.push(`Exit ${commas(e.exitFt)} ft`);
  if (e.freefallS !== null) bits.push(`${Math.round(e.freefallS)} s freefall`);
  if (e.pullFt !== null) bits.push(`pull ${commas(e.pullFt)} ft`);
  if (e.reserve) bits.push("reserve");
  return bits.join(" · ");
}

const day = (at: number) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The whole logbook: the license ladder with every goal, and the jumps, newest first. */
export function LogbookPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"licenses" | "jumps">("licenses");
  const save = useMemo(() => loadSave(), []);
  const done: GoalsDone = save.goals;
  const held = licenseOf(done);
  const heldAt = held === null ? -1 : LICENSES.findIndex((l) => l.id === held);
  const jumps = save.log.slice().reverse();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-ink/70 p-3 backdrop-blur-sm md:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="logbook-title"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-2xl border border-line bg-panel"
      >
        <header className="flex items-center gap-3 border-b border-line p-4">
          <BookOpen className="size-5 text-amber" aria-hidden="true" />
          <h2
            id="logbook-title"
            className="font-display text-2xl leading-none font-semibold tracking-wide"
          >
            Logbook
          </h2>
          <span className="text-sm text-muted">
            {save.jumps} jump{save.jumps === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="ml-auto grid size-10 place-items-center rounded-md border border-line text-fg"
            aria-label="Close the logbook"
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-2 px-4 pt-3" role="tablist">
          {(["licenses", "jumps"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={clsx(
                "h-10 rounded-md border font-display text-base tracking-wide",
                tab === t ? "border-amber bg-amber text-ink" : "border-line bg-ink/60 text-fg",
              )}
              onClick={() => setTab(t)}
            >
              {t === "licenses" ? "Licenses" : `Jumps (${save.log.length})`}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "licenses" ? (
            <ol className="space-y-4">
              {LICENSES.map((l, i) => {
                const goals = GOALS.filter((g) => g.license === l.id);
                const got = goals.filter((g) => done[g.id] !== undefined).length;
                const isHeld = i <= heldAt;
                const at = isHeld ? Math.max(...goals.map((g) => done[g.id] ?? 0)) : null;
                return (
                  <li key={l.id} className="rounded-xl border border-line bg-ink/60 p-3">
                    <div className="flex items-center gap-3">
                      <LicenseBadge id={l.id} held={isHeld} />
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-lg leading-tight tracking-wide">{l.name}</p>
                        <p className="text-xs text-muted">{l.blurb}</p>
                      </div>
                      <p className="shrink-0 text-right font-display text-sm tracking-wide text-muted">
                        {isHeld ? (
                          <span className="text-amber">Earned</span>
                        ) : (
                          `${got} of ${goals.length}`
                        )}
                      </p>
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {goals.map((g) => {
                        const n = done[g.id];
                        return (
                          <li key={g.id} className="flex items-center gap-2">
                            {n !== undefined ? (
                              <CircleCheck
                                className="size-4 shrink-0 text-amber"
                                aria-label="Done"
                              />
                            ) : (
                              <Circle className="size-4 shrink-0 text-line" aria-label="To do" />
                            )}
                            <span className={n !== undefined ? "text-fg" : "text-muted"}>
                              {g.title}
                            </span>
                            {n !== undefined ? (
                              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                                jump {n}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    {at !== null && at > 0 ? (
                      <p className="mt-2 text-xs text-muted">Earned on jump {at}.</p>
                    ) : !isHeld && got === goals.length ? (
                      <p className="mt-2 text-xs text-muted">
                        Every goal done: it comes with the license before it.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : jumps.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {save.jumps > 0
                ? `Your ${save.jumps} jump${save.jumps === 1 ? " was" : "s were"} before the logbook. Your next one goes here.`
                : "No jumps logged yet. Your first one goes here."}
            </p>
          ) : (
            <>
              <ol className="divide-y divide-line">
                {jumps.map((e) => (
                  <li key={`${e.n}-${e.at}`} className="py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-base tracking-wide tabular-nums text-amber">
                        #{e.n}
                      </span>
                      <span className="min-w-0 truncate font-display text-base tracking-wide">
                        {rideLine(e)}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{day(e.at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-sm">
                      <span
                        className={clsx(
                          "min-w-0 flex-1",
                          e.kind === "impact" ? "text-signal" : "text-fg",
                        )}
                      >
                        {landing(e)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 tabular-nums">
                        {e.score}
                        <span className="flex" role="img" aria-label={`${e.stars} of 3 stars`}>
                          {[0, 1, 2].map((i) => (
                            <Star
                              key={i}
                              aria-hidden="true"
                              className={clsx(
                                "size-3.5",
                                i < e.stars ? "fill-amber text-amber" : "text-line",
                              )}
                            />
                          ))}
                        </span>
                      </span>
                    </div>
                    {details(e) ? <p className="mt-0.5 text-xs text-muted">{details(e)}</p> : null}
                  </li>
                ))}
              </ol>
              {jumps[jumps.length - 1].n > 1 ? (
                <p className="border-t border-line pt-2.5 text-xs text-muted">
                  Jumps before #{jumps[jumps.length - 1].n} are not in the log.
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

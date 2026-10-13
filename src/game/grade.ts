import type { Outcome } from "./types";

export function cardinal(deg: number) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const i = ((Math.round(deg / 45) % 8) + 8) % 8;
  return names[i] ?? "N";
}

export function describeOutcome(o: Outcome): { title: string; lede: string } {
  if (o.kind === "impact") {
    return { title: "You went in", lede: o.reason };
  }
  if (o.kind === "water") {
    return {
      title: "Lake Michigan",
      lede: "Open water. The canopy floats better than you do.",
    };
  }
  const d = o.distanceM;
  let title = "Street landing";
  let where =
    d < 1000 ? `${Math.round(d)} m from the beach` : `${(d / 1000).toFixed(1)} km from the beach`;
  if (o.onBeach) {
    if (d <= 2) title = "Dead center";
    else if (d <= 5) title = "On the disc";
    else if (d <= 16) title = "In the peas";
    else if (d <= 40) title = "On the sand";
    else title = "Long walk";
    where = `${Math.round(d)} m`;
  } else if (o.area === "roof" && o.padM !== null) {
    title = o.padM <= 2 ? "Dead center up top" : o.padM <= 10 ? "On the mark" : "On the roof";
    where = `${o.roof ?? "Roof"} · ${Math.round(o.padM)} m from the mark`;
  } else if (o.area === "roof") {
    title = o.roof === "Navy Pier" ? "Navy Pier" : "Rooftop landing";
  } else if (o.area === "park") title = "Park landing";
  const bits = [where];
  if (o.suit === "wing" && o.flightM !== null) {
    const m = o.flightM;
    bits.push(
      `${m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`} in the wingsuit`,
    );
  }
  if (o.mode === "base") {
    if (o.from) bits.unshift(`BASE off ${o.from}`);
    if (o.delayS !== null) bits.push(`${o.delayS.toFixed(1)} s delay`);
  } else {
    if (o.ride === "heli" || o.ride === "balloon") {
      bits.unshift(o.ride === "heli" ? "Off the helicopter" : "Out of the balloon");
      if (o.stableS !== null) bits.push(`stable in ${o.stableS.toFixed(1)} s`);
    }
    bits.push(o.usedReserve ? "reserve ride" : "main");
  }
  bits.push(o.intoWind ? "into the wind" : "downwind");
  if (o.hot) bits.push("hot");
  if (o.redLight)
    bits.push(o.ride === "heli" ? "went before the pilot cleared you" : "red-light exit");
  return { title, lede: bits.join(" · ") };
}

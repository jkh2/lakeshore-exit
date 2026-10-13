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
  if (o.mode === "base") {
    if (o.from) bits.unshift(`BASE off ${o.from}`);
    if (o.delayS !== null) bits.push(`${o.delayS.toFixed(1)} s delay`);
  } else bits.push(o.usedReserve ? "reserve ride" : "main");
  bits.push(o.intoWind ? "into the wind" : "downwind");
  if (o.hot) bits.push("hot");
  if (o.redLight) bits.push("red-light exit");
  return { title, lede: bits.join(" · ") };
}

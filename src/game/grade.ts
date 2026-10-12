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
  if (o.onBeach) {
    if (d <= 2) title = "Dead center";
    else if (d <= 5) title = "On the disc";
    else if (d <= 16) title = "In the peas";
    else if (d <= 40) title = "On the sand";
    else title = "Long walk";
  }
  const bits = [
    `${Math.round(d)} m`,
    o.usedReserve ? "reserve ride" : "main",
    o.intoWind ? "into the wind" : "downwind",
  ];
  if (o.hot) bits.push("hot");
  if (o.redLight) bits.push("red-light exit");
  return { title, lede: bits.join(" · ") };
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GOALS,
  LOG_MAX,
  award,
  cleanGoals,
  cleanLog,
  licenseOf,
  nextLicense,
  type JumpDone,
} from "./logbook.ts";

/** A soft, into-the-wind landing 4 m from the disc off the plane, on the green light, opened at 4,500 ft. */
function jump(over: Partial<JumpDone> = {}): JumpDone {
  return {
    kind: "landed",
    mode: "skydive",
    ride: "plane",
    redLight: false,
    onBeach: true,
    intoWind: true,
    hot: false,
    distanceM: 4,
    usedReserve: false,
    area: "beach",
    padM: null,
    flightM: null,
    closestM: null,
    rings: null,
    score: 80,
    jumps: 1,
    dockedFt: null,
    pullFt: 4500,
    ...over,
  };
}

const all = (license: string) =>
  Object.fromEntries(GOALS.filter((g) => g.license === license).map((g) => [g.id, 1]));

describe("licenses", () => {
  it("starts as a student and works toward the A license", () => {
    assert.equal(licenseOf({}), null);
    assert.equal(nextLicense({})?.id, "A");
    assert.equal(nextLicense({})?.todo.length, 5);
  });

  it("holds a license only with every license below it", () => {
    assert.equal(licenseOf(all("A")), "A");
    assert.equal(licenseOf({ ...all("A"), ...all("C") }), "A");
    assert.equal(licenseOf({ ...all("A"), ...all("B"), ...all("C"), ...all("D") }), "D");
    assert.equal(nextLicense({ ...all("A"), ...all("B"), ...all("C"), ...all("D") }), null);
  });

  it("checks off what a good first jump earns, and nothing it doesn't", () => {
    const done = {};
    const got = award(done, jump(), 1);
    assert.deepEqual(
      got.earned.map((g) => g.id),
      ["a-green", "a-pull", "a-beach", "a-soft", "b-10m"],
    );
    assert.equal(got.licensed, null);
    assert.deepEqual(done, { "a-green": 1, "a-pull": 1, "a-beach": 1, "a-soft": 1, "b-10m": 1 });
  });

  it("earns the A license on the fifth jump and never awards a goal twice", () => {
    const done = {};
    award(done, jump(), 1);
    const fifth = award(done, jump({ jumps: 5 }), 5);
    assert.deepEqual(
      fifth.earned.map((g) => g.id),
      ["a-jumps"],
    );
    assert.equal(fifth.licensed, "A");
    assert.equal(award(done, jump({ jumps: 6 }), 6).earned.length, 0);
  });

  it("gives nothing for going in but the jump count", () => {
    const got = award({}, jump({ kind: "impact", jumps: 5, score: 0 }), 5);
    assert.deepEqual(
      got.earned.map((g) => g.id),
      ["a-jumps"],
    );
  });

  it("knows a clean ring sweep, a tower pass and a rooftop mark", () => {
    const ids = (j: JumpDone) => award({}, j, 1).earned.map((g) => g.id);
    assert.ok(ids(jump({ rings: { got: 9, total: 9 } })).includes("c-rings"));
    assert.ok(!ids(jump({ rings: { got: 8, total: 9 } })).includes("c-rings"));
    assert.ok(ids(jump({ closestM: 8, flightM: 2400 })).includes("d-pass"));
    assert.ok(ids(jump({ closestM: 8, flightM: 2400 })).includes("c-wing"));
    assert.ok(ids(jump({ area: "roof", onBeach: false, padM: 2.5 })).includes("d-pad"));
  });
});

describe("save data", () => {
  it("keeps well-formed log entries, newest last, up to the cap", () => {
    const good = {
      n: 1,
      at: 1,
      ride: "plane",
      kind: "landed",
      distM: 3,
      score: 70,
      exitFt: 12500,
      freefallS: 50,
      pullFt: 4000,
    };
    const log = cleanLog([good, { ...good, ride: "rocket" }, null, "x", { ...good, score: "70" }]);
    assert.equal(log.length, 1);
    assert.equal(
      cleanLog(Array.from({ length: LOG_MAX + 5 }, (_, i) => ({ ...good, n: i }))).length,
      LOG_MAX,
    );
    assert.deepEqual(cleanLog("nope"), []);
  });

  it("keeps only goals that exist, with jump numbers", () => {
    assert.deepEqual(cleanGoals({ "a-beach": 3, "z-gone": 4, "a-soft": "5" }), { "a-beach": 3 });
    assert.deepEqual(cleanGoals(null), {});
  });
});

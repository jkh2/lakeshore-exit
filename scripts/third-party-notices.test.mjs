import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { collectNotices, formatNotices, packageDirOf } from "./third-party-notices.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

describe("third-party notices", () => {
  it("finds the package a bundled module came from", () => {
    assert.equal(
      packageDirOf("/a/node_modules/three/build/three.module.js"),
      "/a/node_modules/three",
    );
    assert.equal(
      packageDirOf("/a/node_modules/@scope/pkg/dist/x.js?commonjs-es"),
      "/a/node_modules/@scope/pkg",
    );
    assert.equal(
      packageDirOf("/a/node_modules/x/node_modules/y/index.js"),
      "/a/node_modules/x/node_modules/y",
    );
    assert.equal(packageDirOf("/a/src/game/engine.ts"), null);
    assert.equal(packageDirOf("\0vite/preload-helper.js"), null);
  });

  it("reads each package's license once, with its text", () => {
    const notices = collectNotices([
      `${root}/node_modules/three/build/three.module.js`,
      `${root}/node_modules/three/examples/jsm/objects/Sky.js`,
      `${root}/src/game/engine.ts`,
    ]);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].name, "three");
    assert.equal(notices[0].license, "MIT");
    assert.match(notices[0].text ?? "", /Permission is hereby granted/);
    assert.match(formatNotices("Test", notices), /three \d+\.\d+\.\d+\nLicense: MIT/);
  });
});

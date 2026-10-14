import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes `THIRD-PARTY-NOTICES.txt` into a build: the name, version, license and full license
 * text of every npm package whose code ends up in the bundle. MIT, ISC and the like require
 * their notice to travel with every copy, and the minifier strips it from the code itself.
 */
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.txt";

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** The package directory a bundled module came from, or null for the app's own code. */
export function packageDirOf(id) {
  if (!id || id.startsWith("\0")) return null;
  const path = id.split("?", 1)[0].replaceAll("\\", "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const depth = rest[0]?.startsWith("@") ? 2 : 1;
  if (rest.length <= depth) return null;
  return path.slice(0, at + "/node_modules/".length) + rest.slice(0, depth).join("/");
}

/** Every package behind the given module ids, with its license text, sorted by name. */
export function collectNotices(ids) {
  const dirs = new Set();
  for (const id of ids) {
    const dir = packageDirOf(id);
    if (dir) dirs.add(dir);
  }
  const byName = new Map();
  for (const dir of dirs) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!pkg.name || byName.has(`${pkg.name}@${pkg.version}`)) continue;
    const file = readdirSync(dir).find((f) => LICENSE_FILE.test(f));
    byName.set(`${pkg.name}@${pkg.version}`, {
      name: pkg.name,
      version: pkg.version ?? "",
      license: typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "UNKNOWN"),
      text: file ? readFileSync(join(dir, file), "utf8").trim() : null,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatNotices(title, notices) {
  const rule = "=".repeat(72);
  const head = [
    title,
    "",
    "This build includes the open-source packages below, each used under its own license.",
    "",
  ];
  const body = notices.map((n) =>
    [
      rule,
      `${n.name} ${n.version}`,
      `License: ${n.license}`,
      rule,
      "",
      n.text ?? "(no license file in the package)",
      "",
    ].join("\n"),
  );
  return head.join("\n") + "\n" + body.join("\n");
}

/** Vite plugin: emits the notices file next to the built page. */
export function thirdPartyNotices(title) {
  return {
    name: "third-party-notices",
    apply: "build",
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((c) =>
        c.type === "chunk" ? Object.keys(c.modules) : [],
      );
      this.emitFile({
        type: "asset",
        fileName: NOTICES_FILE,
        source: formatNotices(title, collectNotices(ids)),
      });
    },
  };
}

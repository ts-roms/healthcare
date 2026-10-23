/**
 * Cuts a release: bumps the root version, commits, tags (and optionally pushes and deploys). docs/runbooks/releases.md.
 *
 *   pnpm release <patch|minor|major|X.Y.Z> [--push] [--deploy] [--dry-run]
 *   pnpm release:check [vX.Y.Z]            the tag must equal the version in package.json (CI uses GITHUB_REF_NAME)
 *
 * patch        on release/vX.Y.*   → bumps on the current branch (cherry-pick the fix first)
 * minor, major on main             → creates release/vX.Y.Z from it
 * --push       pushes the branch and the tag; --deploy also moves `production` (what Railway deploys) to the tag
 * Nothing is pushed without a flag. Plain Node, no dependencies, so CI runs it without installing anything.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGE = "package.json";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function currentVersion() {
  return JSON.parse(readFileSync(PACKAGE, "utf8")).version;
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function git(args, { dry = false } = {}) {
  console.log(`$ git ${args.join(" ")}`);
  if (dry) return "";
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function query(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) fail(`"${version}" is not a version like 1.2.3`);
  return match.slice(1).map(Number);
}

function next(current, kind) {
  const [major, minor, patch] = parse(current);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  const [a, b, c] = parse(kind);
  if (a < major || (a === major && (b < minor || (b === minor && c <= patch)))) fail(`${kind} is not above the current ${current}`);
  return kind;
}

function check(tag) {
  const wanted = tag ?? process.env["GITHUB_REF_NAME"];
  if (!wanted) fail("name the tag: pnpm release:check v1.0.0");
  const expected = `v${currentVersion()}`;
  if (wanted !== expected) fail(`tag ${wanted} does not match package.json (${expected}). Bump the version before tagging.`);
  console.log(`release: ${wanted} matches package.json`);
}

function cut(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [request] = argv.filter((a) => !a.startsWith("--"));
  if (!request) fail("usage: pnpm release <patch|minor|major|X.Y.Z> [--push] [--deploy] [--dry-run]");
  const dry = flags.has("--dry-run");
  const deploy = flags.has("--deploy");
  const push = flags.has("--push") || deploy;

  const current = currentVersion();
  const version = next(current, request);
  const tag = `v${version}`;
  const [major, minor, patch] = parse(version);
  const branch = query(["branch", "--show-current"]);

  if (query(["status", "--porcelain", "--untracked-files=no"])) fail("the working tree has uncommitted changes");
  if (query(["tag", "--list", tag])) fail(`tag ${tag} already exists`);

  // A patch stays on its release branch; a new minor or major starts a new one from main.
  const isPatch = patch !== 0;
  let target = branch;
  if (isPatch) {
    if (!new RegExp(`^release/v${major}\\.${minor}\\.\\d+$`).test(branch)) {
      fail(`a patch (${version}) is made on release/v${major}.${minor}.*, not on "${branch}". Switch to it and cherry-pick the fix first.`);
    }
  } else {
    if (branch !== "main") fail(`a new minor or major (${version}) is cut from main, not from "${branch}"`);
    try {
      git(["fetch", "origin", "main", "--quiet"], { dry });
      if (!dry && Number(query(["rev-list", "--count", "main..origin/main"])) > 0) fail("main is behind origin/main: pull first");
    } catch {
      console.warn("release: could not reach origin; continuing without the up-to-date check");
    }
    target = `release/${tag}`;
    git(["switch", "-c", target], { dry });
  }

  if (!dry) {
    const text = readFileSync(PACKAGE, "utf8");
    writeFileSync(PACKAGE, text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
  } else {
    console.log(`(would set ${PACKAGE} version ${current} → ${version})`);
  }
  git(["commit", "-am", `Release ${tag}`], { dry });
  git(["tag", "-a", tag, "-m", tag], { dry });

  if (push) git(["push", "origin", target, tag], { dry });
  if (deploy) git(["push", "origin", `${tag}:refs/heads/production`, "--force-with-lease"], { dry });

  if (!push) {
    console.log(`\nDone locally. To publish: git push origin ${target} ${tag}`);
    console.log(`To deploy:      git push origin ${tag}:refs/heads/production --force-with-lease`);
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === "check") check(rest[0]);
else if (command) cut([command, ...rest]);
else fail("usage: pnpm release <patch|minor|major|X.Y.Z> [--push] [--deploy] [--dry-run]");

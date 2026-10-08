import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ownerOnly, runnerFixture } from "./runner.fixture.mjs";
import { claudeTokenFileRefusal, runnerConfig } from "./runnerConfig.mjs";
import { runnerPaths } from "./runnerPaths.mjs";

test("the runner keeps its file, logs and runtime where a Mac keeps each, and pool files where chuggy-linux does", () => {
  assert.deepEqual(runnerPaths("/Users/shame"), {
    config:
      "/Users/shame/Library/Application Support/chuggy-darwin/runner.json",
    pools: "/Users/shame/.config/chuggy/pools",
    logs: "/Users/shame/Library/Logs/chuggy-darwin",
    runtime: "/Users/shame/Library/Caches/chuggy-darwin",
  });
});

test("the runner's file takes the limits' defaults, and refuses an engine, since docker is the one", async (t) => {
  const { paths } = await runnerFixture(t);
  const config = await runnerConfig(paths.config);
  assert.equal(config.concurrencyMax, 1);
  assert.equal(config.sessionsMax, 2);
  assert.equal(config.network, "chuggy-jobs");
  const engined = await runnerFixture(t, { runner: { engine: "docker" } });
  await assert.rejects(runnerConfig(engined.paths.config), /engine/u);
});

test("the runner's file is refused where anyone but its owner can read it", async (t) => {
  const { paths } = await runnerFixture(t);
  await chmod(paths.config, 0o644);
  await assert.rejects(
    runnerConfig(paths.config),
    /is mode 644; only its owner may read or write it/u,
  );
});

test("a token file the runner owns alone, under the home the VM shares, can be handed to a job", async (t) => {
  const { home, tokenFile } = await runnerFixture(t);
  const uid = /** @type {() => number} */ (process.getuid)();
  assert.equal(
    await claudeTokenFileRefusal(tokenFile, { uid, home }),
    undefined,
  );
});

test("a token file outside the home, or linked to from inside it, is refused, since the VM would show a job nothing there", async (t) => {
  const { home } = await runnerFixture(t);
  const elsewhere = await mkdtemp(join(tmpdir(), "chuggy-darwin-elsewhere-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const outside = await ownerOnly(join(elsewhere, "token"), "t");
  const linked = join(home, "linked-token");
  await symlink(outside, linked);
  const uid = /** @type {() => number} */ (process.getuid)();
  for (const file of [outside, linked])
    assert.match(
      /** @type {string} */ (await claudeTokenFileRefusal(file, { uid, home })),
      /is not under .*, the only directory Colima shares with its VM by default/u,
    );
});

test("a token file anyone else can read, that is empty, missing, or another user's, is refused", async (t) => {
  const { home, tokenFile } = await runnerFixture(t);
  const uid = /** @type {() => number} */ (process.getuid)();
  assert.match(
    /** @type {string} */ (
      await claudeTokenFileRefusal(tokenFile, { uid: uid + 1, home })
    ),
    /is owned by uid \d+, not by this runner's uid \d+$/u,
  );
  assert.match(
    /** @type {string} */ (
      await claudeTokenFileRefusal(join(home, "absent"), { uid, home })
    ),
    /cannot be found/u,
  );
  await writeFile(tokenFile, "");
  assert.match(
    /** @type {string} */ (
      await claudeTokenFileRefusal(tokenFile, { uid, home })
    ),
    /is empty$/u,
  );
  await chmod(tokenFile, 0o644);
  assert.match(
    /** @type {string} */ (
      await claudeTokenFileRefusal(tokenFile, { uid, home })
    ),
    /is mode 644/u,
  );
});

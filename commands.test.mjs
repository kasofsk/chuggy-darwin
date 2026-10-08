import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliMain } from "./commands.mjs";
import { answeringFetch, registeredFixture } from "./register.fixture.mjs";

/**
 * @typedef {object} Machine
 * @property {string} [home]
 * @property {string} [hostname]
 * @property {string} [arch]
 * @property {typeof globalThis.fetch} [fetch]
 */

/**
 * @param {readonly string[]} argv
 * @param {Machine} machine
 */
async function called(argv, machine = {}) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const status = await cliMain(argv, {
    home: machine.home ?? "/nonexistent",
    hostname: machine.hostname ?? "shame",
    arch: machine.arch ?? "arm64",
    fetch:
      machine.fetch ??
      (async () => {
        throw new Error("a suite reaches no network");
      }),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { status, out: out.join("\n"), err: err.join("\n") };
}

/** @param {import("node:test").TestContext} t */
async function home(t) {
  const directory = await mkdtemp(join(tmpdir(), "chuggy-darwin-home-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** What chuggy answers a redemption from an Apple silicon Mac with. */
const registered = {
  ...registeredFixture,
  capabilities: ["Platform:Linux:Arm64"],
};

const registerArgv = [
  "register",
  "--api",
  "https://chuggy.example",
  "--token=registration-token-fixture",
];

test("help is asked for and answered", async () => {
  for (const argv of [["--help"], ["help"], ["-h"]]) {
    const { status, out } = await called(argv);
    assert.equal(status, 0);
    assert.match(out, /^usage: chuggy-darwin register/u);
  }
});

test("a call asked wrongly exits 2 with the usage", async () => {
  for (const argv of [
    [],
    ["run", "--pool", "/p"],
    ["register", "--pools", "/p"],
    [...registerArgv, "extra"],
  ]) {
    const { status, err } = await called(argv);
    assert.equal(status, 2, argv.join(" "));
    assert.match(err, /usage: chuggy-darwin/u, argv.join(" "));
  }
});

test("register writes the pool file it redeems the token for where chuggy-linux would, and prints no secret", async (t) => {
  const machine = await home(t);
  const { fetch, requests } = answeringFetch(201, registered);
  const { status, out, err } = await called(registerArgv, {
    home: machine,
    hostname: "Shame.local",
    fetch,
  });
  assert.equal(status, 0, err);
  const pools = join(machine, ".config", "chuggy", "pools");
  const file = join(pools, "newtenant.arbbot.shame.json");
  assert.equal(out, `wrote ${file}`);
  assert.equal(err, "");
  const body = JSON.parse(String(requests[0].init.body));
  assert.equal(body.pool, "shame");
  assert.deepEqual(body.capabilities, ["Platform:Linux:Arm64"]);
  assert.equal((await stat(pools)).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), registered);
  assert.ok(!`${out}${err}`.includes(registered.clientSecret));
  const again = await called(registerArgv, { home: machine, fetch });
  assert.equal(again.out, `replaced ${file}`);
});

test("an Intel Mac registers a pool of amd64 Linux", async (t) => {
  const { fetch, requests } = answeringFetch(201, registeredFixture);
  await called(registerArgv, { home: await home(t), arch: "x64", fetch });
  assert.deepEqual(JSON.parse(String(requests[0].init.body)).capabilities, [
    "Platform:Linux:Amd64",
  ]);
});

test("register asked wrongly exits 2 before the token is spent", async (t) => {
  const machine = await home(t);
  const { fetch, requests } = answeringFetch(201, registered);
  for (const [argv, arch, line] of [
    [registerArgv, "ia32", /^this machine is ia32/u],
    [
      [...registerArgv, "--pool", "Shame"],
      "arm64",
      /^--pool Shame is not a pool name/u,
    ],
    [
      ["register", "--api", "https://chuggy.example"],
      "arm64",
      /^register needs --api and --token$/u,
    ],
  ]) {
    const { status, err } = await called(/** @type {string[]} */ (argv), {
      home: machine,
      arch: /** @type {string} */ (arch),
      fetch,
    });
    assert.equal(status, 2, String(argv));
    assert.match(err, /** @type {RegExp} */ (line), String(argv));
  }
  assert.deepEqual(requests, []);
  await assert.rejects(stat(join(machine, ".config")), { code: "ENOENT" });
});

test("register writes nothing when chuggy refuses the token, and exits 1 with why", async (t) => {
  const machine = await home(t);
  const { status, out, err } = await called(registerArgv, {
    home: machine,
    fetch: answeringFetch(404, { error: { code: "NotFound" } }).fetch,
  });
  assert.equal(status, 1);
  assert.equal(out, "");
  assert.equal(
    err,
    "the registration token is unknown, spent or expired; mint another in chuggy's console",
  );
  assert.deepEqual(
    await readdir(join(machine, ".config", "chuggy", "pools")),
    [],
  );
});

test("register says the token is spent where chuggy answered but the pool file could not be written", async (t) => {
  const machine = await home(t);
  await mkdir(
    join(
      machine,
      ".config",
      "chuggy",
      "pools",
      "newtenant.arbbot.shame.json",
      "blocking",
    ),
    { recursive: true },
  );
  const { status, out, err } = await called(registerArgv, {
    home: machine,
    fetch: answeringFetch(201, registered).fetch,
  });
  assert.equal(status, 1);
  assert.equal(out, "");
  assert.match(
    err,
    /^the pool file could not be written, and the token is spent, so mint another: E/u,
  );
});

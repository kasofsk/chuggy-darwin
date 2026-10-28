import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { PassThrough } from "node:stream";
import test from "node:test";

import { chatSupervisorContainer } from "@chuggy/worker-core/chatHost.mjs";
import { poolIdentityDigest } from "@chuggy/worker-core/poolIdentity.mjs";

import {
  chatCredentialOwner,
  chatCredentialRefusal,
  chatFileRefusal,
  chatLogs,
  chatSettingsLine,
  chatSetup,
  chatSupervisorName,
  chatSupervisorPlaces,
  chatSupervisorRunArgv,
  chatSupervisorStarted,
} from "./chatRunner.mjs";
import { fakeEngine } from "./engine.fixture.mjs";
import {
  chatFixture,
  fixtureChatHost,
  fixturePool,
  ownerOnly,
} from "./runner.fixture.mjs";
import { runnerConfig } from "./runnerConfig.mjs";

/** A chat host's file and the runner's, read. */
async function chatRead(t, runner = {}) {
  const fixture = await chatFixture(t, { runner });
  const setup = await chatSetup(fixture.poolFile, fixture.home);
  return { ...fixture, ...setup };
}

test("the supervisor's argv carries every field of its container, its name, the chat host's label and the network, and its environment's names alone", async (t) => {
  const { credentials, config, tokenFile } = await chatRead(t);
  const container = chatSupervisorContainer(
    "registry.chuggy.example/worker@sha256:1",
    chatSupervisorPlaces(credentials, config),
  );
  const { argv, environment } = chatSupervisorRunArgv(container, {
    name: chatSupervisorName(credentials),
    pool: "vteng/member/chat/host",
    network: "chuggy",
  });
  const digest = poolIdentityDigest(credentials);
  const credentialDirectory = join(tokenFile, "..");
  assert.deepEqual(argv, [
    "run",
    "-i",
    "--rm",
    "--pull=never",
    "--name",
    `chuggy-chat-${digest}`,
    "--label",
    "io.chuggy.pool=vteng/member/chat/host",
    "--log-driver",
    "none",
    "--user",
    "0:0",
    "--cap-drop",
    "ALL",
    ...[
      "CHOWN",
      "DAC_OVERRIDE",
      "FOWNER",
      "FSETID",
      "SETUID",
      "SETGID",
      "SETPCAP",
    ].flatMap((cap) => ["--cap-add", cap]),
    "--security-opt",
    "no-new-privileges",
    "--mount",
    `type=volume,source=chuggy-chat-${digest}-sessions,target=/sessions`,
    "--mount",
    `type=volume,source=chuggy-chat-${digest}-mirrors,target=/var/lib/chuggy/mirrors`,
    "--tmpfs",
    "/var/run/chuggy:rw,nosuid,nodev,noexec,size=67108864,mode=0711,uid=0,gid=0",
    "--tmpfs",
    "/var/run/chuggy/credentials:rw,nosuid,nodev,noexec,size=1048576,mode=0700,uid=0,gid=0",
    "--mount",
    `type=bind,source=${credentialDirectory},target=/var/run/chuggy/credentials/claude-code,readonly`,
    "--env",
    "CHUG_WORKER_CREDENTIAL_FILES",
    "--env",
    "CHUG_WORKER_CLAUDE_CREDENTIAL",
    "--network",
    "chuggy",
    "--entrypoint",
    "/opt/chuggy/bin/tini",
    "registry.chuggy.example/worker@sha256:1",
    "-s",
    "--",
    "/opt/chuggy/bin/node",
    "/opt/chuggy/lib/chuggy/chatSupervisor.mjs",
  ]);
  assert.deepEqual(environment, {
    CHUG_WORKER_CREDENTIAL_FILES:
      '{"claude-code":"/var/run/chuggy/credentials/claude-code/token"}',
    CHUG_WORKER_CLAUDE_CREDENTIAL: '{"kind":"Subscription"}',
  });
});

test("a container the spec runs without input, with counts and repositories, is run so", () => {
  const container = chatSupervisorContainer("image", {
    volumes: { sessions: "s", mirrors: "m" },
    credentialFiles: {},
    credentialOwner: { uid: 0, gid: 0 },
    repositories: '{"a":"b"}',
    variables: { CHUG_CHAT_SESSIONS_MAX: "2" },
  });
  const { argv, environment } = chatSupervisorRunArgv(
    { ...container, interactive: false },
    { name: "n", pool: "p", network: "none" },
  );
  assert.ok(!argv.includes("-i"));
  assert.ok(argv.includes("CHUG_CHAT_SESSIONS_MAX"), argv.join(" "));
  assert.equal(environment.CHUG_CHAT_SESSIONS_MAX, "2");
  assert.equal(environment.CHUG_WORKER_REPOSITORIES, '{"a":"b"}');
  assert.ok(!argv.some((arg) => arg.startsWith("type=bind")));
});

test("a credential whose directory docker's --mount cannot name is refused before docker is asked", () => {
  const container = chatSupervisorContainer("image", {
    volumes: { sessions: "s", mirrors: "m" },
    credentialFiles: { "claude-code": "/Users/a,b/token" },
    credentialOwner: { uid: 0, gid: 0 },
  });
  assert.throws(
    () =>
      chatSupervisorRunArgv(container, { name: "n", pool: "p", network: "x" }),
    /cannot be named in a bind mount/u,
  );
});

test("the supervisor's places hand the runner's Claude credential under the plane's slot, owned by root as the VM presents it", async (t) => {
  const { credentials, config, tokenFile } = await chatRead(t);
  assert.deepEqual(chatSupervisorPlaces(credentials, config), {
    volumes: {
      sessions: `chuggy-chat-${poolIdentityDigest(credentials)}-sessions`,
      mirrors: `chuggy-chat-${poolIdentityDigest(credentials)}-mirrors`,
    },
    credentialFiles: { "claude-code": tokenFile },
    credentialOwner: { uid: 0, gid: 0 },
    claudeCredential: { kind: "Subscription" },
  });
  assert.deepEqual(chatCredentialOwner, { uid: 0, gid: 0 });
  assert.throws(
    () => chatSupervisorPlaces(fixturePool, config),
    /a chat host's alone/u,
  );
});

test("a chat host's file and a pool's are each refused where the other is wanted", async (t) => {
  assert.equal(chatFileRefusal(fixtureChatHost, "/c.json"), undefined);
  assert.match(
    chatFileRefusal(fixturePool, "/p.json") ?? "",
    /^\/p\.json is a pool's or a personal runner's, not a chat host's$/u,
  );
  const { home, poolFile } = await chatFixture(t);
  const pool = await ownerOnly(
    join(home, ".config", "chuggy", "pools", "p.json"),
    JSON.stringify(fixturePool),
  );
  await assert.rejects(chatSetup(pool, home), /not a chat host's/u);
  assert.equal((await chatSetup(poolFile, home)).poolFile, poolFile);
});

test("the credential is refused where its directory holds anything else, or it is a link, and passes alone", async (t) => {
  const { config, home, tokenFile } = await chatRead(t);
  const runner = { uid: process.getuid?.() ?? -1, home };
  assert.equal(await chatCredentialRefusal(config, runner), undefined);
  await writeFile(join(tokenFile, "..", "other"), "x");
  assert.match(
    (await chatCredentialRefusal(config, runner)) ?? "",
    /shares .* with other, and a chat host's supervisor is handed all of its directory; keep it in a directory of its own$/u,
  );
  const linked = join(home, ".linked", "token");
  await ownerOnly(join(home, ".elsewhere"), "claude-token-fixture");
  await ownerOnly(linked, "placeholder");
  await rm(linked);
  await symlink(join(home, ".elsewhere"), linked);
  const linkedConfig = await runnerConfig(
    await ownerOnly(
      join(home, "linked.json"),
      JSON.stringify({
        claudeTokenFile: linked,
        timeoutSecsMax: 3600,
        outputBytesMax: 65536,
      }),
    ),
  );
  assert.match(
    (await chatCredentialRefusal(linkedConfig, runner)) ?? "",
    /is a link, .* name the file itself$/u,
  );
});

test("the settings line names each bound and whose image runs", async (t) => {
  const { config } = await chatRead(t);
  assert.equal(
    chatSettingsLine(config),
    "sessionsMax 2, idleSecs 600, outputBytesMax 65536, image the one chuggy names",
  );
  const own = await chatRead(t, {
    chat: {
      sessionsMax: 3,
      idleSecs: 60,
      outputBytesMax: 1024,
      image: { image: "mine:1", pull: "never" },
    },
  });
  assert.equal(
    chatSettingsLine(own.config),
    "sessionsMax 3, idleSecs 60, outputBytesMax 1024, image mine:1, pulled never",
  );
});

/** A child process held in memory, as `spawn` would start docker. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    /** @type {string[]} */
    signals: [],
    /** @param {string} signal */
    kill(signal) {
      child.signals.push(signal);
      return true;
    },
  });
  return child;
}

test("the supervisor is started after its name's exited leftover is removed, its streams the CLI's, its environment the CLI's, and killed by name and as a process", async () => {
  const { engine, state } = fakeEngine();
  state.containers.set("chuggy-chat-1", {
    id: "c1",
    name: "chuggy-chat-1",
    labels: {},
    status: "exited",
    image: "i",
  });
  const child = fakeChild();
  /** @type {{command: string, argv: string[], options: unknown}[]} */
  const spawned = [];
  const handle = await chatSupervisorStarted(
    { argv: ["run", "-i", "x"], environment: { CHUG_NAMED: "its value" } },
    "chuggy-chat-1",
    {
      engine,
      spawn: /** @type {any} */ (
        (command, argv, options) => {
          spawned.push({ command, argv, options });
          return child;
        }
      ),
    },
  );
  assert.deepEqual(state.calls[0].argv, ["rm", "-v", "chuggy-chat-1"]);
  assert.ok(!state.containers.has("chuggy-chat-1"));
  assert.deepEqual(spawned, [
    {
      command: "docker",
      argv: ["run", "-i", "x"],
      options: {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CHUG_NAMED: "its value" },
      },
    },
  ]);
  assert.equal(handle.input, child.stdin);
  assert.equal(handle.output, child.stdout);
  assert.equal(handle.errors, child.stderr);
  handle.kill();
  assert.deepEqual(state.calls.at(-1)?.argv, ["kill", "chuggy-chat-1"]);
  assert.deepEqual(child.signals, ["SIGKILL"]);
  child.stdout.write("written before it exited\n");
  child.emit("exit", 137, null);
  assert.equal(await handle.exited, 137);
  assert.equal(
    String(child.stdout.read()),
    "written before it exited\n",
    "its output is read on after it exited",
  );
});

test("no supervisor is started beside a running container of its name, which is not removed", async () => {
  const { engine, state } = fakeEngine();
  state.containers.set("n", {
    id: "c1",
    name: "n",
    labels: {},
    status: "running",
    image: "i",
  });
  let spawned = 0;
  await assert.rejects(
    chatSupervisorStarted({ argv: ["run"], environment: {} }, "n", {
      engine,
      spawn: /** @type {any} */ (
        () => {
          spawned += 1;
          return fakeChild();
        }
      ),
    }),
    /a container named n is here and could not be removed, as one still running is not: .*container is running/u,
  );
  assert.equal(spawned, 0);
  assert.equal(state.containers.get("n")?.status, "running");
  assert.ok(state.calls.every(({ argv }) => !argv.includes("--force")));
});

test("a supervisor docker cannot start has exited", async () => {
  const child = fakeChild();
  const handle = await chatSupervisorStarted(
    { argv: ["run"], environment: {} },
    "n",
    {
      engine: fakeEngine().engine,
      spawn: /** @type {any} */ (() => child),
    },
  );
  const failure = new Error("spawn docker ENOENT");
  child.emit("error", failure);
  assert.equal(await handle.exited, failure);
});

test("each session's log is its own owner-only file, named for a digest, opened with the session and never past its cap", async (t) => {
  const { home, credentials } = await chatRead(t);
  /** @type {string[]} */
  const said = [];
  const logs = chatLogs(home, credentials, (line) => said.push(line));
  logs("assignment-1")("first");
  logs("assignment-1")("second");
  logs("assignment-2")("other");
  const file = join(
    home,
    `chat-${poolIdentityDigest(credentials, "assignment-1")}.log`,
  );
  assert.equal(
    await readFile(file, "utf8"),
    "session assignment-1\nfirst\nsecond\n",
  );
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const big = "x".repeat(10 * 1024 * 1024);
  logs("assignment-1")(big);
  logs("assignment-1")("past the cap");
  assert.equal(
    await readFile(file, "utf8"),
    "session assignment-1\nfirst\nsecond\n",
  );
  const fresh = chatLogs(home, credentials, (line) => said.push(line))(
    "assignment-1",
  );
  fresh("small");
  assert.match(await readFile(file, "utf8"), /second\nsmall\n$/u);
  assert.deepEqual(said, []);
});

test("a session's log that cannot be written keeps nothing more and says so once on the host's, throwing nothing; one whose directory is gone makes it", async (t) => {
  const { home, credentials } = await chatRead(t);
  const locked = join(home, "locked");
  await mkdir(locked, { mode: 0o500 });
  /** @type {string[]} */
  const said = [];
  const logs = chatLogs(locked, credentials, (line) => said.push(line));
  logs("assignment-1")("first");
  logs("assignment-1")("second");
  logs("assignment-1")("third");
  assert.equal(said.length, 1, said.join("\n"));
  assert.match(
    said[0] ?? "",
    /^.*\/locked\/chat-[0-9a-f]+\.log could not be written, and keeps nothing more: EACCES/u,
  );
  const gone = join(home, "gone");
  chatLogs(gone, credentials, (line) => said.push(line))("assignment-1")(
    "made",
  );
  assert.equal(said.length, 1);
  assert.equal((await stat(gone)).mode & 0o777, 0o700);
});

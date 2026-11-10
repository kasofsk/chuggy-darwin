import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import {
  chatHostMemoryBytes,
  chatHostSettingsLine,
  chatSupervisorContainer,
  chatSupervisorNaming,
} from "@chuggy/worker-core/chatHost.mjs";
import { chatSupervisorRunArgv } from "@chuggy/worker-core/engineArgv.mjs";
import { poolIdentityDigest } from "@chuggy/worker-core/poolIdentity.mjs";

import {
  chatCredentialOwner,
  chatCredentialRefusal,
  chatFileRefusal,
  chatHostSettings,
  chatSetup,
  chatSupervisorPlaces,
} from "./chatRunner.mjs";
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

test("a chat host's supervisor is capped at room for each session it runs, the credential's directory bound into root's, as the core runs it on docker", async (t) => {
  const { credentials, config, tokenFile } = await chatRead(t);
  const settings = chatHostSettings(credentials, config);
  assert.equal(settings.idleSecs, 600);
  assert.equal(settings.outputBytesMax, config.outputBytesMax);
  const { argv, environment } = chatSupervisorRunArgv(
    "docker",
    chatSupervisorContainer(
      "registry.chuggy.example/worker@sha256:1",
      settings.places,
      chatHostMemoryBytes(settings),
    ),
    chatSupervisorNaming(credentials, config.network),
  );
  const memory = argv[argv.indexOf("--memory") + 1];
  assert.equal(
    memory,
    `${String(settings.sessionsMax * settings.sessionMemoryBytes)}b`,
  );
  assert.equal(argv[argv.indexOf("--memory-swap") + 1], memory);
  assert.ok(
    argv.includes(
      `type=bind,source=${join(tokenFile, "..")},target=/var/run/chuggy/credentials/claude,readonly`,
    ),
    argv.join(" "),
  );
  assert.ok(
    argv.some(
      (arg) =>
        arg.startsWith("/var/run/chuggy/credentials:") &&
        arg.endsWith(",uid=0,gid=0"),
    ),
    argv.join(" "),
  );
  assert.equal(environment.CHUG_CHAT_CREDENTIAL_UID, "0");
  assert.equal(environment.CHUG_CHAT_CREDENTIAL_GID, "0");
  const own = await chatRead(t, {
    chat: { sessionsMax: 2, sessionMemoryMib: 1024 },
  });
  assert.equal(
    chatHostMemoryBytes(chatHostSettings(own.credentials, own.config)),
    2 * 1024 * 2 ** 20,
  );
});

test("the supervisor's places hand a selector over the runner's Claude credential, owned by root as the VM presents it", async (t) => {
  const { credentials, config, tokenFile } = await chatRead(t);
  const { credentials: selector, ...places } = chatSupervisorPlaces(
    credentials,
    config,
  );
  assert.deepEqual(places, {
    volumes: {
      sessions: `chuggy-chat-${poolIdentityDigest(credentials)}-sessions`,
      mirrors: `chuggy-chat-${poolIdentityDigest(credentials)}-mirrors`,
    },
    credentialOwner: { uid: 0, gid: 0 },
  });
  assert.deepEqual(selector?.described(), [
    {
      name: "claude",
      agent: "Claude",
      type: "OAuth",
      file: tokenFile,
      bench: { state: "Available" },
    },
  ]);
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
    /holds other beside the credential .*; keep the credential in a directory of its own$/u,
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

test("the core's settings line says each bound and whose image runs as the runner's file sets them", async (t) => {
  const own = await chatRead(t, {
    chat: {
      sessionsMax: 3,
      sessionMemoryMib: 1024,
      idleSecs: 60,
      outputBytesMax: 1024,
      image: { image: "mine:1", pull: "never" },
    },
  });
  assert.equal(
    chatHostSettingsLine(chatHostSettings(own.credentials, own.config)),
    "sessionsMax 3, sessionMemoryMib 1024, so the supervisor is capped at 3072 MiB, idleSecs 60, outputBytesMax 1024, image mine:1, pulled never",
  );
  const { credentials, config } = await chatRead(t);
  assert.match(
    chatHostSettingsLine(chatHostSettings(credentials, config)),
    /, image the one chuggy names$/u,
  );
});

/**
 * Catches a chat host handed only one credential of its set, so a session
 * the selector chose another for finds no file, or one started while a
 * credential of the set is outside the home the VM shares.
 */
test("a chat host's supervisor is handed each Claude credential of a set, each directory bound, and is refused while any one is outside the home", async (t) => {
  const { home } = await chatFixture(t);
  const files = await Promise.all(
    ["max-1", "max-2"].map((name) =>
      ownerOnly(join(home, ".claude", name, "token"), `${name}-token`),
    ),
  );
  const set = (/** @type {string[]} */ tokenFiles) => ({
    claudeTokenFile: undefined,
    claudeCredential: {
      prefer: "OAuthOnly",
      oauth: {
        order: "RoundRobin",
        credentials: tokenFiles.map((tokenFile, index) => ({
          name: `max-${String(index + 1)}`,
          tokenFile,
        })),
      },
    },
  });
  const { credentials, config } = await chatRead(t, set(files));
  const settings = chatHostSettings(credentials, config);
  const { argv, environment } = chatSupervisorRunArgv(
    "docker",
    chatSupervisorContainer(
      "worker",
      settings.places,
      chatHostMemoryBytes(settings),
    ),
    chatSupervisorNaming(credentials, config.network),
  );
  for (const [index, file] of files.entries())
    assert.ok(
      argv.includes(
        `type=bind,source=${join(file, "..")},target=/var/run/chuggy/credentials/max-${String(index + 1)},readonly`,
      ),
      argv.join(" "),
    );
  assert.deepEqual(
    JSON.parse(environment.CHUG_CHAT_CREDENTIALS ?? "[]").map(
      (/** @type {{name: string}} */ held) => held.name,
    ),
    ["max-1", "max-2"],
  );
  const runner = { uid: process.getuid?.() ?? -1, home };
  assert.equal(await chatCredentialRefusal(config, runner), undefined);
  const elsewhere = await mkdtemp(join(tmpdir(), "chuggy-darwin-chat-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const outside = await ownerOnly(join(elsewhere, "token"), "token");
  const refused = await chatRead(t, set([files[0], outside]));
  assert.match(
    (await chatCredentialRefusal(refused.config, runner)) ?? "",
    new RegExp(`^the Claude token file ${outside} is not under `, "u"),
  );
});

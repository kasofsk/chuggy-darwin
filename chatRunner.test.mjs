import assert from "node:assert/strict";
import { rm, symlink, writeFile } from "node:fs/promises";
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
      `type=bind,source=${join(tokenFile, "..")},target=/var/run/chuggy/credentials/provider,readonly`,
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

test("the supervisor's places hand the runner's Claude credential, owned by root as the VM presents it", async (t) => {
  const { credentials, config, tokenFile } = await chatRead(t);
  assert.deepEqual(chatSupervisorPlaces(credentials, config), {
    volumes: {
      sessions: `chuggy-chat-${poolIdentityDigest(credentials)}-sessions`,
      mirrors: `chuggy-chat-${poolIdentityDigest(credentials)}-mirrors`,
    },
    credentialFile: tokenFile,
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

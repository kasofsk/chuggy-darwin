import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  claudeCredentialDescribed,
  claudeCredentialProviderVariables,
  claudeCredentialVariables,
} from "@chuggy/worker-core/claudeCredential.mjs";
import { reservedJobVariables } from "@chuggy/worker-core/job.mjs";

import { registeredPersonalFixture } from "./register.fixture.mjs";
import { fixturePool, ownerOnly, runnerFixture } from "./runner.fixture.mjs";
import {
  credentialFileRefusal,
  runnerCredentialDescribed,
  runnerCredentialsHanded,
  runnerConfig,
  runnerConfigLimits,
  runnerPoolLimits,
  runnerPoolLimitsRefusal,
  runnerVolumesRefusal,
} from "./runnerConfig.mjs";
import { runnerPaths } from "./runnerPaths.mjs";

/** The setting a subscription's token is told by. */
const subscription = { kind: /** @type {const} */ ("Subscription") };

/**
 * A credential as the core's describe export answers it, available.
 *
 * @param {string} name
 * @param {string} agent
 * @param {string} type
 * @param {string} file
 */
function described(name, agent, type, file) {
  return { name, agent, type, file, bench: { state: "Available" } };
}

/**
 * A Codex `auth.json` as the selector holds one.
 *
 * @param {string} file
 * @returns {import("@chuggy/worker-core/agentCredentialSet.mjs").AgentCredential}
 */
function codexAuth(file) {
  return { agent: "Codex", name: "codex", type: "OAuth", file };
}

/** A Claude credential of each kind, as a runner's file names one. */
const credentials = [
  {
    kind: "Subscription",
    tokenFile: "/Users/shame/.config/chuggy/claude-token",
  },
  {
    kind: "ApiKey",
    apiKeyFile: "/Users/shame/.config/chuggy/anthropic-api-key",
  },
  {
    kind: "Bedrock",
    region: "us-west-2",
    apiKeyFile: "/Users/shame/.config/chuggy/bedrock-api-key",
  },
  {
    kind: "Bedrock",
    region: "us-west-2",
    credentialsFile: "/Users/shame/.aws/credentials",
    profile: "chuggy",
  },
  {
    kind: "Vertex",
    region: "us-east5",
    project: "chuggy-jobs",
    credentialsFile: "/Users/shame/.config/gcloud/chuggy-jobs.json",
  },
  {
    kind: "Foundry",
    resource: "chuggy-jobs",
    apiKeyFile: "/Users/shame/.config/chuggy/foundry-api-key",
  },
];

test("the runner keeps its file, agents, logs, host jobs, image record and runtime where a Mac keeps each, and pool files and sign-ins where chuggy-linux does", () => {
  assert.deepEqual(runnerPaths("/Users/shame"), {
    config:
      "/Users/shame/Library/Application Support/chuggy-darwin/runner.json",
    agents: "/Users/shame/Library/LaunchAgents",
    pools: "/Users/shame/.config/chuggy/pools",
    signIns: "/Users/shame/.config/chuggy/sign-ins",
    logs: "/Users/shame/Library/Logs/chuggy-darwin",
    jobs: "/Users/shame/Library/Application Support/chuggy-darwin/jobs",
    images: "/Users/shame/Library/Application Support/chuggy-darwin/images",
    runtime: "/Users/shame/Library/Caches/chuggy-darwin",
  });
});

test("the runner's file takes the limits' defaults, and refuses an engine, since docker is the one", async (t) => {
  const { paths } = await runnerFixture(t);
  const config = await runnerConfig(paths.config);
  assert.equal(config.concurrencyMax, 1);
  assert.equal(config.sessionsMax, 2);
  assert.equal(config.network, "chuggy-jobs");
  assert.deepEqual(config.images, []);
  assert.deepEqual(config.pools, {});
  assert.deepEqual(config.volumes, []);
  assert.equal(config.imageUnusedSecsMax, 604_800);
  assert.equal(config.diskFreeGibMin, 20);
  assert.equal(config.memoryFreeGibMin, 0);
  assert.equal(config.memoryReservedGib, 0);
  const engined = await runnerFixture(t, { runner: { engine: "docker" } });
  await assert.rejects(runnerConfig(engined.paths.config), /engine/u);
});

test("the runner updates itself unless its file turns that off", async (t) => {
  for (const [runner, autoUpdate] of /** @type {const} */ ([
    [{}, true],
    [{ autoUpdate: true }, true],
    [{ autoUpdate: false }, false],
  ])) {
    const { paths } = await runnerFixture(t, { runner });
    assert.equal((await runnerConfig(paths.config)).autoUpdate, autoUpdate);
  }
  for (const autoUpdate of ["false", 0, null]) {
    const { paths } = await runnerFixture(t, { runner: { autoUpdate } });
    await assert.rejects(runnerConfig(paths.config), {
      message: new RegExp(
        `^runner configuration ${paths.config}: autoUpdate Invalid input: expected boolean`,
        "u",
      ),
    });
  }
});

test("the runner reports on itself only where its file turns that on", async (t) => {
  for (const [runner, reportMetrics] of /** @type {const} */ ([
    [{}, false],
    [{ reportMetrics: true }, true],
    [{ reportMetrics: false }, false],
  ])) {
    const { paths } = await runnerFixture(t, { runner });
    assert.equal(
      (await runnerConfig(paths.config)).reportMetrics,
      reportMetrics,
    );
  }
  for (const reportMetrics of ["true", 1, null]) {
    const { paths } = await runnerFixture(t, { runner: { reportMetrics } });
    await assert.rejects(runnerConfig(paths.config), {
      message: new RegExp(
        `^runner configuration ${paths.config}: reportMetrics Invalid input: expected boolean`,
        "u",
      ),
    });
  }
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
    await credentialFileRefusal(
      claudeCredentialDescribed(subscription),
      tokenFile,
      { uid, home },
    ),
    undefined,
  );
});

test("a token file outside the home, linked to from inside it, or named outside it by a link leading in, is refused, since the VM would show a job nothing there", async (t) => {
  const { home, tokenFile } = await runnerFixture(t);
  const elsewhere = await mkdtemp(join(tmpdir(), "chuggy-darwin-elsewhere-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const outside = await ownerOnly(join(elsewhere, "token"), "t");
  const linkedOut = join(home, "linked-token");
  await symlink(outside, linkedOut);
  const linkedIn = join(elsewhere, "linked-in");
  await symlink(tokenFile, linkedIn);
  const uid = /** @type {() => number} */ (process.getuid)();
  for (const file of [outside, linkedOut, linkedIn])
    assert.match(
      /** @type {string} */ (
        await credentialFileRefusal(
          claudeCredentialDescribed(subscription),
          file,
          { uid, home },
        )
      ),
      /^the Claude token file .* is not under .*, or leads outside it, and .* is the only directory Colima shares with its VM by default/u,
      file,
    );
  const linkedWithin = join(home, "within");
  await symlink(tokenFile, linkedWithin);
  assert.equal(
    await credentialFileRefusal(
      claudeCredentialDescribed(subscription),
      linkedWithin,
      {
        uid,
        home,
      },
    ),
    undefined,
  );
});

/**
 * Catches a Codex credential's file a bind mount cannot name, or a line
 * naming more than it, accepted; one named and not handed to the backends as
 * Codex's; or one handed where the file names none.
 */
test("a file may name a Codex credential's auth.json beside the Claude one, handed to the backends as Codex's, and one naming none hands no other agent's", async (t) => {
  const authFile = "/Users/you/.codex/auth.json";
  const { paths, tokenFile } = await runnerFixture(t, {
    runner: { codexCredential: { authFile } },
  });
  const read = await runnerConfig(paths.config);
  assert.deepEqual(read.codexCredential, { authFile });
  assert.deepEqual(runnerCredentialsHanded(read).credentials.described(), [
    described("claude", "Claude", "OAuth", tokenFile),
    described("codex", "Codex", "OAuth", authFile),
  ]);
  for (const [codexCredential, why] of [
    [
      { authFile: "auth.json" },
      /codexCredential\.authFile must be an absolute path/u,
    ],
    [
      { authFile: "/a,readonly=false" },
      /codexCredential\.authFile cannot be named in a bind mount/u,
    ],
    [
      { authFile, kind: "ChatGPT" },
      /codexCredential Unrecognized key: "kind"/u,
    ],
    [{}, /codexCredential\.authFile is required: a file/u],
  ]) {
    const refused = await runnerFixture(t, { runner: { codexCredential } });
    await assert.rejects(
      runnerConfig(refused.paths.config),
      why,
      JSON.stringify(codexCredential),
    );
  }
});

/**
 * Catches the Codex file's refusal naming it as Claude's, or telling its
 * owner to save a Claude credential there.
 */
test("a Codex credential's file a job cannot be handed is refused as a Claude one's is, naming the Codex auth file and how to make one", async (t) => {
  const { home } = await runnerFixture(t);
  const uid = /** @type {() => number} */ (process.getuid)();
  const file = join(home, ".codex", "auth.json");
  const codex = runnerCredentialDescribed(codexAuth(file));
  assert.equal(
    await credentialFileRefusal(codex, file, { uid, home }),
    `the Codex auth file ${file} cannot be found; run codex login, which writes it to ~/.codex/auth.json`,
  );
  await ownerOnly(file, "");
  assert.equal(
    await credentialFileRefusal(codex, file, { uid, home }),
    `the Codex auth file ${file} is empty; run codex login, which writes it to ~/.codex/auth.json`,
  );
  assert.equal(
    await credentialFileRefusal(
      runnerCredentialDescribed({ ...codexAuth(file), type: "ApiKey" }),
      file,
      { uid, home },
    ),
    `the Codex API key file ${file} is empty; save an OpenAI API key there, alone`,
  );
  assert.deepEqual(
    runnerCredentialDescribed({
      agent: "Claude",
      name: "claude",
      type: "OAuth",
      file,
      setting: subscription,
    }),
    claudeCredentialDescribed(subscription),
  );
});

test("a token file anyone else can read, that is empty, missing, or another user's, is refused", async (t) => {
  const { home, tokenFile } = await runnerFixture(t);
  const uid = /** @type {() => number} */ (process.getuid)();
  /** @param {string} file */
  const refusal = async (file, runner = { uid, home }) =>
    (await credentialFileRefusal(
      claudeCredentialDescribed(subscription),
      file,
      runner,
    )) ?? "";
  assert.match(
    await refusal(tokenFile, { uid: uid + 1, home }),
    /is owned by uid \d+, not by this runner's uid \d+$/u,
  );
  const absent = join(home, "absent");
  assert.equal(
    await refusal(absent),
    `the Claude token file ${absent} cannot be found; save \`claude setup-token\`'s output there, alone`,
  );
  await writeFile(tokenFile, "");
  assert.match(
    await refusal(tokenFile),
    /is empty; save `claude setup-token`'s output there, alone$/u,
  );
  await chmod(tokenFile, 0o644);
  assert.match(await refusal(tokenFile), /is mode 644/u);
});

test("a Claude credential's file a job cannot be handed is refused, naming the file its kind is and what to save there", async (t) => {
  const { home } = await runnerFixture(t);
  const uid = /** @type {() => number} */ (process.getuid)();
  const missing = join(home, "missing");
  const elsewhere = await mkdtemp(join(tmpdir(), "chuggy-darwin-elsewhere-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const outside = await ownerOnly(join(elsewhere, "key.json"), "{}");
  for (const [setting, file, said] of [
    [
      { kind: "ApiKey" },
      missing,
      `the Anthropic API key file ${missing} cannot be found; save a key from the Claude Console there, alone`,
    ],
    [
      { kind: "Bedrock", region: "us-west-2", profile: "chuggy" },
      missing,
      `the AWS credentials file ${missing} cannot be found; give its [chuggy] profile an access key's aws_access_key_id and aws_secret_access_key`,
    ],
    [
      { kind: "Vertex", region: "us-east5", project: "chuggy-jobs" },
      outside,
      `the Google service account key file ${outside} is not under ${home}, or leads outside it, and ${home} is the only directory Colima shares with its VM by default, so a job would find nothing at its mount`,
    ],
  ])
    assert.equal(
      await credentialFileRefusal(
        claudeCredentialDescribed(/** @type {any} */ (setting)),
        /** @type {string} */ (file),
        { uid, home },
      ),
      said,
    );
});

test("a file names a Claude credential of any kind in claudeCredential, read as it is named and handed as its file and kind", async (t) => {
  for (const claudeCredential of credentials) {
    const { paths } = await runnerFixture(t, {
      runner: { claudeTokenFile: undefined, claudeCredential },
    });
    const read = await runnerConfig(paths.config);
    assert.deepEqual(read.claudeCredential, claudeCredential);
    assert.equal("claudeTokenFile" in read, false);
    const { kind, ...rest } = claudeCredential;
    const chosen = runnerCredentialsHanded(read).credentials.chosen("Claude");
    assert.equal(
      chosen?.file,
      rest.tokenFile ?? rest.apiKeyFile ?? rest.credentialsFile,
    );
    assert.equal(chosen?.name, "claude");
    assert.equal(chosen?.setting?.kind, kind);
  }
  const { paths, tokenFile } = await runnerFixture(t);
  assert.deepEqual(
    runnerCredentialsHanded(
      await runnerConfig(paths.config),
    ).credentials.described(),
    [described("claude", "Claude", "OAuth", tokenFile)],
  );
});

test("a file naming a Claude credential by both keys, or by neither, is refused, one naming neither as one naming no token file always was", async (t) => {
  const neither = await runnerFixture(t, {
    runner: { claudeTokenFile: undefined },
  });
  await assert.rejects(runnerConfig(neither.paths.config), {
    message: `runner configuration ${neither.paths.config}: claudeTokenFile Invalid input: expected string, received undefined`,
  });
  const unlimited = await runnerFixture(t, {
    runner: { claudeTokenFile: undefined, timeoutSecsMax: undefined },
  });
  await assert.rejects(
    runnerConfig(unlimited.paths.config),
    /timeoutSecsMax .*; claudeTokenFile Invalid input: expected string, received undefined$/u,
  );
  for (const claudeCredential of credentials) {
    const both = await runnerFixture(t, { runner: { claudeCredential } });
    await assert.rejects(runnerConfig(both.paths.config), {
      message: `runner configuration ${both.paths.config}: claudeCredential names a Claude credential, and so does claudeTokenFile; keep one`,
    });
  }
});

test("what a Claude credential may not say is refused, naming where", async (t) => {
  const refused = [
    [
      { kind: "OAuth" },
      /claudeCredential\.kind names no kind of Claude credential/u,
    ],
    [
      { kind: "Subscription", tokenFile: "claude-token" },
      /claudeCredential\.tokenFile must be an absolute path/u,
    ],
    [
      { kind: "ApiKey", apiKeyFile: "/Users/shame/a,readonly=false" },
      /claudeCredential\.apiKeyFile cannot be named in a bind mount/u,
    ],
    [
      {
        kind: "Vertex",
        region: "r",
        project: "p",
        credentialsFile: "key.json",
      },
      /claudeCredential\.credentialsFile must be an absolute path/u,
    ],
    [
      { kind: "ApiKey", apiKeyFile: "/k", region: "us-west-2" },
      /claudeCredential Unrecognized key: "region"/u,
    ],
    [{ kind: "Bedrock", apiKeyFile: "/k" }, /claudeCredential\.region /u],
  ];
  for (const [claudeCredential, why] of refused) {
    const { paths } = await runnerFixture(t, {
      runner: { claudeTokenFile: undefined, claudeCredential },
    });
    await assert.rejects(
      runnerConfig(paths.config),
      why,
      JSON.stringify(claudeCredential),
    );
  }
});

test("the environment may name any other variable that chooses Claude Code's credential or where it is sent, read as written whatever kind is named", async (t) => {
  const environment = Object.fromEntries(
    [
      ...claudeCredentialVariables.filter(
        (name) => !reservedJobVariables.includes(name),
      ),
      ...credentials.flatMap(({ kind }) =>
        claudeCredentialProviderVariables(kind),
      ),
    ].map((name) => [name, "elsewhere"]),
  );
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "AWS_PROFILE"])
    assert.ok(Object.hasOwn(environment, name), name);
  for (const named of [
    {},
    ...credentials.map((claudeCredential) => ({
      claudeTokenFile: undefined,
      claudeCredential,
    })),
  ]) {
    const { paths } = await runnerFixture(t, {
      runner: { ...named, environment },
    });
    assert.deepEqual(
      (await runnerConfig(paths.config)).environment,
      environment,
    );
  }
});

test("what the file may not say is refused, naming where", async (t) => {
  const refused = [
    [{ claudeTokenFile: "token" }, /claudeTokenFile must be an absolute path/u],
    [
      { claudeTokenFile: "/Users/shame/a,b" },
      /claudeTokenFile cannot be named in a bind mount/u,
    ],
    [{ network: "host" }, /network may not be the host's network/u],
    [
      { environment: { CHUG_WORKER_TASK: "{}" } },
      /environment\.CHUG_WORKER_TASK is the runner's to set/u,
    ],
    [
      { environment: { CLAUDE_CODE_OAUTH_TOKEN: "x" } },
      /environment\.CLAUDE_CODE_OAUTH_TOKEN is the runner's to set/u,
    ],
    [
      { environment: { CHUG_WORKER_CLAUDE_CREDENTIAL: "{}" } },
      /environment\.CHUG_WORKER_CLAUDE_CREDENTIAL is the runner's to set/u,
    ],
    [
      { environment: { NAME: "a\nB=c" } },
      /environment\.NAME may not break a line/u,
    ],
    [
      { images: [{ image: "x", capabilities: ["Platform:Linux:Arm64"] }] },
      /images\.0\.capabilities\.0 names a platform/u,
    ],
  ];
  for (const [runner, line] of refused) {
    const { paths } = await runnerFixture(t, { runner });
    await assert.rejects(runnerConfig(paths.config), line);
  }
});

test("sessionsMax may be 0, holding no sessions", async (t) => {
  const { paths } = await runnerFixture(t, { runner: { sessionsMax: 0 } });
  assert.equal((await runnerConfig(paths.config)).sessionsMax, 0);
});

test("concurrencyMax may be 0 beside sessions, for a runner that takes sessions alone, and not where sessionsMax is 0 too", async (t) => {
  for (const sessions of [{}, { sessionsMax: 1 }]) {
    const { paths } = await runnerFixture(t, {
      runner: { concurrencyMax: 0, ...sessions },
    });
    const config = await runnerConfig(paths.config);
    assert.equal(config.concurrencyMax, 0);
    assert.equal(config.sessionsMax, sessions.sessionsMax ?? 2);
  }
  const { paths } = await runnerFixture(t, {
    runner: { concurrencyMax: 0, sessionsMax: 0 },
  });
  await assert.rejects(runnerConfig(paths.config), {
    message: `runner configuration ${paths.config}: concurrencyMax is 0 and so is sessionsMax, so this runner would take no work`,
  });
});

test("a pool's entry in pools sets its own service's limits in place of the file's, each it names, and no other pool's", async (t) => {
  const pools = {
    "vteng.chuggy.lead": { concurrencyMax: 0, sessionsMax: 1 },
    "vteng.chuggy.builds": { sessionsMax: 0 },
  };
  const { paths } = await runnerFixture(t, {
    runner: { concurrencyMax: 2, pools },
  });
  const config = await runnerConfig(paths.config);
  assert.deepEqual(config.pools, pools);
  /** @type {[string, {concurrencyMax: number, sessionsMax: number}, string][]} */
  const cases = [
    [
      "vteng.chuggy.lead",
      { concurrencyMax: 0, sessionsMax: 1 },
      "concurrencyMax 0, sessionsMax 1, as pools.vteng.chuggy.lead sets them",
    ],
    [
      "vteng.chuggy.builds",
      { concurrencyMax: 2, sessionsMax: 0 },
      "concurrencyMax 2, sessionsMax 0, as pools.vteng.chuggy.builds sets them",
    ],
    [
      "vteng.28_3ahttps_3a_2f_2fauth_2echuggy_2eexample_2fmember",
      { concurrencyMax: 2, sessionsMax: 2 },
      "concurrencyMax 2, sessionsMax 2",
    ],
    [
      "vteng.chuggy",
      { concurrencyMax: 2, sessionsMax: 2 },
      "concurrencyMax 2, sessionsMax 2",
    ],
    [
      "constructor",
      { concurrencyMax: 2, sessionsMax: 2 },
      "concurrencyMax 2, sessionsMax 2",
    ],
  ];
  for (const [name, limits, line] of cases) {
    const poolFile = `${paths.pools}/${name}.json`;
    assert.deepEqual(
      runnerPoolLimits(config, poolFile, fixturePool),
      limits,
      name,
    );
    assert.equal(runnerConfigLimits(config, poolFile, fixturePool), line, name);
    assert.equal(
      runnerPoolLimitsRefusal(config, paths.config, poolFile, fixturePool),
      undefined,
    );
  }
});

test("a personal runner's service holds no session whatever the file or its entry in pools says, and its limits name its jobs alone", async (t) => {
  const name = "newtenant.member";
  const poolFile = `/pools/${name}.json`;
  /** @type {[Record<string, unknown>, number, string][]} */
  const cases = [
    [{}, 2, "concurrencyMax 2"],
    [{ [name]: { sessionsMax: 3 } }, 2, "concurrencyMax 2"],
    [
      { [name]: { concurrencyMax: 1, sessionsMax: 3 } },
      1,
      `concurrencyMax 1, as pools.${name} sets it`,
    ],
  ];
  for (const [pools, concurrencyMax, line] of cases) {
    const { paths } = await runnerFixture(t, {
      runner: { concurrencyMax: 2, sessionsMax: 4, pools },
    });
    const config = await runnerConfig(paths.config);
    const said = JSON.stringify(pools);
    assert.deepEqual(
      runnerPoolLimits(config, poolFile, registeredPersonalFixture),
      { concurrencyMax, sessionsMax: 0 },
      said,
    );
    assert.equal(
      runnerConfigLimits(config, poolFile, registeredPersonalFixture),
      line,
      said,
    );
    assert.equal(
      runnerPoolLimitsRefusal(
        config,
        paths.config,
        poolFile,
        registeredPersonalFixture,
      ),
      undefined,
      said,
    );
  }
});

test("a personal runner's service is refused where its concurrencyMax is 0, naming the key that sets it, its own entry's as the remedy and the chat host, while a pool's takes sessions alone", async (t) => {
  const name = "newtenant.member";
  const poolFile = `/pools/${name}.json`;
  /** @type {[Record<string, unknown>, string][]} */
  const cases = [
    [{ concurrencyMax: 0, sessionsMax: 2 }, "concurrencyMax"],
    [
      { pools: { [name]: { concurrencyMax: 0, sessionsMax: 1 } } },
      `pools.${name}.concurrencyMax`,
    ],
  ];
  for (const [runner, key] of cases) {
    const { paths } = await runnerFixture(t, { runner });
    const config = await runnerConfig(paths.config);
    assert.equal(
      runnerPoolLimitsRefusal(
        config,
        paths.config,
        poolFile,
        registeredPersonalFixture,
      ),
      `runner configuration ${paths.config}: ${key} is 0, and a personal runner is handed no sessions, so this one would take no work; set pools.${name}.concurrencyMax above 0 and load its agent again, or run your chats on a chat host (chuggy-darwin register --chat) and unload this agent`,
    );
    assert.equal(
      runnerPoolLimitsRefusal(config, paths.config, poolFile, fixturePool),
      undefined,
    );
  }
});

test("a pool's entry is refused where it leaves that pool's service no work, whichever limit it takes from the file, or names a key a pool's limits do not have", async (t) => {
  const refusal =
    "pools.vteng.chuggy.lead leaves this pool's service concurrencyMax 0 and sessionsMax 0, so it would take no work";
  /** @type {[Record<string, unknown>, string][]} */
  const refused = [
    [
      { pools: { "vteng.chuggy.lead": { concurrencyMax: 0, sessionsMax: 0 } } },
      refusal,
    ],
    [
      { sessionsMax: 0, pools: { "vteng.chuggy.lead": { concurrencyMax: 0 } } },
      refusal,
    ],
    [
      {
        concurrencyMax: 0,
        sessionsMax: 1,
        pools: { "vteng.chuggy.lead": { sessionsMax: 0 } },
      },
      refusal,
    ],
    [
      { pools: { "vteng.chuggy.lead": { timeoutSecsMax: 60 } } },
      'pools.vteng.chuggy.lead Unrecognized key: "timeoutSecsMax"',
    ],
    [
      { pools: { "vteng.chuggy.lead": { concurrencyMax: -1 } } },
      "pools.vteng.chuggy.lead.concurrencyMax Too small: expected number to be >=0",
    ],
  ];
  for (const [runner, why] of refused) {
    const { paths } = await runnerFixture(t, { runner });
    await assert.rejects(runnerConfig(paths.config), {
      message: `runner configuration ${paths.config}: ${why}`,
    });
  }
  const { paths } = await runnerFixture(t, {
    runner: {
      concurrencyMax: 0,
      sessionsMax: 1,
      pools: { "vteng.chuggy.builds": { concurrencyMax: 2, sessionsMax: 0 } },
    },
  });
  assert.deepEqual((await runnerConfig(paths.config)).pools, {
    "vteng.chuggy.builds": { concurrencyMax: 2, sessionsMax: 0 },
  });
});

test("a job's image this runner pulled is kept a week unused unless the file says otherwise, and 0 keeps it", async (t) => {
  for (const imageUnusedSecsMax of [0, 86_400]) {
    const { paths } = await runnerFixture(t, {
      runner: { imageUnusedSecsMax },
    });
    assert.equal(
      (await runnerConfig(paths.config)).imageUnusedSecsMax,
      imageUnusedSecsMax,
    );
  }
  for (const imageUnusedSecsMax of [-1, 1.5, "604800"]) {
    const { paths } = await runnerFixture(t, {
      runner: { imageUnusedSecsMax },
    });
    await assert.rejects(runnerConfig(paths.config), /imageUnusedSecsMax/u);
  }
});

test("what the VM keeps free of its disk and of its memory, and what it reserves of that memory from jobs, is any whole GiB the file sets, 0 among them", async (t) => {
  const most = Math.floor(Number.MAX_SAFE_INTEGER / 2 ** 30);
  for (const key of /** @type {const} */ ([
    "diskFreeGibMin",
    "memoryFreeGibMin",
    "memoryReservedGib",
  ])) {
    for (const gib of [0, 50, most]) {
      const { paths } = await runnerFixture(t, { runner: { [key]: gib } });
      assert.equal((await runnerConfig(paths.config))[key], gib);
    }
    for (const gib of [-1, 1.5, "20", most + 1]) {
      const { paths } = await runnerFixture(t, { runner: { [key]: gib } });
      await assert.rejects(runnerConfig(paths.config), new RegExp(key, "u"));
    }
  }
});

test("a file may declare what its Mac meets, read as written, and a platform, a token no requirement can name, or one named twice is refused, naming where", async (t) => {
  const { paths } = await runnerFixture(t, {
    runner: { capabilities: ["gpu", "Tool:Xcode"] },
  });
  assert.deepEqual((await runnerConfig(paths.config)).capabilities, [
    "gpu",
    "Tool:Xcode",
  ]);
  for (const [capabilities, why] of [
    [
      ["gpu", "Platform:Linux:Arm64"],
      /capabilities\.1 is a platform, which the runner finds of this machine/u,
    ],
    [["gpu", "gpu"], /capabilities\.1 is named by an earlier entry/u],
    [["no spaces"], /capabilities\.0 /u],
  ]) {
    const refused = await runnerFixture(t, { runner: { capabilities } });
    await assert.rejects(
      runnerConfig(refused.paths.config),
      why,
      JSON.stringify(capabilities),
    );
  }
});

test("a file may list volumes as the core reads them, a named volume scoped per project among them, and what one may not say is refused, naming where", async (t) => {
  const volumes = [
    { source: "/Users/owner/cache", target: "/cache", readonly: true },
    { source: "sccache", target: "/cache/sccache", scope: "project" },
  ];
  const { paths } = await runnerFixture(t, { runner: { volumes } });
  assert.deepEqual((await runnerConfig(paths.config)).volumes, [
    volumes[0],
    { ...volumes[1], readonly: false },
  ]);
  for (const [listed, why] of [
    [
      [{ source: "/srv/cache", target: "/cache", scope: "project" }],
      /volumes\.0\.source /u,
    ],
    [[{ source: "cargo", target: "/workspace" }], /volumes\.0\.target /u],
    [[{ source: "cargo", target: "/cache", mode: "ro" }], /volumes\.0 /u],
  ]) {
    const refused = await runnerFixture(t, { runner: { volumes: listed } });
    await assert.rejects(
      runnerConfig(refused.paths.config),
      why,
      JSON.stringify(listed),
    );
  }
});

test("a directory a volume names must lie under the home the VM shares, as named and through a link, and a named volume need not", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "chuggy-darwin-home-"));
  const elsewhere = await mkdtemp(join(tmpdir(), "chuggy-darwin-elsewhere-"));
  t.after(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });
  await mkdir(join(home, "cache"));
  await symlink(elsewhere, join(home, "linked"));
  /** @param {string} source */
  const listed = (source) => [
    { source: "cargo", target: "/cache/cargo", readonly: false },
    { source, target: "/cache/shared", readonly: false },
  ];
  assert.equal(
    await runnerVolumesRefusal(listed(join(home, "cache")), home),
    undefined,
  );
  for (const source of [elsewhere, join(home, "linked")])
    assert.equal(
      await runnerVolumesRefusal(listed(source), home),
      `volumes.1.source ${source} is not under ${home}, or leads outside it, and ${home} is the only directory Colima shares with its VM by default, so a job could not mount the Mac's`,
    );
});

test("a directory is not a runner configuration", async (t) => {
  const { paths } = await runnerFixture(t, { runner: undefined });
  await mkdir(paths.config, { recursive: true, mode: 0o700 });
  await assert.rejects(runnerConfig(paths.config), /is not a file/u);
});

test("a chat host's section is read as the core's schema reads it, absent where the file names none", async (t) => {
  const { paths } = await runnerFixture(t);
  assert.equal((await runnerConfig(paths.config)).chat, undefined);
  const set = await runnerFixture(t, {
    runner: {
      chat: {
        image: { image: "ghcr.io/shame/chat:1" },
        sessionsMax: 3,
        sessionMemoryMib: 1024,
        idleSecs: 120,
        outputBytesMax: 4096,
      },
    },
  });
  assert.deepEqual((await runnerConfig(set.paths.config)).chat, {
    image: { image: "ghcr.io/shame/chat:1", pull: "missing" },
    sessionsMax: 3,
    sessionMemoryMib: 1024,
    idleSecs: 120,
    outputBytesMax: 4096,
  });
});

test("what chat may not say is refused, naming where", async (t) => {
  const refused = [
    [{ sessions: 2 }, /chat/u],
    [{ sessionsMax: 0 }, /chat\.sessionsMax/u],
    [{ sessionMemoryMib: 1 }, /chat\.sessionMemoryMib/u],
    [{ idleSecs: 1.5 }, /chat\.idleSecs/u],
    [{ outputBytesMax: -1 }, /chat\.outputBytesMax/u],
    [{ image: "ghcr.io/shame/chat:1" }, /chat\.image/u],
    [{ image: { image: "x", pull: "sometimes" } }, /chat\.image\.pull/u],
    [{ image: { image: "x", tag: "1" } }, /chat\.image/u],
  ];
  for (const [chat, line] of refused) {
    const { paths } = await runnerFixture(t, { runner: { chat } });
    await assert.rejects(
      runnerConfig(paths.config),
      line,
      JSON.stringify(chat),
    );
  }
});

/**
 * Two Claude subscription tokens in turn with an API key behind them, and a
 * Codex login with an API key it never falls back to, as the README names
 * them.
 *
 * @param {string} home
 */
function credentialSets(home) {
  const at = (name) => join(home, ".config", "chuggy", name);
  return {
    files: {
      max1: at("claude-max-1"),
      max2: at("claude-max-2"),
      claudeKey: at("anthropic-api-key"),
      chatgpt: join(home, ".codex", "auth.json"),
      openaiKey: at("openai-api-key"),
    },
    runner: {
      claudeTokenFile: undefined,
      claudeCredential: {
        prefer: "PreferOAuth",
        oauth: {
          order: "RoundRobin",
          credentials: [
            { name: "max-1", tokenFile: at("claude-max-1") },
            { name: "max-2", tokenFile: at("claude-max-2") },
          ],
        },
        apiKey: {
          order: "InOrder",
          credentials: [
            { name: "console", apiKeyFile: at("anthropic-api-key") },
          ],
        },
      },
      codexCredential: {
        prefer: "OAuthOnly",
        oauth: {
          order: "InOrder",
          credentials: [
            { name: "chatgpt", authFile: join(home, ".codex", "auth.json") },
          ],
        },
        apiKey: {
          order: "InOrder",
          credentials: [{ name: "openai", apiKeyFile: at("openai-api-key") }],
        },
      },
    },
  };
}

/**
 * Catches a set read but handed as something else: its credentials out of
 * the core's order, a RoundRobin that does not turn, or a policy that does
 * not hold to the type it allows.
 */
test("a file names a credential set per agent, read as the core reads it and handed as one selector, taking each credential in its policy's turn", async (t) => {
  const { home } = await runnerFixture(t, { runner: undefined });
  const { files, runner } = credentialSets(home);
  const { paths } = await runnerFixture(t, { runner });
  const read = await runnerConfig(paths.config);
  assert.deepEqual(read.claudeCredential, runner.claudeCredential);
  assert.deepEqual(read.codexCredential, runner.codexCredential);
  const selector = runnerCredentialsHanded(read).credentials;
  assert.deepEqual(selector.described(), [
    described("max-1", "Claude", "OAuth", files.max1),
    described("max-2", "Claude", "OAuth", files.max2),
    described("console", "Claude", "ApiKey", files.claudeKey),
    described("chatgpt", "Codex", "OAuth", files.chatgpt),
    described("openai", "Codex", "ApiKey", files.openaiKey),
  ]);
  assert.deepEqual(
    [1, 2, 3].map(() => selector.chosen("Claude")?.name),
    ["max-1", "max-2", "max-1"],
  );
  assert.deepEqual(
    [1, 2].map(() => selector.chosen("Codex")?.name),
    ["chatgpt", "chatgpt"],
  );
});

/**
 * Catches a set's file held to less than a single credential's is: a
 * relative path, or one a bind mount cannot name.
 */
test("each file of a set is held to the rules a bind mount names a single credential's file by", async (t) => {
  const { home } = await runnerFixture(t, { runner: undefined });
  const { runner } = credentialSets(home);
  const pools = runner.claudeCredential;
  for (const [claudeCredential, why] of [
    [
      {
        ...pools,
        oauth: {
          ...pools.oauth,
          credentials: [
            pools.oauth.credentials[0],
            { name: "max-2", tokenFile: "claude-max-2" },
          ],
        },
      },
      /claudeCredential\.oauth\.credentials\.1\.tokenFile must be an absolute path/u,
    ],
    [
      {
        ...pools,
        apiKey: {
          order: "InOrder",
          credentials: [{ name: "console", apiKeyFile: "/k,readonly=false" }],
        },
      },
      /claudeCredential\.apiKey\.credentials\.0\.apiKeyFile cannot be named in a bind mount/u,
    ],
  ]) {
    const refused = await runnerFixture(t, {
      runner: { ...runner, claudeCredential },
    });
    await assert.rejects(runnerConfig(refused.paths.config), why);
  }
});

/**
 * Catches a set's file a job could not find through the VM's share of the
 * home, as named or through a link, handed rather than refused.
 */
test("a set's file outside the home is refused when the selector chooses it, as named and through a link", async (t) => {
  const { home } = await runnerFixture(t, { runner: undefined });
  const { runner } = credentialSets(home);
  const pools = runner.claudeCredential;
  const uid = /** @type {() => number} */ (process.getuid)();
  const elsewhere = await mkdtemp(join(tmpdir(), "chuggy-darwin-elsewhere-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const outside = await ownerOnly(join(elsewhere, "claude-max-2"), "token");
  const linked = join(home, ".config", "chuggy", "claude-max-2");
  await mkdir(join(linked, ".."), { recursive: true });
  await symlink(outside, linked);
  const { paths } = await runnerFixture(t, {
    runner: {
      ...runner,
      claudeCredential: {
        ...pools,
        oauth: {
          ...pools.oauth,
          credentials: [
            pools.oauth.credentials[0],
            { name: "max-2", tokenFile: outside },
            { name: "max-3", tokenFile: linked },
          ],
        },
      },
    },
  });
  const selector = runnerCredentialsHanded(
    await runnerConfig(paths.config),
  ).credentials;
  const [, second, third] = [1, 2, 3].map(() => selector.chosen("Claude"));
  assert.deepEqual([second?.file, third?.file], [outside, linked]);
  for (const credential of [second, third])
    assert.equal(
      await credentialFileRefusal(
        runnerCredentialDescribed(
          /** @type {NonNullable<typeof credential>} */ (credential),
        ),
        credential?.file ?? "",
        { uid, home },
      ),
      `the Claude token file ${credential?.file ?? ""} is not under ${home}, or leads outside it, and ${home} is the only directory Colima shares with its VM by default, so a job would find nothing at its mount`,
    );
});

/**
 * What a runner's file naming the sets `credentialSets` names may not say
 * beside them, and the refusal of each.
 *
 * @param {ReturnType<typeof credentialSets>["runner"]} runner
 * @param {string} home
 * @returns {Array<[Record<string, unknown>, RegExp]>}
 */
function setRefusals(runner, home) {
  const { oauth, apiKey } = runner.claudeCredential;
  return [
    [
      { claudeCredential: { prefer: "OAuthOnly", apiKey } },
      /claudeCredential\.prefer is OAuthOnly, and the set names no credential it allows/u,
    ],
    [
      { claudeCredential: { prefer: "ApiKeyFirst", oauth } },
      /claudeCredential\.prefer Invalid option/u,
    ],
    [
      {
        claudeCredential: {
          prefer: "PreferOAuth",
          oauth: { ...oauth, credentials: [] },
        },
      },
      /claudeCredential\.oauth\.credentials names no credential/u,
    ],
    [
      {
        claudeCredential: {
          prefer: "PreferOAuth",
          oauth: {
            order: "InOrder",
            credentials: [{ name: "max 1", tokenFile: "/t" }],
          },
        },
      },
      /claudeCredential\.oauth\.credentials\.0\.name is not a credential's name/u,
    ],
    [
      {
        claudeCredential: {
          prefer: "PreferOAuth",
          oauth: {
            order: "InOrder",
            credentials: [{ name: "max-1", authFile: "/t" }],
          },
        },
      },
      /claudeCredential\.oauth\.credentials\.0 Unrecognized key: "authFile"/u,
    ],
    [
      {
        codexCredential: {
          prefer: "OAuthOnly",
          oauth: {
            order: "InOrder",
            credentials: [{ name: "max-1", authFile: "/a" }],
          },
        },
      },
      /codexCredential names the credential max-1, and another credential of this runner's has that name; name each once/u,
    ],
    [
      { claudeTokenFile: join(home, ".claude-token") },
      /claudeCredential names a Claude credential, and so does claudeTokenFile; keep one/u,
    ],
  ];
}

/**
 * Catches a set no selector could choose from, a name two credentials share
 * so that one's bench benches the other, or `claudeTokenFile` beside a set,
 * read rather than refused.
 */
test("a set whose policy allows none it names, a name used twice across the agents, or claudeTokenFile beside a set, is refused, naming where", async (t) => {
  const { home } = await runnerFixture(t, { runner: undefined });
  const { runner } = credentialSets(home);
  for (const [refusing, why] of setRefusals(runner, home)) {
    const { paths } = await runnerFixture(t, {
      runner: { ...runner, ...refusing },
    });
    await assert.rejects(
      runnerConfig(paths.config),
      why,
      JSON.stringify(refusing),
    );
  }
  const legacy = await runnerFixture(t, {
    runner: { codexCredential: { authFile: "/Users/you/.codex/auth.json" } },
  });
  assert.equal(
    (await runnerConfig(legacy.paths.config)).claudeTokenFile,
    legacy.tokenFile,
  );
  const shared = await runnerFixture(t, {
    runner: {
      codexCredential: {
        prefer: "OAuthOnly",
        oauth: {
          order: "InOrder",
          credentials: [{ name: "claude", authFile: "/Users/you/a.json" }],
        },
      },
    },
  });
  await assert.rejects(
    runnerConfig(shared.paths.config),
    /codexCredential names the credential claude, and another credential/u,
  );
});

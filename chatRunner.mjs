/**
 * A member's chat host composed: its file and the runner's read, and the
 * worker core's chat host over one chat supervisor container, which the core
 * runs through docker in the Linux VM, its standard streams the host's
 * stream to it.
 *
 * THE CLAUDE CREDENTIALS ARE THE RUNNER'S FILE'S, each in a directory of its
 * own. The host holds one selector over the file's sets for its life, and
 * each session runs on the Claude credential it chooses. The core binds each
 * credential's directory, not its file, so a renewal that replaces the file
 * is seen, and the supervisor can read all that directory holds: a directory
 * holding anything else is refused.
 *
 * THE CREDENTIAL IS ROOT'S AS THE SUPERVISOR SEES IT. The VM's share of the
 * home presents a file as owned by the user who asks of it, whatever its
 * owner on the Mac, and lets any user read it. The supervisor asks as root,
 * so its credentials' directory is root's; no session's user can enter it.
 */

import { setTimeout as delay } from "node:timers/promises";

import {
  chatCredentialAloneRefusal,
  chatHost,
  chatHostConfigured,
  chatHostVolumes,
  chatSupervisorNaming,
  chatSupervisorStarted,
  checkedChatHostSettings,
} from "@chuggy/worker-core/chatHost.mjs";
import { chatSessionLogs } from "@chuggy/worker-core/chatHostLog.mjs";
import { agentCredentialSetCredentials } from "@chuggy/worker-core/agentCredentialSet.mjs";
import { poolCredentials } from "@chuggy/worker-core/poolCredentials.mjs";
import { poolIdentityChatHost } from "@chuggy/worker-core/poolIdentity.mjs";
import { poolRunnerTokens } from "@chuggy/worker-core/poolRunner.mjs";

import { powerAssertion } from "./power.mjs";
import {
  dockerEndpoint,
  poolRuntimeDirectory,
  poolSocket,
  runnerEngine,
} from "./runner.mjs";
import {
  credentialFileRefusal,
  runnerConfig,
  runnerCredentialDescribed,
  runnerCredentialSets,
  runnerCredentialsHanded,
} from "./runnerConfig.mjs";
import { runnerPaths } from "./runnerPaths.mjs";

/**
 * @typedef {import("@chuggy/worker-core/chatHost.mjs").ChatHostSettings} ChatHostSettings
 * @typedef {import("@chuggy/worker-core/chatHost.mjs").ChatSupervisorPlaces} ChatSupervisorPlaces
 * @typedef {import("@chuggy/worker-core/engine.mjs").Engine} Engine
 * @typedef {import("@chuggy/worker-core/poolCredentials.mjs").PoolCredentials} PoolCredentials
 * @typedef {import("@chuggy/worker-core/poolIdentity.mjs").ChatHostIdentity} ChatHostIdentity
 * @typedef {import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolClient} WorkerPoolClient
 * @typedef {import("./runnerConfig.mjs").RunnerConfig} RunnerConfig
 * @typedef {import("./runnerPaths.mjs").RunnerPaths} RunnerPaths
 *
 * @typedef {object} ChatSetup
 * @property {string} poolFile
 * @property {ChatHostIdentity & PoolCredentials} credentials a chat host's
 * @property {RunnerConfig} config
 * @property {RunnerPaths} paths
 */

/** Who the credential's file is as the supervisor sees it, as the VM presents it to root. */
export const chatCredentialOwner = Object.freeze({ uid: 0, gid: 0 });

/**
 * Why `poolFile` is not a chat host's, or nothing.
 *
 * @param {PoolCredentials} credentials
 * @param {string} poolFile
 */
export function chatFileRefusal(credentials, poolFile) {
  return poolIdentityChatHost(credentials)
    ? undefined
    : `${poolFile} is a pool's or a personal runner's, not a chat host's`;
}

/**
 * The chat host's file and the runner's, read, refused where the file is not
 * a chat host's.
 *
 * @param {string} poolFile
 * @param {string} home
 * @returns {Promise<ChatSetup>}
 */
export async function chatSetup(poolFile, home) {
  const paths = runnerPaths(home);
  const credentials = await poolCredentials(poolFile);
  const refusal = chatFileRefusal(credentials, poolFile);
  if (refusal !== undefined) throw new Error(refusal);
  return {
    poolFile,
    credentials: /** @type {ChatHostIdentity & PoolCredentials} */ (
      credentials
    ),
    config: await runnerConfig(paths.config),
    paths,
  };
}

/**
 * Why the Claude credentials' files cannot be handed to the supervisor, or
 * nothing: the first of the file's Claude set held to the rule a job's
 * credential is, and to the core's, the file itself alone in its directory.
 * The supervisor is given the directory of every one whole, whichever a
 * session runs on.
 *
 * @param {RunnerConfig} config
 * @param {{uid: number, home: string}} runner
 */
export async function chatCredentialRefusal(config, runner) {
  const set = runnerCredentialSets(config).Claude;
  for (const credential of set === undefined
    ? []
    : agentCredentialSetCredentials(set)) {
    const refusal =
      (await credentialFileRefusal(
        runnerCredentialDescribed(credential),
        credential.file,
        runner,
      )) ?? (await chatCredentialAloneRefusal(credential.file));
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

/**
 * What the supervisor's container is given of this Mac: the chat host's
 * volumes, a selector over the file's credentials, and the Claude ones'
 * owner as root sees them. No repositories map is named, so a session clones
 * from its repository's own address.
 *
 * @param {PoolCredentials} credentials
 * @param {RunnerConfig} config
 * @returns {ChatSupervisorPlaces}
 */
export function chatSupervisorPlaces(credentials, config) {
  if (!poolIdentityChatHost(credentials))
    throw new RangeError("a chat host's places are a chat host's alone");
  return {
    volumes: chatHostVolumes(credentials),
    credentialOwner: chatCredentialOwner,
    credentials: runnerCredentialsHanded(config).credentials,
  };
}

/**
 * The chat host's settings from the runner's file, its places this Mac's,
 * refused where docker could not run a supervisor from them.
 *
 * @param {PoolCredentials} credentials
 * @param {RunnerConfig} config
 * @returns {ChatHostSettings}
 */
export function chatHostSettings(credentials, config) {
  return checkedChatHostSettings(
    {
      ...chatHostConfigured(config.chat, config.outputBytesMax),
      places: chatSupervisorPlaces(credentials, config),
    },
    "docker",
  );
}

/**
 * The chat host composed from what was read: the core's loop over the
 * supervisor, run through docker on the runner's network, each session's
 * log in the runner's logs, and the power assertion the run holds while it
 * serves.
 *
 * @param {ChatSetup} setup
 * @param {{log: (line: string) => void, runner?: import("@chuggy/worker-core/runnerUpdate.mjs").RunnerIdentity, updates?: import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolUpdates, engine?: Engine, tokens?: WorkerPoolClient["tokens"], fetch?: typeof globalThis.fetch, spawn?: typeof import("node:child_process").spawn, power?: import("./power.mjs").PowerAssertion, nowMs?: () => number, sleep?: (ms: number) => Promise<void>}} host
 */
export async function chatHostParts(setup, host) {
  const { credentials, config, paths } = setup;
  const runtime = poolRuntimeDirectory(paths, credentials);
  const socket = poolSocket(runtime);
  const engine = host.engine ?? runnerEngine();
  const dockerHost = await dockerEndpoint(engine);
  const nowMs = host.nowMs ?? Date.now;
  const served = chatHost(credentials, chatHostSettings(credentials, config), {
    engine,
    site: { engine: "docker", runtimeDir: runtime, dockerHost },
    started: chatSupervisorStarted({
      engine,
      naming: chatSupervisorNaming(credentials, config.network),
      ...(host.spawn === undefined ? {} : { spawn: host.spawn }),
    }),
    log: host.log,
    logFor: chatSessionLogs(paths.logs, credentials, { log: host.log, nowMs }),
    sleep: host.sleep ?? ((ms) => delay(ms)),
    nowMs,
    tokens: host.tokens ?? poolRunnerTokens(credentials),
    ...(host.fetch === undefined ? {} : { fetch: host.fetch }),
    ...(host.runner === undefined ? {} : { runner: host.runner }),
    ...(host.updates === undefined ? {} : { updates: host.updates }),
  });
  return {
    runtime,
    socket,
    engine,
    host: served,
    power: host.power ?? powerAssertion({ log: host.log }),
  };
}

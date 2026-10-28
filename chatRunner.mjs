/**
 * A member's chat host composed: its file and the runner's read, and the
 * worker core's chat host over one chat supervisor container, run through
 * docker in the Linux VM as `docker run -i --rm`, its standard streams the
 * host's stream to it.
 *
 * THE CLAUDE CREDENTIAL IS THE RUNNER'S FILE'S, in a directory of its own.
 * The core binds the credential's directory, not its file, so a renewal that
 * replaces the file is seen, and the supervisor can read all that directory
 * holds: a directory holding anything else is refused.
 *
 * THE CREDENTIAL IS ROOT'S AS THE SUPERVISOR SEES IT. The VM's share of the
 * home presents a file as owned by the user who asks of it, whatever its
 * owner on the Mac, and lets any user read it. The supervisor asks as root,
 * so its credentials' directory is root's; no session's user can enter it.
 */

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chatHost, chatHostVolumes } from "@chuggy/worker-core/chatHost.mjs";
import { claudeCredentialDescribed } from "@chuggy/worker-core/claudeCredential.mjs";
import {
  bindMountNameable,
  poolLabel,
} from "@chuggy/worker-core/engineArgv.mjs";
import { poolCredentials } from "@chuggy/worker-core/poolCredentials.mjs";
import {
  poolIdentityChatHost,
  poolIdentityDigest,
  poolLabelValue,
} from "@chuggy/worker-core/poolIdentity.mjs";
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
  runnerChatSettings,
  runnerConfig,
  runnerCredentialsHanded,
} from "./runnerConfig.mjs";
import { runnerPaths } from "./runnerPaths.mjs";

/**
 * @typedef {import("@chuggy/worker-core/chatHost.mjs").ChatSupervisorContainer} ChatSupervisorContainer
 * @typedef {import("@chuggy/worker-core/chatHost.mjs").ChatSupervisorPlaces} ChatSupervisorPlaces
 * @typedef {import("@chuggy/worker-core/chatHostBackend.mjs").ChatSupervisorHandle} ChatSupervisorHandle
 * @typedef {import("@chuggy/worker-core/engine.mjs").Engine} Engine
 * @typedef {import("@chuggy/worker-core/poolCredentials.mjs").PoolCredentials} PoolCredentials
 * @typedef {import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolClient} WorkerPoolClient
 * @typedef {import("./runnerConfig.mjs").RunnerConfig} RunnerConfig
 * @typedef {import("./runnerPaths.mjs").RunnerPaths} RunnerPaths
 *
 * @typedef {object} ChatSetup
 * @property {string} poolFile
 * @property {PoolCredentials} credentials a chat host's
 * @property {RunnerConfig} config
 * @property {RunnerPaths} paths
 *
 * @typedef {object} ChatSupervisorRun where the supervisor's container is run, beside what its spec says
 * @property {string} name
 * @property {string} pool the pool label's value it carries
 * @property {string} network
 */

/**
 * The slot the session plane names the Claude credential by, which a
 * session asks the supervisor's map for.
 */
export const chatCredentialSlot = "claude-code";

/** Who the credential's file is as the supervisor sees it, as the VM presents it to root. */
export const chatCredentialOwner = Object.freeze({ uid: 0, gid: 0 });

/** The most sessions whose log's size is kept count of; one past it is counted afresh from its file. */
const chatLogsCountedMax = 64;

/** The most a session's log grows to, past which its lines are dropped. */
const chatLogBytesMax = 10 * 1024 * 1024;

/**
 * Why `poolFile` is not a chat host's, or nothing.
 *
 * @param {PoolCredentials} credentials
 * @param {string} poolFile
 */
export function chatFileRefusal(credentials, poolFile) {
  return poolIdentityChatHost(credentials)
    ? undefined
    : `${poolFile} is a pool's or a personal runner's, not a chat host's; run it with chuggy-darwin run`;
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
    credentials,
    config: await runnerConfig(paths.config),
    paths,
  };
}

/** How the image's setting has it pulled, as a person says it. */
const chatPulls = {
  always: "always",
  missing: "where it is missing",
  never: "never",
};

/**
 * What the runner's file sets a chat host, as `chat status` and `chat doctor`
 * say it.
 *
 * @param {RunnerConfig} config
 */
export function chatSettingsLine(config) {
  const { image, ...bounds } = runnerChatSettings(config);
  const named =
    image === undefined
      ? "the one chuggy names"
      : `${image.image}, pulled ${chatPulls[image.pull]}`;
  return `sessionsMax ${String(bounds.sessionsMax)}, idleSecs ${String(bounds.idleSecs)}, outputBytesMax ${String(bounds.outputBytesMax)}, image ${named}`;
}

/**
 * The supervisor's container's name, one per chat host.
 *
 * @param {PoolCredentials} credentials
 */
export function chatSupervisorName(credentials) {
  return `chuggy-chat-${poolIdentityDigest(credentials)}`;
}

/**
 * Why the Claude credential's file cannot be handed to the supervisor, or
 * nothing: held to the rule a job's credential is, the file itself and not a
 * link, and alone in its directory, which the supervisor is given whole. Only
 * names are read.
 *
 * @param {RunnerConfig} config
 * @param {{uid: number, home: string}} runner
 */
export async function chatCredentialRefusal(config, runner) {
  const handed = runnerCredentialsHanded(config);
  const described = claudeCredentialDescribed(handed.claudeCredential);
  const refusal = await credentialFileRefusal(
    described,
    handed.tokenFile,
    runner,
  );
  if (refusal !== undefined) return refusal;
  if ((await lstat(handed.tokenFile)).isSymbolicLink())
    return `the ${described.label} ${handed.tokenFile} is a link, and a chat host's supervisor is handed its directory, where a link out of it leads nowhere; name the file itself`;
  const directory = dirname(handed.tokenFile);
  const others = (await readdir(directory)).filter(
    (name) => name !== basename(handed.tokenFile),
  );
  if (others.length === 0) return undefined;
  return `the ${described.label} ${handed.tokenFile} shares ${directory} with ${others.slice(0, 3).join(", ")}${others.length > 3 ? " and more" : ""}, and a chat host's supervisor is handed all of its directory; keep it in a directory of its own`;
}

/**
 * What the supervisor's container is given of this Mac: the chat host's
 * volumes, the Claude credential's file under the slot the plane names, its
 * owner as root sees it, and its kind. No repositories map is named, so a
 * session clones from its repository's own address.
 *
 * @param {PoolCredentials} credentials
 * @param {RunnerConfig} config
 * @returns {ChatSupervisorPlaces}
 */
export function chatSupervisorPlaces(credentials, config) {
  const handed = runnerCredentialsHanded(config);
  if (!poolIdentityChatHost(credentials))
    throw new RangeError("a chat host's places are a chat host's alone");
  return {
    volumes: chatHostVolumes(credentials),
    credentialFiles: { [chatCredentialSlot]: handed.tokenFile },
    credentialOwner: chatCredentialOwner,
    claudeCredential: handed.claudeCredential,
  };
}

/**
 * A tmpfs's options, owner and mode included, as docker's `--tmpfs` takes them.
 *
 * @param {ChatSupervisorContainer["tmpfs"][number]} tmpfs
 */
function chatTmpfsOption(tmpfs) {
  return [
    `${tmpfs.target}:rw`,
    ...tmpfs.flags,
    `size=${String(tmpfs.sizeBytes)}`,
    `mode=${tmpfs.mode.toString(8).padStart(4, "0")}`,
    `uid=${String(tmpfs.uid)}`,
    `gid=${String(tmpfs.gid)}`,
  ].join(",");
}

/**
 * The supervisor's container as `docker run` runs it, its input held open
 * and removed once it exits: every field of the spec, a name, the chat
 * host's pool label, and the network. Its image is pulled before, so the run
 * pulls nothing. Its streams reach only this process, which logs them, so
 * the engine keeps no log of its own, which in a container that runs for as
 * long as the host would grow without bound in the VM.
 *
 * @param {ChatSupervisorContainer} container
 * @param {ChatSupervisorRun} run
 */
export function chatSupervisorRunArgv(container, run) {
  for (const { source } of container.binds)
    if (!bindMountNameable(source))
      throw new RangeError(`${source} cannot be named in a bind mount`);
  const [entrypoint, ...command] = container.command;
  return [
    "run",
    ...(container.interactive ? ["-i"] : []),
    "--rm",
    "--pull=never",
    "--name",
    run.name,
    "--label",
    `${poolLabel}=${run.pool}`,
    "--log-driver",
    "none",
    "--user",
    container.user,
    ...container.capabilities.drop.flatMap((cap) => ["--cap-drop", cap]),
    ...container.capabilities.add.flatMap((cap) => ["--cap-add", cap]),
    ...container.securityOptions.flatMap((option) => [
      "--security-opt",
      option,
    ]),
    ...container.volumes.flatMap(({ volume, target }) => [
      "--mount",
      `type=volume,source=${volume},target=${target}`,
    ]),
    ...container.tmpfs.flatMap((tmpfs) => ["--tmpfs", chatTmpfsOption(tmpfs)]),
    ...container.binds.flatMap(({ source, target }) => [
      "--mount",
      `type=bind,source=${source},target=${target},readonly`,
    ]),
    ...Object.entries(container.environment).flatMap(([name, value]) => [
      "--env",
      `${name}=${value}`,
    ]),
    "--network",
    run.network,
    "--entrypoint",
    entrypoint,
    container.image,
    ...command,
  ];
}

/**
 * The supervisor started: any container of its name left by a run before
 * removed, then `docker run` spawned on `argv`. `exited` settles once the
 * CLI's process has ended, before its output is read to its end, which the
 * backend reads on. `kill` kills the container, which killing the CLI alone
 * would leave running, and the CLI.
 *
 * @param {readonly string[]} argv as `chatSupervisorRunArgv` makes it
 * @param {string} name the container's
 * @param {{engine: Engine, spawn?: typeof spawn}} seams
 * @returns {Promise<ChatSupervisorHandle>}
 */
export async function chatSupervisorStarted(argv, name, seams) {
  await seams.engine.exec(["rm", "--force", name]);
  const child = (seams.spawn ?? spawn)("docker", [...argv], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise((settled) => {
    child.once("exit", settled);
    child.once("error", settled);
  });
  return {
    input: child.stdin,
    output: child.stdout,
    errors: child.stderr,
    exited,
    kill: () => {
      void seams.engine.exec(["kill", name]);
      child.kill("SIGKILL");
    },
  };
}

/**
 * Each session's log, a line at a time, appended to a file of its own in the
 * runner's logs, named for a digest of the host and the session: owner-only,
 * and never past `chatLogBytesMax`. A line that would take it past drops that
 * line and every one after, until its size is counted afresh from the file.
 *
 * @param {string} directory
 * @param {PoolCredentials} credentials
 * @returns {(assignment: string) => (line: string) => void}
 */
export function chatLogs(directory, credentials) {
  /** @type {Map<string, number>} */
  const counted = new Map();
  return (assignment) => {
    const file = join(
      directory,
      `chat-${poolIdentityDigest(credentials, assignment)}.log`,
    );
    return (line) => {
      let bytes = counted.get(file);
      if (bytes === undefined) {
        try {
          bytes = statSync(file).size;
        } catch {
          const opened = `session ${assignment}\n`;
          appendFileSync(file, opened, { mode: 0o600 });
          bytes = Buffer.byteLength(opened);
        }
      }
      counted.delete(file);
      const text = `${line}\n`;
      if (bytes + Buffer.byteLength(text) <= chatLogBytesMax) {
        appendFileSync(file, text, { mode: 0o600 });
        bytes += Buffer.byteLength(text);
      } else bytes = chatLogBytesMax;
      counted.set(file, bytes);
      if (counted.size > chatLogsCountedMax)
        counted.delete(counted.keys().next().value ?? file);
    };
  };
}

/**
 * The chat host composed from what was read: the core's loop over the
 * supervisor, run through docker on the runner's network, and the power
 * assertion the run holds while it serves.
 *
 * @param {ChatSetup} setup
 * @param {{log: (line: string) => void, runner?: import("@chuggy/worker-core/runnerUpdate.mjs").RunnerIdentity, updates?: import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolUpdates, engine?: Engine, tokens?: WorkerPoolClient["tokens"], fetch?: typeof globalThis.fetch, spawn?: typeof spawn, power?: import("./power.mjs").PowerAssertion, nowMs?: () => number, sleep?: (ms: number) => Promise<void>}} host
 */
export async function chatHostParts(setup, host) {
  const { credentials, config, paths } = setup;
  const runtime = poolRuntimeDirectory(paths, credentials);
  const socket = poolSocket(runtime);
  const engine = host.engine ?? runnerEngine();
  const dockerHost = await dockerEndpoint(engine);
  const name = chatSupervisorName(credentials);
  const run = {
    name,
    pool: poolLabelValue(credentials),
    network: config.network,
  };
  const served = chatHost(
    credentials,
    {
      ...runnerChatSettings(config),
      places: chatSupervisorPlaces(credentials, config),
    },
    {
      engine,
      site: { engine: "docker", runtimeDir: runtime, dockerHost },
      started: (container) =>
        chatSupervisorStarted(chatSupervisorRunArgv(container, run), name, {
          engine,
          ...(host.spawn === undefined ? {} : { spawn: host.spawn }),
        }),
      log: host.log,
      logFor: chatLogs(paths.logs, credentials),
      sleep: host.sleep ?? ((ms) => delay(ms)),
      nowMs: host.nowMs ?? Date.now,
      tokens: host.tokens ?? poolRunnerTokens(credentials),
      ...(host.fetch === undefined ? {} : { fetch: host.fetch }),
      ...(host.runner === undefined ? {} : { runner: host.runner }),
      ...(host.updates === undefined ? {} : { updates: host.updates }),
    },
  );
  return {
    runtime,
    socket,
    engine,
    name,
    host: served,
    power: host.power ?? powerAssertion({ log: host.log }),
  };
}

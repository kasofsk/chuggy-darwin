/**
 * What `chat doctor` checks of a member's chat host, in the order a run
 * depends on them, each answered as passed or not with what was found.
 *
 * IT PULLS THE SESSION IMAGE where it is not here, as a run would, since
 * whether it can be pulled is what is checked, and then runs it once, as the
 * supervisor runs, to ask the owner the VM presents the credential as. That
 * container mounts no volume of the host's and reaches no network. Its one
 * poll is made only where no service of the host answers: a held-nothing
 * poll is what a host makes before its supervisor is ready, and a service
 * serving sessions has already heard the image chuggy names.
 */

import { chatSupervisorContainer } from "@chuggy/worker-core/chatHost.mjs";
import {
  chatSessionUidCount,
  chatSessionUidFirst,
} from "@chuggy/worker-core/chatSession.mjs";
import { controlAsked } from "@chuggy/worker-core/control.mjs";
import { imageInspectArgv } from "@chuggy/worker-core/engineArgv.mjs";
import { engineFailureLine } from "@chuggy/worker-core/engineErrors.mjs";
import { poolCredentials } from "@chuggy/worker-core/poolCredentials.mjs";
import { poolLabelValue } from "@chuggy/worker-core/poolIdentity.mjs";
import {
  imageRegistryHost,
  registryPull,
} from "@chuggy/worker-core/registryAuth.mjs";
import { workerCredentialFilesVariable } from "@chuggy/worker-contract/workerEnvironment";

import {
  chatCredentialOwner,
  chatCredentialRefusal,
  chatFileRefusal,
  chatSettingsLine,
  chatSupervisorName,
  chatSupervisorPlaces,
  chatSupervisorRunArgv,
} from "./chatRunner.mjs";
import {
  agentFinding,
  checked,
  claudeCredentialFinding,
  dockerChecked,
  networkChecked,
  poolTokenChecked,
  updatesFinding,
} from "./doctor.mjs";
import { dockerEndpoint, poolRuntimeDirectory, poolSocket } from "./runner.mjs";
import { runnerChatSettings, runnerConfig } from "./runnerConfig.mjs";

/**
 * @typedef {import("@chuggy/worker-core/poolCredentials.mjs").PoolCredentials} PoolCredentials
 * @typedef {import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolClient} WorkerPoolClient
 * @typedef {import("@chuggy/worker-core/engine.mjs").Engine} Engine
 * @typedef {import("./doctor.mjs").DoctorFinding} DoctorFinding
 * @typedef {import("./runnerConfig.mjs").RunnerConfig} RunnerConfig
 * @typedef {import("./runnerPaths.mjs").RunnerPaths} RunnerPaths
 *
 * @typedef {object} ChatDoctorParts what a run would reach, built from what was read
 * @property {() => Engine} engine
 * @property {(credentials: PoolCredentials) => WorkerPoolClient["tokens"]} tokens
 * @property {(credentials: PoolCredentials, idleSecs: number) => WorkerPoolClient["plane"]} plane
 * @property {(config: RunnerConfig) => import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolUpdates} updates
 *
 * @typedef {object} ChatDoctorInput
 * @property {string} poolFile
 * @property {RunnerPaths} paths
 * @property {number} uid this process's
 * @property {string} home the home docker's VM shares
 * @property {ChatDoctorParts} parts
 *
 * @typedef {object} ChatDoctorRead what the checks before the engine's found
 * @property {PoolCredentials} credentials
 * @property {RunnerConfig} config
 * @property {Engine} engine
 * @property {string} runtime the host's runtime directory
 * @property {string | undefined} token the pool's, where one was issued
 */

/** Run in the session image as the supervisor is, it prints each credential's owner as the supervisor would see it. */
const chatOwnerProbe = `for (const [slot, file] of Object.entries(JSON.parse(process.env.${workerCredentialFilesVariable}))) { const { uid, gid } = require("node:fs").statSync(file); console.log([slot, uid, gid].join(" ")); }`;

/** The node every session image runs the supervisor under. */
const chatProbeNode = "/opt/chuggy/bin/node";

/**
 * The image a run would start the supervisor in: the host's own, or the one
 * chuggy names, as the running service last heard it or as one poll answers.
 *
 * @param {ChatDoctorInput} input
 * @param {ChatDoctorRead} read
 * @returns {Promise<[string, string]>}
 */
async function chatImageNamed(input, read) {
  const { credentials, config, runtime, token } = read;
  const settings = runnerChatSettings(config);
  if (settings.image !== undefined)
    return [settings.image.image, `${settings.image.image}, chat.image's`];
  const served = /** @type {{inFlight?: {named?: string}[]} | undefined} */ (
    await controlAsked(poolSocket(runtime), { op: "status" })
  );
  if (served !== undefined) {
    const named = served.inFlight?.[0]?.named;
    if (named === undefined)
      throw new Error("the running service has heard no image from chuggy yet");
    return [named, `${named}, as chuggy named it to the running service`];
  }
  if (token === undefined) throw new Error("no pool token to poll with");
  const polled = await input.parts
    .plane(credentials, settings.idleSecs)
    .poll(token, [], 0, 0, { waitSecs: 0 });
  if (polled.polled === "Stale")
    throw new Error("the plane rejected a token the issuer had just issued");
  if (polled.polled !== "Reconciled") throw new Error(polled.evidence);
  if (polled.chatImage === undefined)
    throw new Error(
      `${credentials.planeUrl} names no session image, and chat.image names none`,
    );
  return [
    polled.chatImage,
    `${polled.chatImage}, as ${credentials.planeUrl} names it`,
  ];
}

/**
 * The session image here, pulled as a run pulls it where it is not: the
 * plane's under the pool's token where it is in the pool's registry, and
 * otherwise as docker's own login pulls it; the host's own never, where its
 * setting says so.
 *
 * @param {ChatDoctorRead} read
 * @param {string} image
 * @returns {Promise<[true, string]>}
 */
async function chatImagePulled(read, image) {
  const { credentials, config, engine, runtime, token } = read;
  if ((await engine.exec(imageInspectArgv(image))).code === 0)
    return [true, `${image} is here`];
  const own = runnerChatSettings(config).image;
  if (own?.pull === "never")
    throw new Error(`${image} is not here, and chat.image pulls it never`);
  const host = imageRegistryHost(image);
  const pooled = own === undefined && host === credentials.registryHost;
  if (pooled && token === undefined)
    throw new Error(`the pool has no token to pull ${image} with`);
  const pulled = await registryPull(
    {
      engine: "docker",
      runtimeDir: runtime,
      dockerHost: await dockerEndpoint(engine),
    },
    image,
    undefined,
    pooled ? { host, token: /** @type {string} */ (token) } : undefined,
    (argv, environment) => engine.exec(argv, { environment }),
  );
  if (pulled.code !== 0)
    throw new Error(
      `${image} could not be pulled: ${engineFailureLine(pulled)}`,
    );
  return [
    true,
    `${image} was pulled${pooled ? " under the pool's token" : ""}`,
  ];
}

/**
 * The probe's container: the supervisor's, but for its volumes, its network
 * and its command, so it holds the credential as the supervisor does.
 *
 * @param {ChatDoctorRead} read
 * @param {string} image
 */
export function chatOwnerProbeArgv(read, image) {
  const { credentials, config } = read;
  const container = chatSupervisorContainer(
    image,
    chatSupervisorPlaces(credentials, config),
  );
  return chatSupervisorRunArgv(
    {
      ...container,
      interactive: false,
      volumes: [],
      command: [chatProbeNode, "-e", chatOwnerProbe],
    },
    {
      name: `${chatSupervisorName(credentials)}-doctor`,
      pool: poolLabelValue(credentials),
      network: "none",
    },
  );
}

/**
 * Each credential's owner as the VM presents it to the supervisor, passed
 * only where it is `chatCredentialOwner`, root: the supervisor reads a
 * credential as its owner, and only its owner enters the credentials'
 * directory, so an owner a session runs as would hand that session the file.
 *
 * @param {ChatDoctorRead} read
 * @param {string} image
 * @returns {Promise<[true, string]>}
 */
async function chatOwnerProbed(read, image) {
  const { credentials, engine } = read;
  const argv = chatOwnerProbeArgv(read, image);
  await engine.exec([
    "rm",
    "--force",
    `${chatSupervisorName(credentials)}-doctor`,
  ]);
  const probed = await engine.exec(argv);
  if (probed.code !== 0)
    throw new Error(
      `${image} could not read the credential as the supervisor would: ${engineFailureLine(probed)}`,
    );
  const lines = probed.stdout.split("\n").filter((line) => line !== "");
  if (lines.length === 0)
    throw new Error(`${image} said nothing of the credential's owner`);
  const last = chatSessionUidFirst + chatSessionUidCount - 1;
  for (const line of lines) {
    const [slot, uid, gid] = line.split(" ");
    if (
      Number(uid) !== chatCredentialOwner.uid ||
      Number(gid) !== chatCredentialOwner.gid
    )
      throw new Error(
        `the VM presents the ${slot} credential to the supervisor as uid ${uid}, gid ${gid}, not as root's${Number(uid) >= chatSessionUidFirst && Number(uid) <= last ? ", and as a user a session runs as" : ""}; another process in the VM may have read it within the second`,
      );
  }
  return [
    true,
    `the VM presents it to the supervisor as root's, uid ${String(chatCredentialOwner.uid)}, outside the users ${String(chatSessionUidFirst)} to ${String(last)} a session runs as`,
  ];
}

/**
 * The checks that need no engine: the host's file, the runner's, its
 * credential and its layout.
 *
 * @param {ChatDoctorInput} input
 * @param {DoctorFinding[]} findings
 */
async function chatFilesChecked(input, findings) {
  const credentials = await checked(findings, "chat host file", async () => {
    const read = await poolCredentials(input.poolFile);
    const refusal = chatFileRefusal(read, input.poolFile);
    if (refusal !== undefined) throw new Error(refusal);
    return [read, `${input.poolFile} names chat host ${poolLabelValue(read)}`];
  });
  const config = await checked(findings, "runner configuration", async () => {
    const read = await runnerConfig(input.paths.config);
    return [read, `${input.paths.config}: ${chatSettingsLine(read)}`];
  });
  if (config !== undefined) {
    findings.push(await claudeCredentialFinding(input, config, false));
    await checked(findings, "credential layout", async () => {
      const refusal = await chatCredentialRefusal(config, input);
      if (refusal !== undefined) throw new Error(refusal);
      return [
        true,
        "the credential is alone in its directory, which the supervisor is handed",
      ];
    });
  }
  if (credentials !== undefined)
    await checked(findings, "control socket", async () => [
      true,
      poolSocket(poolRuntimeDirectory(input.paths, credentials)),
    ]);
  return { credentials, config };
}

/**
 * The engine, the network, and the session image named, pulled and run.
 *
 * @param {ChatDoctorInput} input
 * @param {PoolCredentials} credentials
 * @param {RunnerConfig} config
 * @param {DoctorFinding[]} findings
 */
async function chatEngineChecked(input, credentials, config, findings) {
  const engine = input.parts.engine();
  const machine = await dockerChecked(
    engine,
    credentials,
    findings,
    "this host's",
  );
  if (machine === undefined) return;
  await networkChecked(engine, config.network, findings, "network");
  const token = await poolTokenChecked(
    input.parts.tokens(credentials),
    credentials,
    findings,
  );
  /** @type {ChatDoctorRead} */
  const read = {
    credentials,
    config,
    engine,
    runtime: poolRuntimeDirectory(input.paths, credentials),
    token,
  };
  const image = await checked(findings, "session image", () =>
    chatImageNamed(input, read),
  );
  if (image === undefined) return;
  const here = await checked(findings, "image pulled", () =>
    chatImagePulled(read, image),
  );
  if (here === undefined) return;
  await checked(findings, "credential owner", () =>
    chatOwnerProbed(read, image),
  );
}

/**
 * @param {ChatDoctorInput} input
 * @returns {Promise<DoctorFinding[]>}
 */
export async function chatDoctorFindings(input) {
  /** @type {DoctorFinding[]} */
  const findings = [];
  const { credentials, config } = await chatFilesChecked(input, findings);
  findings.push(await agentFinding(input, "Chat"));
  if (config !== undefined)
    findings.push(await updatesFinding(input.parts.updates(config)));
  if (credentials !== undefined && config !== undefined)
    await chatEngineChecked(input, credentials, config, findings);
  return findings;
}

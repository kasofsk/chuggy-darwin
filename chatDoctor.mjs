/**
 * What `doctor` checks of a member's chat host, in the order a run
 * depends on them, each answered as passed or not with what was found.
 *
 * IT PULLS THE SESSION IMAGE where it is not here, as a run would, since
 * whether it can be pulled is what is checked, and then runs it once, as the
 * supervisor runs but holding no capability, to read the credential as the
 * supervisor reads it. That container mounts no volume of the host's and
 * reaches no network. Its one poll is made only where no service of the host
 * answers: a held-nothing poll is what a host makes before its supervisor is
 * ready, and a service serving sessions has already heard the image chuggy
 * names.
 *
 * A SERVICE THAT ANSWERS IS THERE, whether or not this copy can read what it
 * says, as an older copy of the runner mid-update may answer: its
 * supervisor's container is its own, and nothing here says to remove it.
 */

import {
  chatHostConfigured,
  chatHostMemoryBytes,
  chatHostStatusAsked,
  chatSupervisorContainer,
  chatSupervisorName,
} from "@chuggy/worker-core/chatHost.mjs";
import { chatSupervisorVariables } from "@chuggy/worker-core/chatSupervisor.mjs";
import {
  chatSupervisorRunArgv,
  imageInspectArgv,
  inspectArgv,
  removeArgv,
} from "@chuggy/worker-core/engineArgv.mjs";
import {
  engineFailure,
  engineFailureLine,
} from "@chuggy/worker-core/engineErrors.mjs";
import { poolCredentials } from "@chuggy/worker-core/poolCredentials.mjs";
import { poolLabelValue } from "@chuggy/worker-core/poolIdentity.mjs";
import {
  imageRegistryHost,
  registryPull,
} from "@chuggy/worker-core/registryAuth.mjs";

import {
  chatCredentialRefusal,
  chatFileRefusal,
  chatHostSettings,
  chatSettingsLine,
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
import { runnerConfig } from "./runnerConfig.mjs";

/**
 * @typedef {import("@chuggy/worker-core/chatHost.mjs").ChatHostSettings} ChatHostSettings
 * @typedef {import("@chuggy/worker-core/chatHost.mjs").ChatHostStatus} ChatHostStatus
 * @typedef {import("@chuggy/worker-core/poolCredentials.mjs").PoolCredentials} PoolCredentials
 * @typedef {import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolClient} WorkerPoolClient
 * @typedef {import("@chuggy/worker-core/engine.mjs").Engine} Engine
 * @typedef {import("@chuggy/worker-core/engine.mjs").EngineAnswer} EngineAnswer
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
 * @property {ChatHostSettings} settings
 * @property {Engine} engine
 * @property {string} runtime the host's runtime directory
 * @property {ChatDoctorService} service what the host's running service says of it
 * @property {string | undefined} token the pool's, where one was issued
 *
 * @typedef {{none: true} | {status: ChatHostStatus} | {unreadable: string}} ChatDoctorService no service answers at the host's door, or one answers what this copy reads, or one answers what it cannot
 */

/** Run in the session image as the supervisor is, it reads the credential, and prints the owner the share presents it as. */
const chatOwnerProbe = `const fs = require("node:fs"); const file = process.env.${chatSupervisorVariables.credential}; fs.readFileSync(file); const { uid, gid } = fs.statSync(file); console.log(uid + " " + gid);`;

/** The node every session image runs the supervisor under. */
const chatProbeNode = "/opt/chuggy/bin/node";

/** The states a container docker removes without force is in. */
const chatRemovableStates = ["created", "exited", "dead"];

/**
 * The image a run would start the supervisor in: the host's own, or the one
 * chuggy names, as the running service last heard it or as one poll answers.
 *
 * @param {ChatDoctorInput} input
 * @param {ChatDoctorRead} read
 * @returns {Promise<[string, string]>}
 */
async function chatImageNamed(input, read) {
  const { credentials, settings, service, token } = read;
  if (settings.image !== undefined)
    return [settings.image.image, `${settings.image.image}, chat.image's`];
  if ("unreadable" in service)
    throw new Error(
      `a service of this host answers, but not as this copy reads it, so no poll is made beside it: ${service.unreadable}`,
    );
  if ("status" in service) {
    const served = service.status;
    if (served.named === undefined)
      throw new Error("the running service has heard no image from chuggy yet");
    return [
      served.named,
      `${served.named}, as chuggy named it to the running service`,
    ];
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
  const { credentials, settings, engine, runtime, token } = read;
  if ((await engine.exec(imageInspectArgv(image))).code === 0)
    return [true, `${image} is here`];
  const own = settings.image;
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
 * The probe's run: the supervisor's container, as the core runs it, but for
 * its volumes, its network, its command and its capabilities, of which it
 * holds none, so it reads the credential as the supervisor does: as root,
 * the owner it is told, with no capability past a file's mode. Its
 * environment's values are handed to docker's own.
 *
 * @param {ChatDoctorRead} read
 * @param {string} image
 */
export function chatOwnerProbeRun(read, image) {
  const { credentials, settings } = read;
  const container = chatSupervisorContainer(
    image,
    settings.places,
    chatHostMemoryBytes(settings),
  );
  return chatSupervisorRunArgv(
    "docker",
    {
      ...container,
      capabilities: { drop: ["ALL"], add: [] },
      volumes: [],
      command: [chatProbeNode, "-e", chatOwnerProbe],
    },
    {
      name: `${chatSupervisorName(credentials)}-doctor`,
      label: poolLabelValue(credentials),
      network: "none",
    },
  );
}

/**
 * A container of `name` that has exited removed, as a start removes one; one
 * still running is not, and refuses what was to run beside it.
 *
 * @param {Engine} engine
 * @param {string} name
 */
async function chatLeftoverRemoved(engine, name) {
  const removed = await engine.exec(removeArgv(name));
  if (removed.code !== 0 && engineFailure(removed) !== "NoSuchContainer")
    throw new Error(
      `the container ${name} is still there: ${engineFailureLine(removed)}`,
    );
}

/**
 * Whether root, holding no capability, can read the credential through the
 * VM's share, which presents a file as owned by whoever asks of it: the
 * supervisor reads it so, as the owner it is told, root, and a credential it
 * cannot read starts no session.
 *
 * @param {ChatDoctorRead} read
 * @param {string} image
 * @returns {Promise<[true, string]>}
 */
async function chatOwnerProbed(read, image) {
  const { credentials, engine } = read;
  const { argv, environment } = chatOwnerProbeRun(read, image);
  await chatLeftoverRemoved(
    engine,
    `${chatSupervisorName(credentials)}-doctor`,
  );
  const probed = await engine.exec(argv, { environment });
  if (probed.code !== 0)
    throw new Error(
      `root in ${image}, holding no capability, could not read the credential as the supervisor would; another process in the VM may have read it within the second: ${engineFailureLine(probed)}`,
    );
  const [line] = probed.stdout.split("\n").filter((said) => said !== "");
  if (line === undefined)
    throw new Error(`${image} said nothing of the credential it read`);
  const [uid, gid] = line.split(" ");
  return [
    true,
    `root, holding no capability, reads it as the supervisor would, the VM presenting it as uid ${String(uid)}, gid ${String(gid)}`,
  ];
}

/**
 * The supervisor's container as docker has it, then what the host's service
 * says: none, or one a start removes, or the running service's. The container
 * is inspected before the service is asked, since the service binds its
 * socket before it starts the supervisor and closes it only after the
 * supervisor has gone, so one running when inspected where no service answers
 * after is no service's. That one refuses every start beside it, and is never
 * removed by force. One whose service answers what this copy cannot read is
 * that service's, and is warned of, never named for removal.
 *
 * @param {Engine} engine
 * @param {PoolCredentials} credentials
 * @param {string} socket
 * @returns {Promise<{finding: DoctorFinding, service: ChatDoctorService}>}
 */
async function chatSupervisorFinding(engine, credentials, socket) {
  const name = chatSupervisorName(credentials);
  const inspected = await engine.exec(inspectArgv([name]));
  const service = await chatServiceAsked(socket);
  return {
    finding: {
      check: "supervisor container",
      ...chatSupervisorSaid(name, inspected, service),
    },
    service,
  };
}

/**
 * What the doctor says of the supervisor's container given docker's
 * inspection of it and what the service said after.
 *
 * @param {string} name
 * @param {EngineAnswer} inspected
 * @param {ChatDoctorService} service
 * @returns {Omit<DoctorFinding, "check">}
 */
function chatSupervisorSaid(name, inspected, service) {
  if (inspected.code !== 0)
    return engineFailure(inspected) === "NoSuchContainer"
      ? { passed: true, detail: `none named ${name}; a run starts it` }
      : { passed: false, detail: engineFailureLine(inspected) };
  const state = chatContainerState(inspected.stdout);
  if (state === undefined)
    return {
      passed: false,
      detail: `docker said nothing this copy reads of ${name}'s state`,
    };
  if (chatRemovableStates.includes(state))
    return {
      passed: true,
      detail: `${name} is ${state}, and a run removes it`,
    };
  if ("status" in service)
    return {
      passed: true,
      detail: `${name} is ${state}, the running service's`,
    };
  if ("unreadable" in service)
    return {
      passed: true,
      warning: true,
      detail: `${name} is ${state}, the running service's, which answers what this copy cannot read: ${service.unreadable}`,
    };
  return {
    passed: false,
    detail: `${name} is ${state}, and no service of this host answers, so no supervisor starts beside it; remove it with docker rm -f ${name}`,
  };
}

/**
 * A container's state as docker's inspection of it says, or nothing where
 * it says none.
 *
 * @param {string} inspected
 */
function chatContainerState(inspected) {
  try {
    const [container] = /** @type {{State?: {Status?: string}}[]} */ (
      JSON.parse(inspected)
    );
    return container?.State?.Status;
  } catch {
    return undefined;
  }
}

/**
 * What the host's service at `socket` says, told apart from none being
 * there, which is the only answer read as no service: one that answers what
 * this copy cannot read is still there.
 *
 * @param {string} socket
 * @returns {Promise<ChatDoctorService>}
 */
async function chatServiceAsked(socket) {
  try {
    const status = await chatHostStatusAsked(socket);
    return status === undefined ? { none: true } : { status };
  } catch (failure) {
    return {
      unreadable: failure instanceof Error ? failure.message : String(failure),
    };
  }
}

/**
 * The supervisor's memory cap, which docker's VM must hold for the cap to
 * bound it: one above the VM's memory is warned of.
 *
 * @param {ChatHostSettings} settings
 * @param {number} vmMib the VM's memory as docker says it
 * @returns {DoctorFinding}
 */
function chatMemoryFinding(settings, vmMib) {
  const capMib = chatHostMemoryBytes(settings) / 2 ** 20;
  const said = `the supervisor is capped at ${String(capMib)} MiB, sessionsMax ${String(settings.sessionsMax)} at ${String(settings.sessionMemoryBytes / 2 ** 20)} MiB each`;
  return capMib <= vmMib
    ? {
        check: "memory cap",
        passed: true,
        detail: `${said}, within the VM's ${String(vmMib)} MiB`,
      }
    : {
        check: "memory cap",
        passed: true,
        warning: true,
        detail: `${said}, past the VM's ${String(vmMib)} MiB, so the VM runs out before the cap is reached; lower chat.sessionsMax or chat.sessionMemoryMib, or give Colima more memory`,
      };
}

/**
 * The checks that need no engine: the host's file, the runner's and the
 * settings it gives the host, its credential and its layout.
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
    const settings =
      credentials === undefined
        ? chatHostConfigured(read.chat, read.outputBytesMax)
        : chatHostSettings(credentials, read);
    return [
      { config: read, settings },
      `${input.paths.config}: ${chatSettingsLine(settings)}`,
    ];
  });
  if (config !== undefined) {
    findings.push(await claudeCredentialFinding(input, config.config, false));
    await checked(findings, "credential layout", async () => {
      const refusal = await chatCredentialRefusal(config.config, input);
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
  return { credentials, read: config };
}

/**
 * The engine, the network, the supervisor's container and its cap, and the
 * session image named, pulled and run.
 *
 * @param {ChatDoctorInput} input
 * @param {PoolCredentials} credentials
 * @param {{config: RunnerConfig, settings: ChatHostSettings}} found
 * @param {DoctorFinding[]} findings
 */
async function chatEngineChecked(input, credentials, found, findings) {
  const engine = input.parts.engine();
  const machine = await dockerChecked(
    engine,
    credentials,
    findings,
    "this host's",
  );
  if (machine === undefined) return;
  await networkChecked(engine, found.config.network, findings, "network");
  const runtime = poolRuntimeDirectory(input.paths, credentials);
  const { finding, service } = await chatSupervisorFinding(
    engine,
    credentials,
    poolSocket(runtime),
  );
  findings.push(finding);
  /** @type {ChatDoctorRead} */
  const read = {
    credentials,
    ...found,
    engine,
    runtime,
    service,
    token: undefined,
  };
  findings.push(chatMemoryFinding(found.settings, machine.size.memoryMib));
  read.token = await poolTokenChecked(
    input.parts.tokens(credentials),
    credentials,
    findings,
  );
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
  const { credentials, read } = await chatFilesChecked(input, findings);
  findings.push(await agentFinding(input));
  if (read !== undefined)
    findings.push(await updatesFinding(input.parts.updates(read.config)));
  if (
    credentials !== undefined &&
    read !== undefined &&
    "places" in read.settings
  )
    await chatEngineChecked(
      input,
      credentials,
      { config: read.config, settings: read.settings },
      findings,
    );
  return findings;
}

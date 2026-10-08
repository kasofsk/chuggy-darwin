/**
 * The `chuggy-darwin` commands. Each answers an exit status: 0 done, 1 failed,
 * 2 asked wrongly. `run` ends without failing only when the plane denies the
 * pool, which is done, since nothing but a new registration brings the pool
 * back. `once` fails on any pass that did not reconcile, a denial among them.
 */

import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { controlAsked, controlServer } from "@chuggy/worker-core/control.mjs";
import { poolCredentials } from "@chuggy/worker-core/poolCredentials.mjs";
import { workerPoolClientPass } from "@chuggy/worker-core/poolLoop.mjs";
import {
  poolRunnerLoop,
  poolRunnerPassLine,
} from "@chuggy/worker-core/poolRunner.mjs";
import {
  registerAskedChecked,
  registerPoolDirectory,
  registerPoolFileWritten,
  registerRedeemed,
  registerRequest,
} from "@chuggy/worker-core/register.mjs";

import { launchAgentBaseCharsMax } from "./launchAgent.mjs";
import {
  dockerMachine,
  jobNetwork,
  runnerDirectories,
  runnerLeftoversRemoved,
  runnerEngine,
  runnerParts,
  runnerSetup,
  scratchRemovedOnSignal,
} from "./runner.mjs";
import { runnerConfigLimits } from "./runnerConfig.mjs";
import { runnerPaths } from "./runnerPaths.mjs";

/**
 * @typedef {object} CliHost
 * @property {Readonly<Record<string, string | undefined>>} environment
 * @property {string} home
 * @property {number} uid
 * @property {string} hostname
 * @property {typeof globalThis.fetch} fetch
 * @property {import("@chuggy/worker-core/engine.mjs").Engine} [engine] the engine a run uses and registration asks, when not docker
 * @property {import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolClient["tokens"]} [tokens] a run's token source, when not the pool's issuer
 * @property {(line: string) => void} out
 * @property {(line: string) => void} err
 *
 * @typedef {{host: CliHost, poolFile: string, positionals: string[]}} CliCall
 */

/** The variable naming the pool file when `--pool` does not. */
export const poolFileVariable = "CHUGGY_DARWIN_POOL";

const usage = `usage: chuggy-darwin <command> [--pool <file>]
       chuggy-darwin register --api <origin> --token=<token> [--pool <name>]

  register                redeem a registration token for a pool file, the
                          pool named for this machine unless --pool names it
  run                     run the pool until the plane denies it
  once                    one pass, then wait for what it placed to start
  status                  this pool's limits and containers, and what the
                          service is placing
  stop <assignment>       stop one assignment's container

The pool file is --pool, or ${poolFileVariable}.`;

/** @param {CliCall} call */
async function started(call) {
  const setup = await runnerSetup(call.poolFile, call.host.home);
  const runner = await runnerParts(setup, {
    uid: call.host.uid,
    home: call.host.home,
    log: call.host.out,
    engine: call.host.engine,
    tokens: call.host.tokens,
    fetch: call.host.fetch,
  });
  return { setup, runner };
}

/**
 * The service. It claims the pool's control socket before removing what a
 * killed run left, so a second service of the pool is refused before it can
 * remove the first's scratch.
 *
 * @param {CliCall} call
 */
async function run(call) {
  const { setup, runner } = await started(call);
  await runnerDirectories(setup.paths, runner.runtime);
  const server = await controlServer(runner.socket, runner.backend);
  try {
    await runnerLeftoversRemoved(runner.runtime);
    scratchRemovedOnSignal(runner.runtime);
    if ((await jobNetwork(runner.engine, setup.config.network)) === "Created")
      call.host.out(`made the job network ${setup.config.network}`);
    await poolRunnerLoop(runner.client, {
      sleep: (ms) => delay(ms),
      log: call.host.out,
    });
    return 0;
  } finally {
    server.close();
  }
}

/** @param {CliCall} call */
async function once(call) {
  const { setup, runner } = await started(call);
  if ((await controlAsked(runner.socket, { op: "status" })) !== undefined) {
    call.host.err(
      "a chuggy-darwin service is running this pool; stop it before a pass of your own",
    );
    return 1;
  }
  await runnerDirectories(setup.paths, runner.runtime);
  await runnerLeftoversRemoved(runner.runtime);
  scratchRemovedOnSignal(runner.runtime);
  await jobNetwork(runner.engine, setup.config.network);
  const pass = await workerPoolClientPass(runner.client);
  await runner.backend.settled();
  if (pass.passed === "Reconciled") {
    call.host.out(poolRunnerPassLine(pass));
    return 0;
  }
  call.host.err(`${pass.passed}: ${pass.evidence}`);
  return 1;
}

/** @param {CliCall} call */
async function status(call) {
  const { setup, runner } = await started(call);
  const containers = await runner.backend.containers();
  const answered =
    /** @type {{inFlight: import("@chuggy/worker-core/containerBackend.mjs").InFlightPlacement[]} | undefined} */ (
      await controlAsked(runner.socket, { op: "status" })
    );
  call.host.out(
    answered === undefined ? "service: not running" : "service: running",
  );
  call.host.out(`limits: ${runnerConfigLimits(setup.config)}`);
  for (const placement of answered?.inFlight ?? [])
    call.host.out(
      `${placement.name}  ${placement.kind.toLowerCase()}  ${placement.phase.toLowerCase()}  ${placement.image}  ${placement.assignment}`,
    );
  for (const container of containers)
    call.host.out(
      `${container.name}  ${container.kind.toLowerCase()}  ${container.status}  deadline ${container.deadlineEpochSecs === undefined ? "none" : new Date(container.deadlineEpochSecs * 1000).toISOString()}  ${container.assignment ?? "no assignment"}`,
    );
  return 0;
}

/** @param {CliCall} call */
async function stop(call) {
  const [assignment] = call.positionals;
  if (assignment === undefined || call.positionals.length !== 1) {
    call.host.err(usage);
    return 2;
  }
  const { runner } = await started(call);
  const answered =
    /** @type {{stopped?: string, evidence?: string, refused?: string}} */ (
      (await controlAsked(runner.socket, { op: "stop", assignment })) ??
        (await runner.backend.stop(assignment))
    );
  if (answered.stopped === "Stopped") {
    call.host.out(`stopped ${assignment}`);
    return 0;
  }
  call.host.err(answered.evidence ?? answered.refused ?? "not stopped");
  return 1;
}

/**
 * Redeems a registration token and writes the pool file it answers. It takes
 * no pool file: its `--pool` is the name the pool takes. The platform it
 * declares is docker's VM's, which can differ from the Mac's, so docker is
 * asked once the ask is found sound, and must answer before the token is spent.
 *
 * @param {CliHost} host
 * @param {import("@chuggy/worker-core/register.mjs").RegisterAsked} asked
 */
async function register(host, asked) {
  const ask = registerAskedChecked(asked, host.hostname);
  if ("refused" in ask) {
    host.err(ask.refused);
    return 2;
  }
  const { arch } = await dockerMachine(host.engine ?? runnerEngine());
  const requested = registerRequest(asked, {
    hostname: host.hostname,
    arch,
  });
  if ("refused" in requested) {
    host.err(requested.refused);
    return 2;
  }
  const { pools } = runnerPaths(host.home);
  await registerPoolDirectory(pools);
  const pool = await registerRedeemed(requested.request, host.fetch);
  const { file, replaced } = await registerPoolFileWritten(
    pools,
    pool,
    launchAgentBaseCharsMax,
  ).catch((/** @type {unknown} */ failure) => {
    throw new Error(
      `the pool file could not be written, and the token is spent, so mint another: ${failure instanceof Error ? failure.message : String(failure)}`,
      { cause: failure },
    );
  });
  await poolCredentials(file);
  host.out(`${replaced ? "replaced" : "wrote"} ${file}`);
  return 0;
}

const commands = { run, once, status, stop };

/**
 * @param {readonly string[]} argv the arguments after the entry
 * @param {CliHost} host
 * @returns {Promise<number>} the exit status
 */
export async function cliMain(argv, host) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        pool: { type: "string" },
        api: { type: "string" },
        token: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch (failure) {
    host.err(`${/** @type {Error} */ (failure).message}\n${usage}`);
    return 2;
  }
  const { values } = parsed;
  const [name, ...positionals] = parsed.positionals;
  if (values.help === true || name === "help") {
    host.out(usage);
    return 0;
  }
  const registering = name === "register";
  const command = Object.hasOwn(commands, name ?? "")
    ? commands[/** @type {keyof typeof commands} */ (name)]
    : undefined;
  if (
    (!registering &&
      (command === undefined ||
        values.api !== undefined ||
        values.token !== undefined)) ||
    (name !== "stop" && positionals.length > 0)
  ) {
    host.err(usage);
    return 2;
  }
  const poolFile = values.pool ?? host.environment[poolFileVariable];
  if (!registering && (poolFile === undefined || poolFile === "")) {
    host.err(
      `no pool file: name one with --pool or ${poolFileVariable}\n${usage}`,
    );
    return 2;
  }
  try {
    if (registering) return await register(host, values);
    return await /** @type {(call: CliCall) => Promise<number>} */ (command)({
      host,
      poolFile: resolve(/** @type {string} */ (poolFile)),
      positionals,
    });
  } catch (failure) {
    host.err(failure instanceof Error ? failure.message : String(failure));
    return 1;
  }
}

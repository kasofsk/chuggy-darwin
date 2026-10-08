/**
 * The `chuggy-darwin` commands. Each answers an exit status: 0 done, 1 failed,
 * 2 asked wrongly.
 */

import { parseArgs } from "node:util";

import { poolCredentials } from "@chuggy/worker-core/poolCredentials.mjs";
import {
  registerPoolDirectory,
  registerPoolFileWritten,
  registerRedeemed,
  registerRequest,
} from "@chuggy/worker-core/register.mjs";

import { launchAgentBaseCharsMax } from "./launchAgent.mjs";
import { runnerPaths } from "./runnerPaths.mjs";

/**
 * @typedef {object} CliHost
 * @property {string} home
 * @property {string} hostname
 * @property {string} arch as `process.arch` names it
 * @property {typeof globalThis.fetch} fetch
 * @property {(line: string) => void} out
 * @property {(line: string) => void} err
 */

const usage = `usage: chuggy-darwin register --api <origin> --token=<token> [--pool <name>]

  register                redeem a registration token for a pool file, the
                          pool named for this machine unless --pool names it`;

/**
 * Redeems a registration token and writes the pool file it answers.
 *
 * @param {CliHost} host
 * @param {import("@chuggy/worker-core/register.mjs").RegisterAsked} asked
 */
async function register(host, asked) {
  const requested = registerRequest(asked, host);
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
  if (name !== "register" || positionals.length > 0) {
    host.err(usage);
    return 2;
  }
  try {
    return await register(host, values);
  } catch (failure) {
    host.err(failure instanceof Error ? failure.message : String(failure));
    return 1;
  }
}

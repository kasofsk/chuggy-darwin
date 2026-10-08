/**
 * Where the runner reads and writes on a Mac. A pool file is where chuggy-linux
 * keeps one, so one registration serves either runner of a machine.
 */

import { join } from "node:path";

/**
 * @typedef {object} RunnerPaths
 * @property {string} pools the directory register writes pool files to
 */

/**
 * @param {string} home
 * @returns {RunnerPaths}
 */
export function runnerPaths(home) {
  return { pools: join(home, ".config", "chuggy", "pools") };
}

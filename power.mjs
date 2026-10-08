/**
 * Keeps the Mac from idle sleep while its pool holds work, since a sleeping
 * Mac pauses docker's VM and the work's leases lapse. `caffeinate -i` asserts
 * against idle sleep only: a closed lid on battery still sleeps. It is told
 * to end with this process, so a killed runner leaves no assertion behind.
 */

import { spawn } from "node:child_process";

/**
 * @typedef {object} PowerAssertion
 * @property {(holding: boolean) => void} held whether the pool holds work now
 * @property {() => boolean} asserted
 */

/**
 * @param {{spawn?: typeof spawn, pid?: number, log?: (line: string) => void}} [seams]
 * @returns {PowerAssertion}
 */
export function powerAssertion(seams = {}) {
  const started = seams.spawn ?? spawn;
  const pid = seams.pid ?? process.pid;
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let caffeinate;
  return {
    held(holding) {
      if (holding && caffeinate === undefined) {
        const child = started(
          "/usr/bin/caffeinate",
          ["-i", "-w", String(pid)],
          {
            stdio: "ignore",
          },
        );
        child.on("error", (failure) =>
          seams.log?.(`the Mac could not be kept awake: ${failure.message}`),
        );
        child.on("close", () => {
          if (caffeinate === child) caffeinate = undefined;
        });
        caffeinate = child;
      } else if (!holding && caffeinate !== undefined) {
        caffeinate.kill();
        caffeinate = undefined;
      }
    },
    asserted: () => caffeinate !== undefined,
  };
}

/**
 * The backend as the loop sees it, telling the assertion after each read of
 * what the pool holds, which a pass makes first and which counts placements
 * still in flight.
 *
 * @template {import("@chuggy/worker-core/poolLoop.mjs").WorkerPoolBackend} B
 * @param {B} backend
 * @param {PowerAssertion} power
 * @returns {B}
 */
export function poweredBackend(backend, power) {
  return {
    ...backend,
    held: async () => {
      const held = await backend.held();
      power.held(held.length > 0);
      return held;
    },
  };
}

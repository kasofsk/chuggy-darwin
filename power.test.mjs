import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { powerAssertion, poweredBackend } from "./power.mjs";

/** A spawn that records what it started and what it killed. */
function recordingSpawn() {
  /** @type {Array<{command: string, argv: string[], killed: boolean}>} */
  const started = [];
  /** @type {EventEmitter[]} */
  const children = [];
  const spawn = /** @type {any} */ (
    (/** @type {string} */ command, /** @type {string[]} */ argv) => {
      const record = { command, argv, killed: false };
      started.push(record);
      const child = Object.assign(new EventEmitter(), {
        kill: () => {
          record.killed = true;
          return true;
        },
      });
      children.push(child);
      return child;
    }
  );
  return { spawn, started, children };
}

test("the Mac is kept awake from the first read that finds work held until one finds none, by one caffeinate bound to this process", async () => {
  const { spawn, started } = recordingSpawn();
  const power = powerAssertion({ spawn, pid: 4242 });
  /** @type {unknown[][]} */
  const reads = [
    [],
    [{ assignment: "a", kind: "Job" }],
    [{ assignment: "a", kind: "Job" }],
    [],
  ];
  const backend = poweredBackend(
    /** @type {any} */ ({
      held: async () => reads.shift(),
      stop: () => "kept",
    }),
    power,
  );
  assert.equal(backend.stop(), "kept");
  await backend.held();
  assert.equal(power.asserted(), false);
  await backend.held();
  await backend.held();
  assert.equal(power.asserted(), true);
  assert.deepEqual(started, [
    {
      command: "/usr/bin/caffeinate",
      argv: ["-i", "-w", "4242"],
      killed: false,
    },
  ]);
  await backend.held();
  assert.equal(power.asserted(), false);
  assert.equal(started[0].killed, true);
});

test("a caffeinate that could not start, or ended of itself, is started again by the next read that finds work, and the failure is logged", () => {
  const { spawn, started, children } = recordingSpawn();
  /** @type {string[]} */
  const log = [];
  const power = powerAssertion({
    spawn,
    pid: 1,
    log: (line) => log.push(line),
  });
  power.held(true);
  power.held(true);
  assert.equal(started.length, 1);
  children[0].emit("error", new Error("spawn caffeinate ENOENT"));
  children[0].emit("close", -2, null);
  assert.equal(power.asserted(), false);
  assert.deepEqual(log, [
    "the Mac could not be kept awake: spawn caffeinate ENOENT",
  ]);
  power.held(true);
  assert.equal(started.length, 2);
  assert.equal(power.asserted(), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import { fakeColima, vmCounts } from "./engine.fixture.mjs";
import { loadavgFacts, machineFacts, meminfoFacts } from "./machineFacts.mjs";

/** What `vmCounts` counts, as a report names it. */
const counted = {
  loadAverageOneMinute: 0.5,
  memoryTotalBytes: 2097152 * 1024,
  memoryAvailableBytes: 1572864 * 1024,
};

/** @param {number} diskFreeGibMin */
const configured = (diskFreeGibMin) =>
  /** @type {import("./runnerConfig.mjs").RunnerConfig} */ (
    /** @type {unknown} */ ({ diskFreeGibMin })
  );

/** The VM's disk, 30 GiB free under its engine's storage. */
const diskFree = async () => ({
  free: 30 * 2 ** 30,
  where: "/var/lib/docker",
});

/**
 * Ports reading docker's VM of 2 CPUs named `name`, through `colima`.
 *
 * @param {string} name
 * @param {import("./colimaVm.mjs").ColimaCli} colima
 * @param {() => Promise<import("@chuggy/worker-core/diskFloor.mjs").DiskFree>} [measured]
 */
const vm = (name, colima, measured = diskFree) => ({
  docker: async () => ({ cpus: 2, name }),
  colima,
  diskFree: measured,
});

test("a report's memory is the VM's /proc/meminfo's MemTotal and MemAvailable, in bytes, and a figure it does not count as Linux does is left out", () => {
  assert.deepEqual(meminfoFacts(vmCounts), {
    memoryTotalBytes: 2097152 * 1024,
    memoryAvailableBytes: 1572864 * 1024,
  });
  assert.deepEqual(
    meminfoFacts(vmCounts.replace(/^MemAvailable:.*\n/mu, "")),
    { memoryTotalBytes: 2097152 * 1024 },
    "available memory is never taken from MemFree",
  );
  assert.deepEqual(meminfoFacts(""), {});
  assert.deepEqual(
    meminfoFacts("MemTotal: 2048 MB\nMemAvailable: lots kB\n"),
    {},
  );
  assert.deepEqual(meminfoFacts(`MemTotal: ${"9".repeat(17)} kB\n`), {});
});

test("a report's load is the VM's /proc/loadavg's first figure, read past what a login profile prints, and left out where no line counts it", () => {
  assert.deepEqual(loadavgFacts("0.50 0.25 0.12 2/180 4242\n"), {
    loadAverageOneMinute: 0.5,
  });
  assert.deepEqual(
    loadavgFacts(`Welcome to Ubuntu 24.04\n12.75 3.10 1.00 9/301 77\n`),
    { loadAverageOneMinute: 12.75 },
  );
  assert.deepEqual(
    loadavgFacts(`3.14 kernel, 2 updates\n0.75 0.50 0.25 1/90 12\n`),
    { loadAverageOneMinute: 0.75 },
  );
  assert.deepEqual(loadavgFacts(""), {});
  assert.deepEqual(loadavgFacts("high 0.25 0.12 2/180 4242\n"), {});
  assert.deepEqual(loadavgFacts("MemTotal:        2097152 kB\n"), {});
});

test("a report names Colima's VM, as docker names it: its CPUs, its load and memory from its Linux, and its free disk with the floor where the file keeps one", async () => {
  const { colima, calls } = fakeColima(30);
  assert.deepEqual(await machineFacts(configured(20), vm("colima", colima))(), {
    cpus: 2,
    ...counted,
    diskFreeBytes: 30 * 2 ** 30,
    diskFloorBytes: 20 * 2 ** 30,
  });
  assert.deepEqual(calls, [
    [
      "ssh",
      "--profile",
      "default",
      "--",
      "cat",
      "/proc/meminfo",
      "/proc/loadavg",
    ],
  ]);
  /** @type {number[]} */
  const measured = [];
  const measuring = async () => {
    measured.push(1);
    return diskFree();
  };
  assert.deepEqual(
    await machineFacts(configured(0), vm("colima", colima, measuring))(),
    { cpus: 2, ...counted },
  );
  assert.equal(measured.length, 0, "a file keeping no floor measures none");
});

test("a fact the VM cannot give is left out, never taken from the Mac, and every other is still named", async () => {
  const unknown = async () => ({ unknown: "the VM's df could not be read" });
  const disk = { diskFreeBytes: 30 * 2 ** 30, diskFloorBytes: 20 * 2 ** 30 };
  const stopped = fakeColima(30);
  assert.deepEqual(
    await machineFacts(configured(20), vm("colima-work", stopped.colima))(),
    { cpus: 2, ...disk },
    "a profile Colima does not run",
  );
  const other = fakeColima(30);
  assert.deepEqual(
    await machineFacts(configured(20), vm("desktop-linux", other.colima))(),
    { cpus: 2, ...disk },
    "a VM Colima does not run",
  );
  assert.deepEqual(other.calls, []);
  const hung = {
    exec: async () => {
      throw new Error("The operation was aborted");
    },
  };
  assert.deepEqual(
    await machineFacts(configured(20), vm("colima", hung, unknown))(),
    { cpus: 2 },
  );
  const dropped = {
    exec: async () => ({
      code: 255,
      stdout: vmCounts,
      stderr: "Connection to 127.0.0.1 closed by remote host.",
    }),
  };
  assert.deepEqual(
    await machineFacts(configured(20), vm("colima", dropped, unknown))(),
    { cpus: 2 },
    "an answer that failed is not read",
  );
  const thrown = async () => {
    throw new Error("df hung up");
  };
  const noisy = fakeColima(30, { counts: "MemTotal: lots\n" });
  assert.deepEqual(
    await machineFacts(configured(20), vm("colima", noisy.colima, thrown))(),
    { cpus: 2 },
  );
  const unreachable = {
    ...vm("colima", fakeColima(30).colima),
    docker: async () => {
      throw new Error("docker could not be asked");
    },
  };
  assert.deepEqual(
    await machineFacts(configured(20), unreachable)(),
    disk,
    "a VM docker cannot be asked of",
  );
});

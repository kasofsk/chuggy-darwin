/**
 * What a runner report says of the machine its jobs run on, where the
 * runner's file sets `reportMetrics`. That machine is Colima's VM and not the
 * Mac, as it is for a container job's size, the disk floor and the memory
 * budget: the VM's CPUs as docker counts them, its load and memory as its
 * Linux's `/proc/loadavg` and `/proc/meminfo` count them, read with `colima
 * ssh`, and, where the agent holds a disk floor, that floor and the space free
 * under it, measured as the floor measures it. A fact that cannot be read,
 * such as the load and memory of a VM Colima does not run, is left out, never
 * estimated from another or taken from the Mac.
 */

import { colimaProfile, colimaVmArgv } from "./colimaVm.mjs";
import { diskFloorBytes } from "./diskFree.mjs";

/**
 * @typedef {import("@chuggy/worker-core/runnerReport.mjs").RunnerMachine} RunnerMachine
 * @typedef {import("@chuggy/worker-core/diskFloor.mjs").DiskFree} DiskFree
 * @typedef {import("./runnerConfig.mjs").RunnerConfig} RunnerConfig
 *
 * @typedef {object} VmFactPorts what the VM's facts are read by
 * @property {() => Promise<{cpus: number, name: string}>} docker docker's VM, as `dockerMachine` finds it
 * @property {import("./colimaVm.mjs").ColimaCli} colima
 * @property {() => Promise<DiskFree>} diskFree the VM's free disk, as the floor measures it
 */

/** What the VM's Linux counts its load and memory in, read in one call. */
const vmCountFiles = ["/proc/meminfo", "/proc/loadavg"];

/** The bytes in the unit `/proc/meminfo` counts in, which it names kB. */
const meminfoUnitBytes = 1024;

/**
 * The bytes a `/proc/meminfo` line counts for `field`, or nothing where no
 * line counts it as Linux does.
 *
 * @param {string} text
 * @param {string} field
 */
function meminfoBytes(text, field) {
  const counted = new RegExp(`^${field}:\\s+(\\d+) kB$`, "mu").exec(text);
  if (counted === null) return undefined;
  const bytes = Number(counted[1]) * meminfoUnitBytes;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

/**
 * The memory a `/proc/meminfo` text counts, MemAvailable being the kernel's
 * own count of what can be taken without swapping, each figure it does not
 * count left out.
 *
 * @param {string} text
 * @returns {Pick<RunnerMachine, "memoryTotalBytes" | "memoryAvailableBytes">}
 */
export function meminfoFacts(text) {
  const total = meminfoBytes(text, "MemTotal");
  const available = meminfoBytes(text, "MemAvailable");
  return {
    ...(total === undefined ? {} : { memoryTotalBytes: total }),
    ...(available === undefined ? {} : { memoryAvailableBytes: available }),
  };
}

/**
 * The one-minute load a `/proc/loadavg` line counts, or nothing where no line
 * counts it as Linux does.
 *
 * @param {string} text
 * @returns {Pick<RunnerMachine, "loadAverageOneMinute">}
 */
export function loadavgFacts(text) {
  const counted = /^(\d+\.\d+) \d+\.\d+ \d+\.\d+ \d+\/\d+ \d+$/mu.exec(text);
  return counted === null ? {} : { loadAverageOneMinute: Number(counted[1]) };
}

/**
 * The load and memory the VM docker names counts, or nothing where Colima
 * does not run it or it cannot be asked.
 *
 * @param {VmFactPorts} ports
 * @param {string} name the VM, as docker names it
 */
async function vmCounted(ports, name) {
  const profile = colimaProfile(name);
  if (profile === undefined) return {};
  const answer = await ports.colima
    .exec(colimaVmArgv(profile, ["cat", ...vmCountFiles]))
    .catch(() => undefined);
  if (answer === undefined || answer.code !== 0) return {};
  return { ...loadavgFacts(answer.stdout), ...meminfoFacts(answer.stdout) };
}

/**
 * The floor the runner's file keeps and the space free under it, or nothing
 * where it keeps none, as the agent then measures none, or the space cannot
 * be measured.
 *
 * @param {RunnerConfig} config
 * @param {() => Promise<DiskFree>} diskFree
 * @returns {Promise<Pick<RunnerMachine, "diskFreeBytes" | "diskFloorBytes">>}
 */
async function diskFacts(config, diskFree) {
  if (config.diskFreeGibMin === 0) return {};
  const measured = await diskFree().catch(() => undefined);
  if (measured === undefined || "unknown" in measured) return {};
  return {
    diskFreeBytes: measured.free,
    diskFloorBytes: diskFloorBytes(config),
  };
}

/**
 * The VM's facts as a report reads them, each read as the report is made.
 *
 * @param {RunnerConfig} config
 * @param {VmFactPorts} ports
 * @returns {() => Promise<RunnerMachine>}
 */
export function machineFacts(config, ports) {
  return async () => {
    const docker = await ports.docker().catch(() => undefined);
    return {
      ...(docker === undefined
        ? {}
        : { cpus: docker.cpus, ...(await vmCounted(ports, docker.name)) }),
      ...(await diskFacts(config, ports.diskFree)),
    };
  };
}

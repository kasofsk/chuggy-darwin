#!/usr/bin/env node
import { homedir, hostname } from "node:os";

import { cliMain } from "./commands.mjs";

process.exit(
  await cliMain(process.argv.slice(2), {
    home: homedir(),
    hostname: hostname(),
    arch: process.arch,
    fetch: globalThis.fetch,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }),
);

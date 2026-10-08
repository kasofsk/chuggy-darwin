#!/usr/bin/env node
import { homedir, hostname } from "node:os";

import { cliMain } from "./commands.mjs";

process.exit(
  await cliMain(process.argv.slice(2), {
    environment: process.env,
    home: homedir(),
    uid: process.getuid?.() ?? -1,
    hostname: hostname(),
    fetch: globalThis.fetch,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }),
);

import assert from "node:assert/strict";
import test from "node:test";

import { registerPoolFileName } from "@chuggy/worker-core/register.mjs";

import { launchAgentBaseCharsMax } from "./launchAgent.mjs";

test("every pool file register names under the agent bound leaves its property list's name within a file name", () => {
  const tenant = "t".repeat(
    launchAgentBaseCharsMax - "p".length - "shame".length - "..".length,
  );
  const longest = registerPoolFileName(
    { tenant, project: "p", pool: "shame" },
    launchAgentBaseCharsMax,
  );
  assert.equal(longest, `${tenant}.p.shame.json`);
  assert.equal(
    `chuggy-darwin.${longest.slice(0, -".json".length)}.plist`.length,
    255,
  );
  assert.match(
    registerPoolFileName(
      { tenant: `${tenant}t`, project: "p", pool: "shame" },
      launchAgentBaseCharsMax,
    ),
    /^pool-[0-9a-f]{20}\.json$/u,
  );
});

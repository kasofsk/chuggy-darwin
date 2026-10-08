import assert from "node:assert/strict";
import test from "node:test";

import { registerPoolFileName } from "@chuggy/worker-core/register.mjs";

import {
  launchAgentBaseCharsMax,
  launchAgentLabel,
  launchAgentPlist,
  launchAgentPoolFile,
} from "./launchAgent.mjs";

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

test("an agent is labelled for its pool file, and a name a label is not given here is refused", () => {
  assert.equal(
    launchAgentLabel(
      "/Users/shame/.config/chuggy/pools/vteng.chuggy.shame.json",
    ),
    "chuggy-darwin.vteng.chuggy.shame",
  );
  for (const file of ["/p/a b.json", "/p/.hidden.json", "/p/a&b.json"])
    assert.throws(
      () => launchAgentLabel(file),
      /is not named as an agent can be/u,
    );
  assert.throws(
    () =>
      launchAgentLabel(`/p/${"a".repeat(launchAgentBaseCharsMax + 1)}.json`),
    /longer than a Mac takes/u,
  );
});

test("an agent restarts its runner after any exit but 0, and its pool file reads back through the escaping", () => {
  const poolFile = "/Users/a&b/<pools>/p.json";
  const plist = launchAgentPlist({
    label: "chuggy-darwin.p",
    node: "/opt/homebrew/bin/node",
    cli: "/opt/chuggy-darwin/cli.mjs",
    poolFile,
    path: "/usr/bin:/opt/homebrew/bin",
    log: "/Users/a/Library/Logs/chuggy-darwin/chuggy-darwin.p.log",
  });
  assert.match(
    plist,
    /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/u,
  );
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/u);
  assert.ok(
    plist.includes("<string>/Users/a&amp;b/&lt;pools&gt;/p.json</string>"),
  );
  assert.equal(launchAgentPoolFile(plist), poolFile);
  assert.equal(launchAgentPoolFile("<plist/>"), undefined);
});

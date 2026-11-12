/**
 * The configuration in `.chug/configurations/`. A workload with no
 * `credentials` key is granted everything the deployment allows, and a listed
 * name the deployment does not grant is dropped without a report; nothing in
 * a run shows either.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const path = new URL(
  ".chug/configurations/chuggy-darwin.json",
  import.meta.url,
);

test("every workload lists its credentials, and none lists chuggy-github-worker, which the deployment does not grant", async () => {
  const { workloads } = JSON.parse(await readFile(path, "utf8")).configuration;
  const entries = Object.entries(workloads);

  assert.ok(entries.length > 0);
  for (const [name, { authority }] of entries) {
    assert.ok(Array.isArray(authority.credentials), name);
    assert.ok(!authority.credentials.includes("chuggy-github-worker"), name);
  }
});

test("a ticket naming no finalization lands by a pull request merge under the Stacked policy", async () => {
  const { version, finalizers, defaults } = JSON.parse(
    await readFile(path, "utf8"),
  ).configuration;

  assert.equal(version, 3);
  assert.deepEqual(finalizers[defaults.finalization].finalization, {
    kind: "GitMerge",
    mode: "PullRequestMerge",
    policy: "Stacked",
  });
});

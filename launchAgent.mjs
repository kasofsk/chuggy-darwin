/**
 * The launchd agent serving a pool, which this runner names for the pool's
 * file: its label is the file's name less `.json` under this runner's prefix,
 * and its property list is that label as a file in `~/Library/LaunchAgents`.
 */

/** What every agent's label of this runner begins with. */
const launchAgentPrefix = "chuggy-darwin.";

/** What a property list's file name ends with. */
const launchAgentSuffix = ".plist";

/** The longest file name APFS takes, in bytes, which these names spend one per character. */
const fileNameBytesMax = 255;

/** The longest pool file name, less `.json`, whose agent's property list can be named for it. */
export const launchAgentBaseCharsMax =
  fileNameBytesMax - launchAgentPrefix.length - launchAgentSuffix.length;

/**
 * The bound register is given on a Mac: room for the launchd agent that will
 * serve a pool to be named for its file, as `chuggy-darwin.<base>.plist`.
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

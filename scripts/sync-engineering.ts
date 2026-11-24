import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { parseArgs } from "node:util";
import { bootstrapDataRoot } from "../src/main/development/catalogue-bootstrap.js";
import { syncDevelopmentEngineering } from "../src/main/development/engineering-sync.js";
import { describeEngineeringSyncError } from "../src/main/development/catalogue-exclusion.js";

const usage = "Usage: npm run sync:engineering -- [--check] [--data-dir <development-root>]";
let advisory = false;
const interruption = new AbortController();
const interrupt = (signal: "SIGINT" | "SIGTERM", exitCode: number) => {
  if (interruption.signal.aborted) return;
  process.exitCode = exitCode;
  console.error(`${signal} received; waiting for the current operation to settle before releasing catalogue access and cleaning temporary files.`);
  interruption.abort(new Error(`Engineering sync interrupted by ${signal}; rerun to resume any remaining phase`));
};
const onInterrupt = () => interrupt("SIGINT", 130);
const onTerminate = () => interrupt("SIGTERM", 143);
try {
  const { values } = parseArgs({options: {
    check: {type: "boolean"}, "data-dir": {type: "string"}, help: {type: "boolean"},
    advisory: {type: "boolean"},
  }});
  advisory = values.advisory ?? false;
  if (advisory && !values.check) throw new Error("Advisory mode requires --check");
  if (values.help) console.log(usage);
  else {
    // Do not exit, close SQLite, or delete frozen inputs from a signal handler:
    // the importer may still be awaiting its asynchronous backup.
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    const result = await syncDevelopmentEngineering({dataRoot: bootstrapDataRoot(values["data-dir"]),
      applicationRoot: path.resolve(import.meta.dirname, "../.."), check: values.check, log: console.error,
      signal: interruption.signal});
    // Drain signals queued during final synchronous work/cleanup before
    // announcing completion and unregistering the CLI handlers.
    await setImmediate();
    interruption.signal.throwIfAborted();
    console.log(JSON.stringify(result, null, 2));
    if (values.check && (result.engineeringNeeded || result.drawingsNeeded)) {
      console.warn("Engineering synchronization is needed. Close Electron, then run npm run sync:engineering with the same development root.");
      if (!advisory) process.exitCode = 2;
    }
  }
} catch (error) {
  // A synchronous failure can also leave an OS signal pending.
  await setImmediate();
  console.error(`Engineering sync ${interruption.signal.aborted ? "interrupted" : advisory ? "advisory" : "refused"}: ${describeEngineeringSyncError(error)}`);
  if (!advisory && !interruption.signal.aborted) process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onTerminate);
}

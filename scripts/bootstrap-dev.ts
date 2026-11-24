import path from "node:path";
import { parseArgs } from "node:util";
import { bootstrapDataRoot, bootstrapDevelopmentCatalogue } from "../src/main/development/catalogue-bootstrap.js";

const usage = "Usage: npm run bootstrap:dev -- [--data-dir <application-data-root>] <source-data-root>";

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "data-dir": { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1 || !positionals[0]?.trim() || values["data-dir"]?.trim() === "") {
      throw new Error(usage);
    }
    const dataRoot = bootstrapDataRoot(values["data-dir"]);
    console.log(`Development data root: ${dataRoot}`);
    const summary = await bootstrapDevelopmentCatalogue({ sourceRoot: positionals[0], dataRoot,
      applicationRoot: path.resolve(import.meta.dirname, "../.."), log: console.log });
    console.log("Development catalogue bootstrap complete:");
    console.log(JSON.stringify(summary, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

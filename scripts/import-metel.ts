/*
 * TEMPORARY developer tool: imports one METEL delivery into the development
 * data folder so the catalogue screen has data. Not part of the product.
 *
 *   npm run import:metel -- BTILSP021.txt BTIFSC.txt BTIFST.txt
 *   npm run import:metel -- --data-dir /some/folder --accept-older <files>
 */
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { resolveApplicationDataPath } from "../src/main/data-paths.js";
import { OlderDeliveryConfirmationRequiredError } from "../src/main/metel/catalogue-normalization.js";
import { importMetelDeliveryFromFiles } from "../src/main/metel/dev-import.js";

const applicationRoot = path.resolve(import.meta.dirname, "..", "..");

/** The folder `npm start` uses: Electron's appData + "LibreQuadri Development". */
function developmentDataRoot(): string {
  const platform = process.platform;
  const appData =
    platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : platform === "win32"
        ? (process.env["APPDATA"] ?? path.join(homedir(), "AppData", "Roaming"))
        : (process.env["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config"));

  return resolveApplicationDataPath({
    platform,
    mode: "development",
    electronAppDataPath: appData,
    electronDefaultUserDataPath: path.join(appData, "LibreQuadri"),
    environment: process.env,
  });
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "data-dir": { type: "string" },
      "accept-older": { type: "boolean", default: false },
    },
  });

  if (positionals.length === 0) {
    console.error(
      "Usage: npm run import:metel -- [--data-dir <dir>] [--accept-older] <LSP> [FSC] [FST]",
    );
    process.exit(2);
  }

  const dataRoot = values["data-dir"]
    ? path.resolve(values["data-dir"])
    : developmentDataRoot();
  console.log(`Data folder: ${dataRoot}`);

  const result = importMetelDeliveryFromFiles({
    dataRoot,
    lqMigrationsFolder: path.join(applicationRoot, "db", "migrations", "lq"),
    rawMigrationsFolder: path.join(applicationRoot, "db", "migrations", "raw"),
    seedFolder: path.join(applicationRoot, "db", "seed"),
    files: positionals,
    acceptOlderDelivery: values["accept-older"],
  });

  for (const file of result.files) {
    console.log(
      `  ${file.fileType}  ${file.rowCount} rows  ${
        file.alreadyParsed ? "(already parsed)" : "parsed"
      }  ${file.path}`,
    );
  }
  const { delivery } = result;
  console.log(
    delivery.alreadyNormalized
      ? `Delivery already imported (id ${delivery.deliveryId}); nothing changed.`
      : `Delivery ${delivery.deliveryId} normalized (${
          delivery.becameCurrent ? "current" : "older, price history only"
        }).`,
  );
  console.log(JSON.stringify(delivery.summary));
}

try {
  main();
} catch (error) {
  if (error instanceof OlderDeliveryConfirmationRequiredError) {
    console.error(`${error.message}. Re-run with --accept-older to confirm.`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}

import { mkdirSync } from "node:fs";
import path from "node:path";

import { loadAttributeSeed } from "../catalogue/attribute-seed.js";
import { loadCategorySeed } from "../catalogue/category-seed.js";
import { loadProductFamilySeed } from "../catalogue/family-seed.js";
import { applicationPaths } from "../data-paths.js";
import { openMigratedLqDatabase } from "../database/lq-migrations.js";
import { openMigratedRawDatabase } from "../database/raw-migrations.js";
import { closeConfiguredDatabase } from "../database/sqlite-connection.js";
import {
  normalizeMetelDelivery,
  type DeliveryNormalizationResult,
} from "./catalogue-normalization.js";
import { ingestMetelFileFromPath } from "./raw-ingestion.js";

/*
 * TEMPORARY developer tooling. It only chains the existing METEL pipeline
 * (raw ingestion -> delivery assembly -> catalogue normalization) for local
 * development until the production import UI exists. It adds no import logic
 * of its own and does not archive source files.
 */

export interface DevImportOptions {
  /** Application data folder (the same layout as Electron's userData). */
  readonly dataRoot: string;
  readonly lqMigrationsFolder: string;
  readonly rawMigrationsFolder: string;
  /** Seed folder; defaults to `db/seed` in the working directory. */
  readonly seedFolder?: string;
  /** One LSP plus optionally one FSC and one FST, all from the same issuer. */
  readonly files: readonly string[];
  readonly acceptOlderDelivery?: boolean;
}

export interface DevImportedFile {
  readonly path: string;
  readonly fileType: "LSP" | "FSC" | "FST";
  readonly rowCount: number;
  readonly alreadyParsed: boolean;
}

export interface DevImportResult {
  readonly files: readonly DevImportedFile[];
  readonly delivery: DeliveryNormalizationResult;
}

export function importMetelDeliveryFromFiles(
  options: DevImportOptions,
): DevImportResult {
  if (options.files.length === 0) {
    throw new Error("No METEL files given");
  }

  const paths = applicationPaths(options.dataRoot);
  mkdirSync(paths.data, { recursive: true });

  const rawDatabase = openMigratedRawDatabase({
    databaseFilename: paths.rawDatabase,
    migrationsFolder: options.rawMigrationsFolder,
  });
  try {
    const lqDatabase = openMigratedLqDatabase({
      databaseFilename: paths.lqDatabase,
      backupDirectory: paths.backups,
      migrationsFolder: options.lqMigrationsFolder,
    });
    try {
      const files: DevImportedFile[] = [];
      const hashes: { LSP?: string; FSC?: string; FST?: string } = {};
      for (const sourcePath of options.files) {
        const ingested = ingestMetelFileFromPath({
          database: rawDatabase,
          sourcePath: path.resolve(sourcePath),
        });
        if (hashes[ingested.fileType] !== undefined) {
          throw new Error(
            `More than one ${ingested.fileType} file given; a delivery has at most one of each type`,
          );
        }
        hashes[ingested.fileType] = ingested.fileSha256;
        files.push({
          path: sourcePath,
          fileType: ingested.fileType,
          rowCount: ingested.rowCount,
          alreadyParsed: ingested.alreadyParsed,
        });
      }
      const { LSP, FSC, FST } = hashes;
      if (LSP === undefined) {
        throw new Error("A delivery needs exactly one LSP (price list) file");
      }

      const delivery = normalizeMetelDelivery({
        lqDatabase,
        rawDatabase,
        sources: { LSP, FSC, FST },
        acceptOlderDelivery: options.acceptOlderDelivery,
        ...(options.seedFolder === undefined
          ? {}
          : {
              categorySeed: loadCategorySeed(options.seedFolder),
              attributeSeed: loadAttributeSeed(options.seedFolder),
              familySeed: loadProductFamilySeed(options.seedFolder),
            }),
      });
      return { files, delivery };
    } finally {
      closeConfiguredDatabase(lqDatabase);
    }
  } finally {
    closeConfiguredDatabase(rawDatabase);
  }
}

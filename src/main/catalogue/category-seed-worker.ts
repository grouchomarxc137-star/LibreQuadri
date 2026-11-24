import { parentPort, workerData } from "node:worker_threads";
import { openConfiguredDatabase, closeConfiguredDatabase } from "../database/sqlite-connection.js";
import { loadAttributeSeed } from "./attribute-seed.js";
import { loadCategorySeed } from "./category-seed.js";
import { loadProductFamilySeed, synchronizeProductFamilySeed } from "./family-seed.js";
import { loadCapacityKindSeed, loadSourceBrandMapSeed, synchronizeCapacityKindSeed, synchronizeSourceBrandMapSeed } from "./engineering-seed.js";
import { engineeringVocabularyWarnings, loadEngineeringVocabularySeed } from "./engineering-vocabulary.js";
import { synchronizeDerivedCatalogue } from "./derived-catalogue.js";
import { loadSiemensNavigationSeed } from "./siemens-navigation.js";

const { databaseFilename, seedFolder } = workerData as { databaseFilename: string; seedFolder: string };
const database = openConfiguredDatabase(databaseFilename, { kind: "lq", checkIntegrity: true });
try {
  // Categories first: attribute applicability follows each product's category.
  // Reference definitions and all three recomputation fingerprints commit together.
  const categorySeed = loadCategorySeed(seedFolder);
  const attributeSeed = loadAttributeSeed(seedFolder);
  const familySeed = loadProductFamilySeed(seedFolder);
  const capacitySeed = loadCapacityKindSeed(seedFolder);
  const sourceBrandSeed = loadSourceBrandMapSeed(seedFolder);
  const engineeringVocabulary = loadEngineeringVocabularySeed(seedFolder);
  const warnings = database.transaction(() => {
    synchronizeCapacityKindSeed(database, capacitySeed);
    synchronizeSourceBrandMapSeed(database, sourceBrandSeed);
    const vocabulary = synchronizeDerivedCatalogue(database, { categorySeed, attributeSeed, engineeringVocabulary,
      siemensNavigationSeed: loadSiemensNavigationSeed(seedFolder) });
    synchronizeProductFamilySeed(database, familySeed);
    return engineeringVocabularyWarnings(vocabulary);
  })();
  parentPort!.postMessage({ status: "ready", warnings });
} finally {
  closeConfiguredDatabase(database);
}

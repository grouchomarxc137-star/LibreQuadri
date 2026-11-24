import type Database from "better-sqlite3";
import { synchronizeEngineeringLinkPolicy } from "../sources/engineering-links.js";
import { synchronizeAttributeSeed, type AttributeSeed, type AttributeSynchronizationOptions } from "./attribute-seed.js";
import { synchronizeCategorySeed, type CategorySeed } from "./category-seed.js";
import { synchronizeEngineeringVocabulary, type EngineeringVocabularySeed } from "./engineering-vocabulary.js";
import { synchronizePackageOffers } from "./package-offers.js";
import { synchronizeSiemensNavigation, type SiemensNavigationSeed } from "./siemens-navigation.js";

/** Shared ordering for startup, engineering reimport and METEL normalization. Caller owns the outer transaction. */
export function synchronizeDerivedCatalogue(database: Database.Database, options: {
  categorySeed: CategorySeed; attributeSeed: AttributeSeed; engineeringVocabulary?: EngineeringVocabularySeed;
  affectedIds?: ReadonlySet<number>; attributeParsers?: AttributeSynchronizationOptions["parsers"];
  siemensNavigationSeed?: SiemensNavigationSeed;
}) {
  synchronizeEngineeringLinkPolicy(database);
  synchronizeCategorySeed(database, options.categorySeed, options.affectedIds, true);
  synchronizeAttributeSeed(database, options.attributeSeed, { referenceOnly: true });
  const vocabulary = synchronizeEngineeringVocabulary(database, options.engineeringVocabulary);
  synchronizeCategorySeed(database, options.categorySeed, options.affectedIds);
  synchronizeAttributeSeed(database, options.attributeSeed, {
    ...(options.affectedIds === undefined ? {} : { affectedIds: options.affectedIds }),
    ...(options.attributeParsers === undefined ? {} : { parsers: options.attributeParsers }),
  });
  synchronizePackageOffers(database);
  synchronizeSiemensNavigation(database, options.siemensNavigationSeed);
  return vocabulary;
}

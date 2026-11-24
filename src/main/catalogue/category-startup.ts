import { Worker } from "node:worker_threads";
import type { EngineeringVocabularyWarnings } from "./engineering-vocabulary.js";

/** Finish seed updates before exposing the catalogue; bulk work stays off main. */
export function initializeCategorySeed(databaseFilename: string, seedFolder: string): Promise<EngineeringVocabularyWarnings | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./category-seed-worker.js", import.meta.url), {
      workerData: { databaseFilename, seedFolder },
    });
    let ready = false;
    let warnings: EngineeringVocabularyWarnings | null = null;
    worker.on("message", message => {
      if (message?.status === "ready") { ready = true; warnings = message.warnings; }
    });
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code === 0 && ready) resolve(warnings);
      else reject(new Error(`Category seed worker did not complete (exit ${code})`));
    });
  });
}

import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { siemensCoverage, siemensCoverageMarkdown } from "../src/main/catalogue/siemens-coverage.js";

const [filename, output] = process.argv.slice(2);
if (!filename || !output) throw new Error("Usage: siemens-filter-coverage <enriched catalogue copy.db> <output.md>");
const db=new Database(filename,{readonly:true,fileMustExist:true});
try {writeFileSync(output,siemensCoverageMarkdown(siemensCoverage(db)));} finally {db.close();}

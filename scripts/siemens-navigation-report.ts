import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { siemensNavigationMarkdown, siemensNavigationReport } from "../src/main/catalogue/siemens-navigation-report.js";

const [filename, output] = process.argv.slice(2);
if (!filename || !output) throw new Error("Usage: siemens-navigation-report <classified catalogue copy.db> <output.md>");
const db = new Database(filename, { readonly: true, fileMustExist: true });
try { writeFileSync(output, siemensNavigationMarkdown(siemensNavigationReport(db))); } finally { db.close(); }

/* Developer command for the Revision-8 Sienergy master import. */
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { applicationPaths, resolveApplicationDataPath } from "../src/main/data-paths.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { importSienergy } from "../src/main/sources/sienergy/import.js";

const applicationRoot=path.resolve(import.meta.dirname,"..","..");
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  "drawings":{type:"string"},
  "data-dir":{type:"string"},
}});
if(positionals.length!==1){
  console.error("Usage: npm run import:sienergy -- [--data-dir <dir>] [--drawings <prepared folder>] <Siemens.bd>");
  process.exit(2);
}
const platform=process.platform;
const appData=platform==="darwin"?path.join(homedir(),"Library","Application Support")
  :platform==="win32"?(process.env["APPDATA"]??path.join(homedir(),"AppData","Roaming"))
    :(process.env["XDG_CONFIG_HOME"]??path.join(homedir(),".config"));
const root=values["data-dir"]?path.resolve(values["data-dir"]):resolveApplicationDataPath({
  platform,mode:"development",electronAppDataPath:appData,
  electronDefaultUserDataPath:path.join(appData,"LibreQuadri"),environment:process.env,
});
const paths=applicationPaths(root);
mkdirSync(paths.data,{recursive:true});
const database=openMigratedLqDatabase({databaseFilename:paths.lqDatabase,
  backupDirectory:paths.backups,migrationsFolder:path.join(applicationRoot,"db/migrations/lq")});
try{
  const result=await importSienergy({database,sourcePath:positionals[0]!,
    archiveDirectory:path.join(paths.imports,"sienergy"),backupDirectory:paths.backups,
    preparedDrawings:values.drawings,assetsRoot:paths.assets,
    seedFolder:path.join(applicationRoot,"db/seed")});
  console.log(JSON.stringify(result,null,2));
}finally{closeConfiguredDatabase(database);}

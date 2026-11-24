/* Developer command for the Revision-8 TiQuadri master import. */
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { applicationPaths, resolveApplicationDataPath } from "../src/main/data-paths.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { importTiQuadri } from "../src/main/sources/tiquadri/import.js";

const applicationRoot=path.resolve(import.meta.dirname,"..","..");
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  "data-dir":{type:"string"},
  "listino":{type:"string"},
}});
if(positionals.length!==1){
  console.error("Usage: npm run import:tiquadri -- [--data-dir <dir>] [--listino <ListinoBT.mdb>] <BTQUADRI.mdb>");
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
  const result=await importTiQuadri({database,sourcePath:positionals[0]!,
    ...(values["listino"]?{listinoPath:path.resolve(values["listino"])}:{}),
    archiveDirectory:path.join(paths.imports,"tiquadri"),backupDirectory:paths.backups,
    seedFolder:path.join(applicationRoot,"db/seed")});
  console.log(JSON.stringify(result,null,2));
}finally{closeConfiguredDatabase(database);}

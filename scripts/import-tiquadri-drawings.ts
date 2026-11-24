/** Local drawing import into the existing asset store. */
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { applicationPaths, resolveApplicationDataPath } from "../src/main/data-paths.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { importTiQuadriDrawingAssets } from "../src/main/sources/tiquadri/drawing-assets.js";

const {values,positionals}=parseArgs({allowPositionals:true,options:{"data-dir":{type:"string"}}});
if(positionals.length!==1){
  console.error("Usage: npm run import:tiquadri-drawings -- [--data-dir <dir>] <BTQuadriDXF.mdb>");
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
  backupDirectory:paths.backups,migrationsFolder:path.resolve(import.meta.dirname,"../../db/migrations/lq")});
try{
  mkdirSync(paths.backups,{recursive:true});
  await database.backup(path.join(paths.backups,`librequadri-pre-drawings-${Date.now()}.db`));
  console.log(JSON.stringify(importTiQuadriDrawingAssets({database,
    sourcePath:path.resolve(positionals[0]!),assetsRoot:paths.assets}),null,2));
}finally{closeConfiguredDatabase(database);}

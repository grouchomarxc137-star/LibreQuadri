import type {SienergyRecord} from "./reader.js";
/** IT2 is the qualified Siemens supplier namespace in this master, not part of the MLFB. */
export function sienergyArticleCode(record:SienergyRecord):string|null{
 if(!record.manufacturerCode)return null;
 const qualified=/^([A-Z0-9]+):(.+)$/.exec(record.identifier.toUpperCase());
 if(!qualified)return record.manufacturerCode.trim().toUpperCase();
 const [,supplier,code]=qualified;
 if(supplier!=="IT2"||!code||![code,supplier+code].includes(record.manufacturerCode.toUpperCase()))throw new Error(`Unmapped Sienergy supplier identity ${record.id}`);
 return code;
}

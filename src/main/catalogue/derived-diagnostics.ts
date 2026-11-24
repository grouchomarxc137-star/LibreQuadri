import type Database from "better-sqlite3";

export interface DerivedDiagnostic {
  readonly importId: number;
  readonly subjectKind: "article" | "model";
  readonly subjectKey: string;
  readonly topic: string;
  readonly valueA: string | null;
  readonly sourceA: string | null;
  readonly valueB: string | null;
  readonly sourceB: string | null;
  readonly notes: string | null;
}

const comparable = (row: DerivedDiagnostic): string => JSON.stringify([
  row.importId, row.subjectKind, row.subjectKey, row.topic, row.valueA,
  row.sourceA, row.valueB, row.sourceB, row.notes,
]);

/** Replace only engine-owned topics. Identical diagnostics retain their row IDs. */
export function reconcileDerivedDiagnostics(
  database: Database.Database,
  topics: readonly string[],
  desired: readonly DerivedDiagnostic[],
  subjects?: ReadonlySet<string>,
): void {
  if (!topics.length) return;
  const placeholders = topics.map(() => "?").join(",");
  const old = database.prepare(`SELECT import_id AS importId,subject_kind AS subjectKind,
    subject_key AS subjectKey,topic,value_a AS valueA,source_a AS sourceA,
    value_b AS valueB,source_b AS sourceB,notes,resolution
    FROM cat_source_conflict WHERE topic IN (${placeholders})
    ORDER BY subject_key,topic,id`).all(...topics) as Array<DerivedDiagnostic & {resolution:string}>;
  const scoped = old.filter(row => !subjects || subjects.has(row.subjectKey));
  const before = scoped.map(comparable).sort();
  const after = desired.map(comparable).sort();
  if (JSON.stringify(before) === JSON.stringify(after) && scoped.every(row => row.resolution === "unresolved")) return;
  const remove = database.prepare(`DELETE FROM cat_source_conflict WHERE topic IN (${placeholders})
    AND subject_key=?`);
  if (subjects) for (const subject of subjects) remove.run(...topics, subject);
  else database.prepare(`DELETE FROM cat_source_conflict WHERE topic IN (${placeholders})`).run(...topics);
  const insert = database.prepare(`INSERT INTO cat_source_conflict
    (import_id,subject_kind,subject_key,topic,value_a,source_a,value_b,source_b,notes)
    VALUES(@importId,@subjectKind,@subjectKey,@topic,@valueA,@sourceA,@valueB,@sourceB,@notes)`);
  for (const row of [...desired].sort((a,b) => comparable(a).localeCompare(comparable(b)))) insert.run(row);
}

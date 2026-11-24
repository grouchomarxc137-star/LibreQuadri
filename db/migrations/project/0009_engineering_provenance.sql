-- Portable historical engineering generation. Legacy rows stay unknown; no catalogue is read.
ALTER TABLE prj_item ADD COLUMN engineering_provenance TEXT;
--> statement-breakpoint
ALTER TABLE prj_item ADD COLUMN source_adapter_code TEXT;
--> statement-breakpoint
ALTER TABLE prj_item ADD COLUMN source_adapter_version TEXT;
--> statement-breakpoint
ALTER TABLE prj_item ADD COLUMN source_import_fingerprint TEXT CHECK (
  COALESCE(
    (engineering_provenance IS NULL AND source_adapter_code IS NULL AND source_adapter_version IS NULL AND source_import_fingerprint IS NULL)
    OR (engineering_provenance = 'manual' AND source_adapter_code IS NULL AND source_adapter_version IS NULL AND source_import_fingerprint IS NULL)
    OR (engineering_provenance = 'import' AND length(trim(source_adapter_code)) > 0
      AND source_adapter_version GLOB '[1-9]*' AND source_adapter_version NOT GLOB '*[^0-9]*'
      AND length(source_import_fingerprint) = 64 AND source_import_fingerprint NOT GLOB '*[^0-9a-f]*'), 0)
);

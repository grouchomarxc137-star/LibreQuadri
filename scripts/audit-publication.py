#!/usr/bin/env python3
"""Scan candidate source files without printing sensitive values.

The scan checks source content and the explicit synthetic fixture exception.
"""
from pathlib import Path
import hashlib
import json
import re
import sqlite3
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SYNTHETIC_PROJECT = 'test/fixtures/quotation-format1.lqp'
SECRETS = {
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'github-token': r'\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,})\b',
    'aws-access-key': r'\bAKIA[0-9A-Z]{16}\b',
    'api-token': r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}',
    'credential-assignment': r'(?i)\b(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*[\"\'][^\"\'\s]{12,}[\"\']',
    'credential-url': r'(?i)https?://[^\s/@:]+:[^\s/@]+@',
}
PERSONAL_PATH = re.compile(r'/Users/([^/\s`\"\']+)|/home/([^/\s`\"\']+)|[A-Z]:\\Users\\([^\\\s]+)')
PRIVATE_SUFFIXES = {'.db', '.sqlite', '.sqlite3', '.mdb', '.accdb', '.lqp', '.bd', '.qe',
                    '.dwg', '.dxf', '.lsp', '.fsc', '.fst', '.pdf', '.doc', '.docx',
                    '.xls', '.xlsx', '.zip', '.dmg', '.pem', '.key', '.p12', '.pfx'}
FORBIDDEN_PARTS = {'node_modules', 'build', 'out', 'dist', 'coverage', '.claude', '.codex',
                   '.worktrees', 'private-data', 'source-data', 'imports', 'backups'}


def main():
    names = subprocess.check_output(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT,
    ).decode().split('\0')
    names = sorted(set(name for name in names if name))
    findings = []
    inventory = []
    binary_count = 0

    def flag(name, rule, line=None):
        item = {'path': name, 'rule': rule}
        if line is not None:
            item['line'] = line
        findings.append(item)

    for name in names:
        path = ROOT / name
        if not path.exists():
            continue
        if path.is_symlink():
            flag(name, 'symlink-needs-review')
            continue
        data = path.read_bytes()
        inventory.append({'path': name, 'bytes': len(data),
                          'sha256': hashlib.sha256(data).hexdigest()})
        if set(Path(name).parts) & FORBIDDEN_PARTS:
            flag(name, 'excluded-directory')
        if path.name.startswith('.env') and path.name != '.env.example':
            flag(name, 'private-environment')
        if path.suffix.lower() in PRIVATE_SUFFIXES and name != SYNTHETIC_PROJECT:
            flag(name, 'private-or-generated-file-type')
        if re.search(r'(?i)(?:LSP|FSC|FST)[^/]*\.txt$', path.name):
            flag(name, 'raw-metel-delivery')
        if name == SYNTHETIC_PROJECT:
            binary_count += 1
            try:
                with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
                    assert db.execute('pragma integrity_check').fetchone() == ('ok',)
                    assert db.execute('select count(*) from prj_project').fetchone() == (1,)
                    row = db.execute('select executor,customer_name,customer_description,customer_vat,'
                                     'customer_address,customer_contacts,global_discount_bp from prj_project').fetchone()
                    assert row == ('Tecnico di esempio', 'Cliente di esempio', 'Sede di esempio', None, None, None, 0)
                    assert db.execute('select count(*) from prj_line').fetchone() == (1,)
                    assert db.execute("select value from lqp_meta where key='contains_costs'").fetchone() == ('0',)
                    strings = '\n'.join(db.iterdump())
                    for rule, pattern in SECRETS.items():
                        if re.search(pattern, strings):
                            flag(name, rule)
            except (sqlite3.Error, AssertionError):
                flag(name, 'synthetic-project-audit-failed')
            continue
        try:
            source = data.decode('utf-8')
        except UnicodeDecodeError:
            binary_count += 1
            flag(name, 'unexpected-binary-or-metadata-review')
            continue
        if '\x00' in source:
            flag(name, 'unexpected-binary-signature')
        for rule, pattern in SECRETS.items():
            for match in re.finditer(pattern, source):
                flag(name, rule, source.count('\n', 0, match.start()) + 1)
        for match in PERSONAL_PATH.finditer(source):
            if name == 'scripts/audit-publication.py':
                continue  # The scanner's own detection expressions.
            username = next(value for value in match.groups() if value is not None)
            if name.startswith('test/') and username in {'test', 'some', 'tecnico'}:
                continue
            flag(name, 'personal-absolute-path', source.count('\n', 0, match.start()) + 1)
    result = {'candidate_files': len(inventory), 'binary_files': binary_count,
              'technical_findings': findings,
              'audit_note': 'See docs/SOURCE_AUDIT.md for scan coverage and retained compatibility identifiers.',
              'inventory': inventory}
    if '--json' in sys.argv:
        print(json.dumps(result, indent=2))
    else:
        print(f"Scanned {len(inventory)} candidate files ({binary_count} audited binary fixture); {len(findings)} technical findings.")
        for item in findings:
            print(json.dumps(item))
        print(result['audit_note'])
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())

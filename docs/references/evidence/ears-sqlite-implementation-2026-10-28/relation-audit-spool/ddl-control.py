"""Execute the actual scratch DDL/lookup shape without loading the Node native addon."""
import re
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[5]
source = (root / 'packages/apack-ears/src/sqlite/audit.ts').read_text()
ddl = re.search(r'identities\.exec\(`([\s\S]*?)`\)', source).group(1)
db = sqlite3.connect(':memory:')
try:
    db.executescript(ddl)
    for i in range(512):
        db.execute('INSERT INTO identities VALUES (?,?,?,?,?,?)', ('edge', 'Row-a', 'Row-b', str(i), i, 'Relation-' + str(i)))
    sql = 'SELECT id FROM identities WHERE kind=? AND source=? AND target=? AND fingerprint=? ORDER BY position'
    parameters = ('edge', 'Row-a', 'Row-b', '17')
    assert db.execute(sql, parameters).fetchall() == [('Relation-17',)]
    plan = [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + sql, parameters)]
    assert any('SEARCH identities USING INDEX identity_lookup' in row for row in plan)
    print('Actual DDL and indexed candidate lookup pass Python SQLite', sqlite3.sqlite_version, plan)
finally:
    db.close()

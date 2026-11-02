import json, sqlite3, sys
request = json.load(sys.stdin)
db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row
try:
    if request['method'] == 'exec':
        db.executescript(request['sql'])
        value = None
    else:
        cursor = db.execute(request['sql'], request.get('parameters', []))
        if request['method'] == 'all':
            value = [dict(row) for row in cursor]
        else:
            row = cursor.fetchone()
            value = dict(row) if row is not None else None
    db.commit()
    json.dump(value, sys.stdout)
finally:
    db.close()

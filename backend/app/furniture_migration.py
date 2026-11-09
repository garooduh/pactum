"""Explicit additive furniture migrations v2/v3, applied before serving requests."""
from sqlalchemy import inspect, text, select, update
from .database import FurnitureList, FurnitureCatalog, FurnitureIssue, FurnitureCounter, SchemaVersion


def migrate(engine):
    for table in (FurnitureList.__table__, FurnitureCatalog.__table__, FurnitureIssue.__table__,
                  FurnitureCounter.__table__):
        table.create(engine, checkfirst=True)
    with engine.begin() as connection:
        # Serialize PostgreSQL startup migrations; SQLite startup has a single writer.
        if engine.dialect.name == 'postgresql':
            connection.execute(text("LOCK TABLE furniture_lists IN ACCESS EXCLUSIVE MODE"))
        columns = {c['name'] for c in inspect(connection).get_columns('furniture_lists')}
        if 'number' not in columns:
            connection.execute(text("ALTER TABLE furniture_lists ADD COLUMN number INTEGER"))
        if 'created_at' not in columns:
            connection.execute(text("ALTER TABLE furniture_lists ADD COLUMN created_at VARCHAR(40)"))
        table = FurnitureList.__table__
        rows = connection.execute(select(table)).mappings().all()
        counter = connection.execute(select(FurnitureCounter.value).where(FurnitureCounter.id == 1)).scalar_one_or_none()
        highest = max([counter or 0] + [r['number'] or 0 for r in rows])
        missing = sorted((r for r in rows if r['number'] is None),
                         key=lambda r: (r['data'].get('title', '').casefold().replace('ё', 'е'), r['id']))
        for row in missing:
            highest += 1
            connection.execute(update(table).where(table.c.id == row['id']).values(number=highest))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_furniture_lists_number ON furniture_lists (number)"))
        if counter is None:
            connection.execute(FurnitureCounter.__table__.insert().values(id=1, value=highest))
        else:
            connection.execute(update(FurnitureCounter).where(FurnitureCounter.id == 1).values(value=highest))
        for version in (2, 3):
            if not connection.execute(select(SchemaVersion.id).where(SchemaVersion.id == version)).first():
                connection.execute(SchemaVersion.__table__.insert().values(id=version))

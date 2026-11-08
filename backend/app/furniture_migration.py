"""Additive v2 migration; existing contract tables and JSON are untouched."""
from .database import FurnitureList, FurnitureCatalog, FurnitureIssue, SchemaVersion

def migrate(engine):
    # Explicitly enumerated additions; safe to repeat after a partial installation.
    for table in (FurnitureList.__table__, FurnitureCatalog.__table__, FurnitureIssue.__table__):
        table.create(engine, checkfirst=True)
    with engine.begin() as connection:
        exists=connection.execute(SchemaVersion.__table__.select().where(SchemaVersion.id==2)).first()
        if not exists: connection.execute(SchemaVersion.__table__.insert().values(id=2))

import os
from datetime import datetime, timezone
from sqlalchemy import create_engine, String, Integer, Text, JSON, Float
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

def now():
    return datetime.now(timezone.utc).isoformat()

class Base(DeclarativeBase):
    pass

class Account(Base):
    __tablename__ = 'accounts'
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)

class SessionToken(Base):
    __tablename__ = 'sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires: Mapped[float] = mapped_column(Float, index=True)

class LoginAttempt(Base):
    __tablename__ = 'login_attempts'
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[float] = mapped_column(Float, index=True)

class Supplier(Base):
    __tablename__ = 'supplier'
    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)

class Contract(Base):
    __tablename__ = 'contracts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    number: Mapped[str] = mapped_column(String(100), default='', index=True)
    customer: Mapped[str] = mapped_column(Text, default='')
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now, index=True)

class Issue(Base):
    __tablename__ = 'issues'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    contract_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(64), unique=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    template_version: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(30), default='generating')
    created_at: Mapped[str] = mapped_column(String(40), default=now)

class SchemaVersion(Base):
    __tablename__ = 'schema_version'
    id: Mapped[int] = mapped_column(primary_key=True)

def connect(url=None):
    url = url or os.environ['DATABASE_URL']
    engine = create_engine(url, pool_pre_ping=True, connect_args={'check_same_thread': False} if url.startswith('sqlite') else {})
    return engine, sessionmaker(engine, expire_on_commit=False)

"""
SQLAlchemy models for Job and Asset.
Tables are auto-created on startup via Base.metadata.create_all().
"""
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Integer,
    String,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


def _default_expires_at() -> datetime:
    """Default expires_at = now + 24 hours (Requirement 4.3)."""
    from datetime import timedelta
    return datetime.now(timezone.utc) + timedelta(hours=24)


class Job(Base):
    __tablename__ = "jobs"

    job_id = Column(String, primary_key=True, default=_uuid)
    type = Column(String, nullable=False)          # anime | simulation | model3d | story
    status = Column(String, nullable=False, default="queued")  # queued | processing | complete | failed
    topic = Column(String, nullable=False)
    parameters = Column(JSON, default=dict)
    asset_id = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)
    session_id = Column(String, nullable=False, default="")


class Asset(Base):
    __tablename__ = "assets"

    asset_id = Column(String, primary_key=True, default=_uuid)
    job_id = Column(String, nullable=False)
    type = Column(String, nullable=False)          # image | animation | simulation | model3d | story
    topic = Column(String, nullable=False)
    file_path = Column(String, nullable=False)     # R2 object key
    file_size_bytes = Column(Integer, default=0)
    mime_type = Column(String, nullable=False)
    asset_metadata = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=_now)
    expires_at = Column(DateTime(timezone=True), nullable=False, default=_default_expires_at)
    session_id = Column(String, nullable=False, default="")


class Webhook(Base):
    __tablename__ = "webhooks"

    webhook_id = Column(String, primary_key=True, default=_uuid)
    url = Column(String, nullable=False)
    session_id = Column(String, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), default=_now)


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

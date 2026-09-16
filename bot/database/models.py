from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, BigInteger, ForeignKey
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Group(Base):
    __tablename__ = 'groups'
    id = Column(BigInteger, primary_key=True)
    group_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Member(Base):
    __tablename__ = 'members'
    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(BigInteger, nullable=False)
    group_id = Column(BigInteger, ForeignKey('groups.id', ondelete='CASCADE'), nullable=False)
    name = Column(String, nullable=False)
    first_seen = Column(DateTime, default=datetime.utcnow)

class Expense(Base):
    __tablename__ = 'expenses'
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(BigInteger, ForeignKey('groups.id', ondelete='CASCADE'), nullable=False)
    payer_id = Column(BigInteger, nullable=False)
    payer_name = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False)
    description = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

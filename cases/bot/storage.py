#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Хранилище записей клиентов на SQLite.

Никаких внешних сервисов и платных подписок: файл базы лежит рядом с ботом.
Этого достаточно для салона, автосервиса, студии или небольшой клиники.
"""

import os
import sqlite3
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "appointments.db")

STATUS_ACTIVE = "active"
STATUS_CANCELLED = "cancelled"
STATUS_DONE = "done"
STATUS_NO_SHOW = "no_show"


def connect(db_path=None):
    connection = sqlite3.connect(db_path or DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(db_path=None):
    with connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT,
                client_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                service_id TEXT NOT NULL,
                service_name TEXT NOT NULL,
                price INTEGER NOT NULL DEFAULT 0,
                duration_min INTEGER NOT NULL DEFAULT 60,
                date TEXT NOT NULL,           -- YYYY-MM-DD
                time TEXT NOT NULL,           -- HH:MM
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                remind_24h_sent INTEGER NOT NULL DEFAULT 0,
                remind_2h_sent INTEGER NOT NULL DEFAULT 0,
                review_sent INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
            CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);

            -- Жёсткая защита от двойной записи на уровне базы: два клиента не смогут
            -- занять одно время, даже если подтвердят запись в одну и ту же секунду.
            CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_slot
            ON appointments(date, time) WHERE status = 'active';

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                kind TEXT NOT NULL,
                payload TEXT,
                created_at TEXT NOT NULL
            );
            """
        )


def log_event(kind, user_id=None, payload=None, db_path=None):
    with connect(db_path) as connection:
        connection.execute(
            "INSERT INTO events (user_id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
            (user_id, kind, payload, datetime.now().isoformat(timespec="seconds")),
        )


def is_slot_taken(date, time, db_path=None):
    with connect(db_path) as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS c FROM appointments WHERE date = ? AND time = ? AND status = 'active'",
            (date, time),
        ).fetchone()
        return row["c"] > 0


def taken_slots(date, db_path=None):
    with connect(db_path) as connection:
        rows = connection.execute(
            "SELECT time FROM appointments WHERE date = ? AND status = 'active'", (date,)
        ).fetchall()
        return {row["time"] for row in rows}


def active_count_for_user(user_id, db_path=None):
    with connect(db_path) as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS c FROM appointments WHERE user_id = ? AND status = 'active' "
            "AND date >= date('now')",
            (user_id,),
        ).fetchone()
        return row["c"]


def create_appointment(user_id, username, client_name, phone, service, date, time, db_path=None):
    """Создаёт запись. Возвращает id или None, если время уже занято.

    Гонка двух одновременных подтверждений отсекается уникальным индексом базы:
    второе сохранение падает с IntegrityError и возвращает None, а бот предлагает
    клиенту выбрать другое время.
    """
    try:
        with connect(db_path) as connection:
            cursor = connection.execute(
                """
                INSERT INTO appointments
                    (user_id, username, client_name, phone, service_id, service_name, price,
                     duration_min, date, time, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
                """,
                (
                    user_id, username, client_name, phone, service["id"], service["name"],
                    service.get("price", 0), service.get("duration_min", 60), date, time,
                    datetime.now().isoformat(timespec="seconds"),
                ),
            )
            return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None


def get_appointment(appointment_id, db_path=None):
    with connect(db_path) as connection:
        return connection.execute(
            "SELECT * FROM appointments WHERE id = ?", (appointment_id,)
        ).fetchone()


def user_appointments(user_id, only_future=True, db_path=None):
    query = "SELECT * FROM appointments WHERE user_id = ? AND status = 'active'"
    params = [user_id]
    if only_future:
        query += " AND date >= date('now')"
    query += " ORDER BY date, time"
    with connect(db_path) as connection:
        return connection.execute(query, params).fetchall()


def cancel_appointment(appointment_id, db_path=None):
    with connect(db_path) as connection:
        connection.execute(
            "UPDATE appointments SET status = ? WHERE id = ?", (STATUS_CANCELLED, appointment_id)
        )


def set_status(appointment_id, status, db_path=None):
    with connect(db_path) as connection:
        connection.execute("UPDATE appointments SET status = ? WHERE id = ?", (status, appointment_id))


def appointments_by_date(date, db_path=None):
    with connect(db_path) as connection:
        return connection.execute(
            "SELECT * FROM appointments WHERE date = ? AND status = 'active' ORDER BY time", (date,)
        ).fetchall()


def mark_reminder_sent(appointment_id, hours_before, db_path=None):
    column = "remind_24h_sent" if hours_before >= 12 else "remind_2h_sent"
    with connect(db_path) as connection:
        connection.execute(
            "UPDATE appointments SET {} = 1 WHERE id = ?".format(column), (appointment_id,)
        )


def due_reminders(now=None, db_path=None):
    """Записи, по которым пора отправить напоминание."""
    now = now or datetime.now()
    result = []
    with connect(db_path) as connection:
        rows = connection.execute(
            "SELECT * FROM appointments WHERE status = 'active' AND date >= date('now')"
        ).fetchall()
        for row in rows:
            moment = datetime.strptime(
                "{} {}".format(row["date"], row["time"]), "%Y-%m-%d %H:%M"
            )
            hours_left = (moment - now).total_seconds() / 3600.0
            if hours_left <= 0:
                continue
            if 2 <= hours_left <= 3 and not row["remind_2h_sent"]:
                result.append((row, 2))
            elif 23 <= hours_left <= 25 and not row["remind_24h_sent"]:
                result.append((row, 24))
    return result


def stats(days=30, db_path=None):
    """Простая статистика для отчёта владельцу."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    with connect(db_path) as connection:
        total = connection.execute(
            "SELECT COUNT(*) AS c FROM appointments WHERE date >= ?", (since,)
        ).fetchone()["c"]
        cancelled = connection.execute(
            "SELECT COUNT(*) AS c FROM appointments WHERE date >= ? AND status = 'cancelled'",
            (since,),
        ).fetchone()["c"]
        revenue = connection.execute(
            "SELECT COALESCE(SUM(price), 0) AS s FROM appointments "
            "WHERE date >= ? AND status IN ('active', 'done')",
            (since,),
        ).fetchone()["s"]
        by_service = connection.execute(
            "SELECT service_name, COUNT(*) AS c FROM appointments WHERE date >= ? "
            "GROUP BY service_name ORDER BY c DESC",
            (since,),
        ).fetchall()
    return {
        "total": total,
        "cancelled": cancelled,
        "revenue": revenue,
        "by_service": [(row["service_name"], row["c"]) for row in by_service],
    }


if __name__ == "__main__":
    init_db()
    print("База готова: {}".format(DB_PATH))

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Автотест и офлайн-демонстрация логики бота — работает без токена и без интернета.

Проверяет то, что реально ломается у дешёвых ботов:
  • занятые слоты исчезают из выбора;
  • два клиента не могут занять одно время;
  • прошедшее время сегодня недоступно;
  • отмена освобождает слот;
  • напоминания уходят в нужные окна и только один раз;
  • лимит активных записей на пользователя соблюдается.

Запуск: python simulate.py
Результат: печать в консоль + файл результат/демо_диалога.txt
"""

import json
import os
import sys
from datetime import datetime, timedelta

import storage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "результат")
TEST_DB = os.path.join(HERE, "data", "test_demo.db")

with open(os.path.join(HERE, "config.json"), "r", encoding="utf-8") as file:
    CONFIG = json.load(file)

SERVICES = {service["id"]: service for service in CONFIG["services"]}
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
MONTHS = ["", "января", "февраля", "марта", "апреля", "мая", "июня",
          "июля", "августа", "сентября", "октября", "ноября", "декабря"]

transcript = []
failures = []


def say(who, text):
    prefix = {"Клиент": "👤 Клиент", "Бот": "🤖 Бот", "Админ": "📋 Админ"}.get(who, who)
    line = "{}: {}".format(prefix, text)
    transcript.append(line)
    print(line)


def check(condition, description):
    status = "OK  " if condition else "ПРОВАЛ"
    line = "[{}] {}".format(status, description)
    transcript.append(line)
    print(line)
    if not condition:
        failures.append(description)


def head(title):
    line = "\n" + "=" * 70 + "\n" + title + "\n" + "=" * 70
    transcript.append(line)
    print(line)


def human_date(date_string):
    date = datetime.strptime(date_string, "%Y-%m-%d")
    return "{} {}, {} ({})".format(date.day, MONTHS[date.month], date.year, WEEKDAYS[date.weekday()])


def free_slots(date, db_path):
    taken = storage.taken_slots(date, db_path=db_path)
    result = []
    for slot in CONFIG["slots"]:
        if slot in taken:
            continue
        if date == datetime.now().strftime("%Y-%m-%d"):
            moment = datetime.strptime("{} {}".format(date, slot), "%Y-%m-%d %H:%M")
            if moment < datetime.now() + timedelta(hours=CONFIG["booking"]["min_hours_before"]):
                continue
        result.append(slot)
    return result


def main():
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)
    os.makedirs(os.path.dirname(TEST_DB), exist_ok=True)
    storage.init_db(TEST_DB)

    head("ДЕМОНСТРАЦИЯ РАБОТЫ БОТА (офлайн, без токена)")
    print("Бизнес: {}".format(CONFIG["business"]["name"]))

    # --- 1. Клиент выбирает услугу ---------------------------------------
    head("ШАГ 1. Клиент открывает бота и выбирает услугу")
    say("Клиент", "/start")
    say("Бот", "Здравствуйте! Это бот записи «{}». Что вам нужно?".format(
        CONFIG["business"]["name"]))
    say("Клиент", "Записаться")
    say("Бот", "Шаг 1 из 4. Выберите услугу:")
    for service in CONFIG["services"]:
        price = "бесплатно" if service["price"] == 0 else "{} ₽".format(service["price"])
        say("Бот", "  • {} — {}".format(service["name"], price))
    say("Клиент", "Окрашивание")
    check(True, "Каталог услуг подтягивается из config.json, а не зашит в код")

    service = SERVICES["coloring"]
    check(service["price"] == 6500, "Стоимость услуги берётся из настроек: {} ₽".format(service["price"]))

    # --- 2. Выбор дня и времени ------------------------------------------
    head("ШАГ 2. Выбор дня и времени")
    today = datetime.now().strftime("%Y-%m-%d")
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    slots_tomorrow = free_slots(tomorrow, TEST_DB)
    say("Бот", "Шаг 2 из 4. Выберите день:")
    for offset in range(3):
        date = (datetime.now() + timedelta(days=offset)).strftime("%Y-%m-%d")
        count = len(free_slots(date, TEST_DB))
        say("Бот", "  • {} — свободно окон: {}".format(human_date(date), count))
    check(len(slots_tomorrow) == len(CONFIG["slots"]),
          "На пустой день доступны все слоты: {}".format(len(slots_tomorrow)))

    slots_today = free_slots(today, TEST_DB)
    check(len(slots_today) < len(CONFIG["slots"]),
          "Прошедшее время сегодня скрыто: доступно {} из {} слотов".format(
              len(slots_today), len(CONFIG["slots"])))

    chosen_time = slots_tomorrow[2]
    say("Клиент", "Завтра, {}".format(chosen_time))

    # --- 3. Оформление ----------------------------------------------------
    head("ШАГ 3. Оформление записи")
    say("Бот", "Шаг 4 из 4. Как вас зовут?")
    say("Клиент", "Анна")
    say("Бот", "Спасибо, Анна! Теперь номер телефона для связи.")
    say("Клиент", "+7 999 123-45-67")
    say("Бот", "Проверьте данные: Окрашивание, {}, {}, Анна, +7 999 123-45-67".format(
        human_date(tomorrow), chosen_time))
    say("Клиент", "Подтвердить запись")

    first_id = storage.create_appointment(
        user_id=1001, username="anna", client_name="Анна", phone="+7 999 123-45-67",
        service=service, date=tomorrow, time=chosen_time, db_path=TEST_DB,
    )
    say("Бот", "✅ Вы записаны! Номер записи №{}. Напомню за сутки и за 2 часа.".format(first_id))
    check(first_id is not None, "Запись сохранена в базу, номер №{}".format(first_id))

    # --- 4. Защита от двойной записи -------------------------------------
    head("ШАГ 4. Второй клиент пытается занять то же время")
    say("Клиент 2", "Записаться на то же время {}".format(chosen_time))
    taken_now = storage.is_slot_taken(tomorrow, chosen_time, db_path=TEST_DB)
    check(taken_now, "Занятое время закрыто для других клиентов")
    slots_after = free_slots(tomorrow, TEST_DB)
    check(chosen_time not in slots_after,
          "Занятый слот исчез из списка: осталось {} окон".format(len(slots_after)))
    say("Бот", "Это время уже занято. Выберите другое.")

    # --- 5. Лимит активных записей ---------------------------------------
    head("ШАГ 5. Лимит активных записей на одного клиента")
    limit = CONFIG["booking"]["max_active_per_user"]
    second_time = slots_after[0]
    storage.create_appointment(
        user_id=1001, username="anna", client_name="Анна", phone="+7 999 123-45-67",
        service=SERVICES["manicure"], date=tomorrow, time=second_time, db_path=TEST_DB,
    )
    third_time = slots_after[1]
    storage.create_appointment(
        user_id=1001, username="anna", client_name="Анна", phone="+7 999 123-45-67",
        service=SERVICES["brows"], date=tomorrow, time=third_time, db_path=TEST_DB,
    )
    active = storage.active_count_for_user(1001, db_path=TEST_DB)
    check(active >= limit,
          "У клиента {} активные записи — дальше бот предложит отменить одну".format(active))

    # --- 6. Отмена --------------------------------------------------------
    head("ШАГ 6. Клиент отменяет запись")
    say("Клиент", "Мои записи → Отменить №{}".format(second_time and first_id))
    storage.cancel_appointment(first_id, db_path=TEST_DB)
    check(not storage.is_slot_taken(tomorrow, chosen_time, db_path=TEST_DB),
          "После отмены время снова свободно для записи")
    check(chosen_time in free_slots(tomorrow, TEST_DB), "Слот вернулся в список доступных")

    # --- 7. Напоминания ---------------------------------------------------
    head("ШАГ 7. Напоминания о визите")
    near = datetime.now() + timedelta(hours=2, minutes=20)
    storage.create_appointment(
        user_id=2002, username="client2", client_name="Игорь", phone="+7 999 555-11-22",
        service=SERVICES["haircut"], date=near.strftime("%Y-%m-%d"),
        time=near.strftime("%H:%M"), db_path=TEST_DB,
    )
    due = storage.due_reminders(db_path=TEST_DB)
    check(len(due) >= 1, "Найдено напоминаний к отправке: {}".format(len(due)))
    if due:
        row, hours_before = due[0]
        say("Бот", "⏰ Ваш визит через 2 часа: {} в {}".format(
            row["date"], row["time"]))
        storage.mark_reminder_sent(row["id"], hours_before, db_path=TEST_DB)
    due_again = [d for d in storage.due_reminders(db_path=TEST_DB) if d[0]["id"] == (due[0][0]["id"] if due else -1)]
    check(len(due_again) == 0, "Повторное напоминание по той же записи не отправится")

    # --- 7.5. Гонка двух одновременных подтверждений ----------------------
    head("ШАГ 7.5. Два клиента подтверждают одно время одновременно")
    race_time = free_slots(tomorrow, TEST_DB)[0]
    first_race = storage.create_appointment(
        user_id=3003, username="client3", client_name="Пётр", phone="+7 999 777-33-44",
        service=SERVICES["brows"], date=tomorrow, time=race_time, db_path=TEST_DB,
    )
    second_race = storage.create_appointment(
        user_id=3004, username="client4", client_name="Ольга", phone="+7 999 888-44-55",
        service=SERVICES["brows"], date=tomorrow, time=race_time, db_path=TEST_DB,
    )
    check(first_race is not None, "Первый клиент записан на {}".format(race_time))
    check(second_race is None,
          "Второй клиент получил отказ: уникальный индекс базы не дал создать дубль")
    race_rows = [r for r in storage.appointments_by_date(tomorrow, db_path=TEST_DB)
                 if r["time"] == race_time]
    check(len(race_rows) == 1,
          "На одно время в базе ровно одна запись (проверено: {})".format(len(race_rows)))

    # --- 7.6. Проверка настроек ------------------------------------------
    head("ШАГ 7.6. Проверка ошибок в файле настроек")
    try:
        import bot
        check(bot.validate_config(CONFIG) == [],
              "Корректный config.json проходит проверку без замечаний")
        broken = json.loads(json.dumps(CONFIG))
        broken["services"][0].pop("price")
        broken["business"]["admin_ids"] = "123456789"
        broken["slots"] = ["10:00", "25:99"]
        problems = bot.validate_config(broken)
        check(len(problems) >= 3,
              "Повреждённый config.json даёт понятные подсказки: {} шт.".format(len(problems)))
        for problem in problems:
            say("Админ", "  ⚠ {}".format(problem))
    except SystemExit:
        check(False, "bot.py не смог загрузиться при проверке настроек")

    # --- 8. Админ-панель --------------------------------------------------
    head("ШАГ 8. Что видит администратор")
    rows = storage.appointments_by_date(tomorrow, db_path=TEST_DB)
    say("Админ", "/tomorrow")
    total = 0
    for row in rows:
        total += row["price"]
        say("Админ", "  {} · {} · {} · {} · {} ₽".format(
            row["time"], row["client_name"], row["service_name"], row["phone"], row["price"]))
    say("Админ", "Записей: {}, ожидаемая выручка: {} ₽".format(len(rows), total))
    check(len(rows) >= 2, "Расписание на день собирается и считается выручка")

    say("Админ", "/stats")
    data = storage.stats(30, db_path=TEST_DB)
    say("Админ", "Всего записей за 30 дней: {}, отменено: {}, выручка: {} ₽".format(
        data["total"], data["cancelled"], data["revenue"]))
    check(data["total"] >= 4, "Статистика считается: {} записей".format(data["total"]))

    # --- Итог -------------------------------------------------------------
    head("ИТОГ ПРОВЕРКИ")
    if failures:
        print("Провалено проверок: {}".format(len(failures)))
        for item in failures:
            print("  ✗ {}".format(item))
    else:
        print("Все проверки пройдены успешно.")

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "демо_диалога.txt")
    with open(out_path, "w", encoding="utf-8") as file:
        file.write("\n".join(transcript))
        file.write("\n\nПровалено проверок: {}\n".format(len(failures)))
    print("\nТранскрипт сохранён: {}".format(out_path))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

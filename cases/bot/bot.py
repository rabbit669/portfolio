#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Телеграм-бот «Администратор» для салона, студии или сервиса.

Что делает:
  • запись клиента в 3 нажатия: услуга → дата → время;
  • показывает только свободные слоты, занятые скрывает;
  • хранит записи в SQLite, без платных сервисов;
  • напоминает клиенту за 24 часа и за 2 часа до визита;
  • после визита просит отзыв со ссылками на Яндекс.Карты и 2ГИС;
  • даёт владельцу команды: записи на сегодня/завтра, статистика, отмена.

Запуск:
    export BOT_TOKEN="токен от @BotFather"
    python bot.py
"""

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder

import storage

HERE = os.path.dirname(os.path.abspath(__file__))
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
MONTHS = ["", "января", "февраля", "марта", "апреля", "мая", "июня",
          "июля", "августа", "сентября", "октября", "ноября", "декабря"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("bot")


def load_config(path=None):
    with open(path or os.path.join(HERE, "config.json"), "r", encoding="utf-8") as file:
        return json.load(file)


def validate_config(config):
    """Проверяет настройки и объясняет понятным языком, что исправить.

    Владелец правит config.json сам, поэтому опечатка в нём не должна приводить
    к непонятной ошибке в консоли.
    """
    errors = []
    business = config.get("business") or {}
    if not business.get("name"):
        errors.append("business.name — не указано название бизнеса")
    if not business.get("address"):
        errors.append("business.address — не указан адрес")
    if not business.get("work_hours"):
        errors.append("business.work_hours — не указаны часы работы")
    if not isinstance(business.get("admin_ids"), list) or not business["admin_ids"]:
        errors.append(
            "business.admin_ids — нужен список Telegram ID владельца, "
            "узнать свой ID можно командой /myid"
        )
    elif any(not isinstance(item, int) for item in business["admin_ids"]):
        errors.append("business.admin_ids — ID должны быть числами, без кавычек")

    services = config.get("services")
    if not services:
        errors.append("services — список услуг пуст, клиенту нечего выбрать")
    else:
        for index, service in enumerate(services, start=1):
            for field in ("id", "name", "price", "duration_min"):
                if field not in service:
                    errors.append("services[{}] — нет поля '{}'".format(index, field))
            if service.get("price") is not None and not isinstance(service["price"], (int, float)):
                errors.append("services[{}].price — цена должна быть числом".format(index))

    slots = config.get("slots")
    if not slots:
        errors.append("slots — не задана сетка времени (например [\"10:00\", \"11:00\"])")
    else:
        invalid = [
            slot for slot in slots
            if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", str(slot))
        ]
        if invalid:
            errors.append("slots — неверный формат времени: {}".format(", ".join(map(str, invalid))))

    booking = config.get("booking") or {}
    for field, description in (
        ("days_ahead", "на сколько дней вперёд открыта запись"),
        ("min_hours_before", "за сколько часов до визита закрывается запись"),
        ("max_active_per_user", "лимит активных записей на клиента"),
    ):
        if not isinstance(booking.get(field), int):
            errors.append("booking.{} — {}".format(field, description))

    if not config.get("faq"):
        errors.append("faq — раздел «Частые вопросы» пуст (это не критично, но клиенты его спрашивают)")
    return errors


try:
    CONFIG = load_config()
except FileNotFoundError:
    print("Не найден файл config.json рядом с ботом.", file=sys.stderr)
    sys.exit(1)
except ValueError as error:
    print("Файл config.json повреждён (неверный JSON): {}".format(error), file=sys.stderr)
    sys.exit(1)

CONFIG_ERRORS = validate_config(CONFIG)
if CONFIG_ERRORS:
    print("В файле config.json есть ошибки, исправьте их и запустите снова:", file=sys.stderr)
    for problem in CONFIG_ERRORS:
        print("  • {}".format(problem), file=sys.stderr)
    sys.exit(1)

BUSINESS = CONFIG["business"]
SERVICES = {service["id"]: service for service in CONFIG["services"]}
FAQ = CONFIG["faq"]

router = Router()


class Booking(StatesGroup):
    service = State()
    date = State()
    time = State()
    name = State()
    phone = State()
    confirm = State()


# --------------------------------------------------------------------------- утилиты

def human_date(date_string):
    date = datetime.strptime(date_string, "%Y-%m-%d")
    return "{} {}, {} ({})".format(
        date.day, MONTHS[date.month], date.year, WEEKDAYS[date.weekday()]
    )


def short_date(date_string):
    date = datetime.strptime(date_string, "%Y-%m-%d")
    return "{:02d}.{:02d} {}".format(date.day, date.month, WEEKDAYS[date.weekday()])


def available_dates():
    today = datetime.now()
    days = CONFIG["booking"]["days_ahead"]
    return [(today + timedelta(days=offset)).strftime("%Y-%m-%d") for offset in range(0, days)]


def free_slots(date):
    taken = storage.taken_slots(date)
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


def main_menu(user_id):
    builder = InlineKeyboardBuilder()
    builder.button(text="📅 Записаться", callback_data="book")
    builder.button(text="🗂 Мои записи", callback_data="my")
    builder.button(text="💰 Цены и услуги", callback_data="prices")
    builder.button(text="📍 Адрес и часы работы", callback_data="contacts")
    builder.button(text="❓ Частые вопросы", callback_data="faq")
    builder.adjust(1, 1, 1, 1, 1)
    return builder.as_markup()


def greeting():
    return (
        "Здравствуйте! Это бот записи <b>{}</b>.\n\n"
        "Здесь можно записаться за минуту, посмотреть свои визиты и узнать цены. "
        "Администратор получит вашу заявку сразу.\n\n"
        "Что вам нужно?"
    ).format(BUSINESS["name"])


# --------------------------------------------------------------------------- клиентские хендлеры

@router.message(CommandStart())
async def start(message: Message, state: FSMContext):
    await state.clear()
    storage.log_event("start", message.from_user.id)
    await message.answer(greeting(), reply_markup=main_menu(message.from_user.id))


@router.callback_query(F.data == "menu")
async def back_to_menu(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text(greeting(), reply_markup=main_menu(callback.from_user.id))
    await callback.answer()


@router.callback_query(F.data == "prices")
async def prices(callback: CallbackQuery):
    lines = ["<b>Услуги и цены</b>\n"]
    for service in CONFIG["services"]:
        price = "бесплатно" if service["price"] == 0 else "{} ₽".format(service["price"])
        lines.append("• {} — {} ({} мин)".format(service["name"], price, service["duration_min"]))
    lines.append("\n<i>{}</i>".format(CONFIG["booking"]["policy"]))
    builder = InlineKeyboardBuilder()
    builder.button(text="📅 Записаться", callback_data="book")
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await callback.message.edit_text("\n".join(lines), reply_markup=builder.as_markup())
    await callback.answer()


@router.callback_query(F.data == "contacts")
async def contacts(callback: CallbackQuery):
    text = (
        "<b>Как нас найти</b>\n\n"
        "🏠 {}\n🕒 {}\n📞 {}\n\n"
        "<i>{}</i>"
    ).format(BUSINESS["address"], BUSINESS["work_hours"], BUSINESS["phone"],
             CONFIG["booking"]["policy"])
    builder = InlineKeyboardBuilder()
    builder.button(text="📅 Записаться", callback_data="book")
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await callback.message.edit_text(text, reply_markup=builder.as_markup())
    await callback.answer()


@router.callback_query(F.data == "faq")
async def faq_list(callback: CallbackQuery):
    builder = InlineKeyboardBuilder()
    for index, item in enumerate(FAQ):
        builder.button(text=item["q"], callback_data="faq:{}".format(index))
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await callback.message.edit_text(
        "<b>Частые вопросы</b>\nВыберите вопрос:", reply_markup=builder.as_markup()
    )
    await callback.answer()


@router.callback_query(F.data.startswith("faq:"))
async def faq_answer(callback: CallbackQuery):
    index = int(callback.data.split(":")[1])
    item = FAQ[index]
    builder = InlineKeyboardBuilder()
    builder.button(text="← К вопросам", callback_data="faq")
    builder.button(text="📅 Записаться", callback_data="book")
    builder.adjust(1)
    await callback.message.edit_text(
        "<b>{}</b>\n\n{}".format(item["q"], item["a"]), reply_markup=builder.as_markup()
    )
    await callback.answer()


# --------------------------------------------------------------------------- запись

@router.callback_query(F.data == "book")
async def booking_start(callback: CallbackQuery, state: FSMContext):
    if storage.active_count_for_user(callback.from_user.id) >= CONFIG["booking"]["max_active_per_user"]:
        builder = InlineKeyboardBuilder()
        builder.button(text="🗂 Мои записи", callback_data="my")
        builder.button(text="← В меню", callback_data="menu")
        builder.adjust(1)
        await callback.message.edit_text(
            "У вас уже {} активные записи — это максимум. "
            "Отмените одну из них, чтобы записаться снова.".format(
                CONFIG["booking"]["max_active_per_user"]
            ),
            reply_markup=builder.as_markup(),
        )
        await callback.answer()
        return

    builder = InlineKeyboardBuilder()
    for service in CONFIG["services"]:
        price = "бесплатно" if service["price"] == 0 else "{} ₽".format(service["price"])
        builder.button(
            text="{} — {}".format(service["name"], price), callback_data="svc:{}".format(service["id"])
        )
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await state.set_state(Booking.service)
    await callback.message.edit_text(
        "<b>Шаг 1 из 4. Выберите услугу</b>", reply_markup=builder.as_markup()
    )
    await callback.answer()


@router.callback_query(Booking.service, F.data.startswith("svc:"))
async def booking_service(callback: CallbackQuery, state: FSMContext):
    service = SERVICES[callback.data.split(":", 1)[1]]
    await state.update_data(service_id=service["id"])
    builder = InlineKeyboardBuilder()
    for date in available_dates()[:10]:
        count = len(free_slots(date))
        if count == 0:
            continue
        builder.button(text="{} ({})".format(short_date(date), count), callback_data="date:{}".format(date))
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(3)
    await state.set_state(Booking.date)
    await callback.message.edit_text(
        "<b>Шаг 2 из 4. Выберите день</b>\n\nВ скобках — сколько свободных окон.",
        reply_markup=builder.as_markup(),
    )
    await callback.answer()


@router.callback_query(Booking.date, F.data.startswith("date:"))
async def booking_date(callback: CallbackQuery, state: FSMContext):
    date = callback.data.split(":", 1)[1]
    await state.update_data(date=date)
    slots = free_slots(date)
    builder = InlineKeyboardBuilder()
    for slot in slots:
        builder.button(text=slot, callback_data="time:{}".format(slot))
    builder.button(text="← Выбрать другой день", callback_data="back_to_dates")
    builder.adjust(4)
    await state.set_state(Booking.time)
    await callback.message.edit_text(
        "<b>Шаг 3 из 4. Выберите время</b>\n\n{}".format(human_date(date)),
        reply_markup=builder.as_markup(),
    )
    await callback.answer()


@router.callback_query(F.data == "back_to_dates")
async def back_to_dates(callback: CallbackQuery, state: FSMContext):
    builder = InlineKeyboardBuilder()
    for date in available_dates()[:10]:
        if not free_slots(date):
            continue
        builder.button(text=short_date(date), callback_data="date:{}".format(date))
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(3)
    await state.set_state(Booking.date)
    await callback.message.edit_text(
        "<b>Шаг 2 из 4. Выберите день</b>", reply_markup=builder.as_markup()
    )
    await callback.answer()


@router.callback_query(Booking.time, F.data.startswith("time:"))
async def booking_time(callback: CallbackQuery, state: FSMContext):
    slot = callback.data.split(":", 1)[1]
    data = await state.get_data()
    if storage.is_slot_taken(data["date"], slot):
        await callback.answer("Это время только что заняли. Выберите другое.", show_alert=True)
        await booking_date(callback, state)
        return
    await state.update_data(time=slot)
    await state.set_state(Booking.name)
    await callback.message.edit_text(
        "<b>Шаг 4 из 4. Как вас зовут?</b>\n\nНапишите имя, чтобы мастер знал, к кому обращаться."
    )
    await callback.answer()


@router.message(Booking.name)
async def booking_name(message: Message, state: FSMContext):
    name = (message.text or "").strip()
    if len(name) < 2 or len(name) > 60:
        await message.answer("Пожалуйста, напишите имя (от 2 до 60 символов).")
        return
    await state.update_data(name=name)
    await state.set_state(Booking.phone)
    await message.answer(
        "Спасибо, {}! Теперь номер телефона для связи.\n\n"
        "Можно написать вручную или отправить свой номер кнопкой.".format(name),
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="📱 Отправить мой номер", callback_data="share_phone")]]
        ),
    )


@router.callback_query(Booking.phone, F.data == "share_phone")
async def booking_phone_button(callback: CallbackQuery, state: FSMContext):
    await callback.message.answer(
        "Кнопка передачи номера работает в мобильном приложении. "
        "Напишите номер текстом, например: +7 999 123-45-67"
    )
    await callback.answer()


@router.message(Booking.phone)
async def booking_phone(message: Message, state: FSMContext):
    phone = (message.text or "").strip()
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 10:
        await message.answer("Не похоже на номер. Напишите в формате +7 999 123-45-67")
        return
    await state.update_data(phone=phone)

    data = await state.get_data()
    service = SERVICES[data["service_id"]]
    price = "бесплатно" if service["price"] == 0 else "{} ₽".format(service["price"])
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Подтвердить запись", callback_data="confirm")
    builder.button(text="✏️ Изменить данные", callback_data="book")
    builder.adjust(1)
    await state.set_state(Booking.confirm)
    await message.answer(
        "<b>Проверьте данные записи</b>\n\n"
        "Услуга: <b>{}</b> ({})\n"
        "Дата: <b>{}</b>\n"
        "Время: <b>{}</b>\n"
        "Имя: {}\n"
        "Телефон: {}\n\n"
        "<i>{}</i>".format(
            service["name"], price, human_date(data["date"]), data["time"],
            data["name"], data["phone"], CONFIG["booking"]["policy"],
        ),
        reply_markup=builder.as_markup(),
    )


@router.callback_query(Booking.confirm, F.data == "confirm")
async def booking_confirm(callback: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    if storage.is_slot_taken(data["date"], data["time"]):
        await callback.answer("Это время уже занято. Выберите другое.", show_alert=True)
        await state.clear()
        await book_again(callback)
        return

    service = SERVICES[data["service_id"]]
    appointment_id = storage.create_appointment(
        user_id=callback.from_user.id,
        username=callback.from_user.username,
        client_name=data["name"],
        phone=data["phone"],
        service=service,
        date=data["date"],
        time=data["time"],
    )

    # Время мог занять другой клиент за те секунды, пока заполнялась форма.
    # Уникальный индекс базы не даст создать дубль, поэтому проверяем результат.
    if appointment_id is None:
        await callback.answer(
            "Это время только что заняли. Пожалуйста, выберите другое.", show_alert=True
        )
        await state.clear()
        await book_again(callback)
        return

    storage.log_event("booking_created", callback.from_user.id, str(appointment_id))

    builder = InlineKeyboardBuilder()
    builder.button(text="🗂 Мои записи", callback_data="my")
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await state.clear()
    await callback.message.edit_text(
        "✅ <b>Вы записаны!</b>\n\n"
        "Номер записи: <b>№{}</b>\n"
        "Услуга: {}\n"
        "Дата и время: <b>{}, {}</b>\n\n"
        "Я напомню вам за сутки и за 2 часа до визита. "
        "Если планы изменятся, отменить запись можно здесь же, в разделе «Мои записи».".format(
            appointment_id, service["name"], human_date(data["date"]), data["time"]
        ),
        reply_markup=builder.as_markup(),
    )
    await notify_admin(callback.bot, appointment_id)
    await callback.answer("Запись создана")


async def book_again(callback: CallbackQuery):
    builder = InlineKeyboardBuilder()
    builder.button(text="📅 Записаться снова", callback_data="book")
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await callback.message.answer("Выберите действие:", reply_markup=builder.as_markup())


@router.callback_query(F.data == "my")
async def my_appointments(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    rows = storage.user_appointments(callback.from_user.id)
    if not rows:
        builder = InlineKeyboardBuilder()
        builder.button(text="📅 Записаться", callback_data="book")
        builder.button(text="← В меню", callback_data="menu")
        builder.adjust(1)
        await callback.message.edit_text(
            "У вас пока нет активных записей.", reply_markup=builder.as_markup()
        )
        await callback.answer()
        return

    builder = InlineKeyboardBuilder()
    lines = ["<b>Ваши записи</b>\n"]
    for row in rows:
        service = SERVICES.get(row["service_id"], {})
        price = service.get("price", row["price"])
        lines.append(
            "№{} · {} · <b>{} в {}</b>\n     {}".format(
                row["id"], row["service_name"], human_date(row["date"]), row["time"],
                "бесплатно" if price == 0 else "{} ₽".format(price),
            )
        )
        builder.button(text="❌ Отменить №{}".format(row["id"]), callback_data="cancel:{}".format(row["id"]))
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await callback.message.edit_text("\n".join(lines), reply_markup=builder.as_markup())
    await callback.answer()


@router.callback_query(F.data.startswith("cancel:"))
async def cancel(callback: CallbackQuery):
    appointment_id = int(callback.data.split(":")[1])
    row = storage.get_appointment(appointment_id)
    if row is None or row["user_id"] != callback.from_user.id:
        await callback.answer("Запись не найдена", show_alert=True)
        return
    storage.cancel_appointment(appointment_id)
    storage.log_event("booking_cancelled", callback.from_user.id, str(appointment_id))
    await notify_admin(callback.bot, appointment_id, cancelled=True)
    builder = InlineKeyboardBuilder()
    builder.button(text="📅 Записаться заново", callback_data="book")
    builder.button(text="← В меню", callback_data="menu")
    builder.adjust(1)
    await callback.message.edit_text(
        "Запись №{} отменена. Будем рады видеть вас в другой раз.".format(appointment_id),
        reply_markup=builder.as_markup(),
    )
    await callback.answer("Отменено")


# --------------------------------------------------------------------------- админ

def is_admin(user_id):
    return user_id in BUSINESS.get("admin_ids", [])


@router.message(Command("today"))
async def admin_today(message: Message):
    if not is_admin(message.from_user.id):
        return
    await send_schedule(message, datetime.now().strftime("%Y-%m-%d"), "Сегодня")


@router.message(Command("tomorrow"))
async def admin_tomorrow(message: Message):
    if not is_admin(message.from_user.id):
        return
    date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    await send_schedule(message, date, "Завтра")


async def send_schedule(message, date, title):
    rows = storage.appointments_by_date(date)
    if not rows:
        await message.answer("{} записей нет.".format(title))
        return
    lines = ["<b>{} — {} записей</b>\n".format(title, len(rows))]
    total = 0
    for row in rows:
        total += row["price"]
        lines.append(
            "{} · {} · {} · {} · {}".format(
                row["time"], row["client_name"], row["service_name"], row["phone"],
                "{} ₽".format(row["price"]),
            )
        )
    lines.append("\nОжидаемая выручка: <b>{} ₽</b>".format(total))
    await message.answer("\n".join(lines))


@router.message(Command("stats"))
async def admin_stats(message: Message):
    if not is_admin(message.from_user.id):
        return
    data = storage.stats(30)
    lines = [
        "<b>Статистика за 30 дней</b>\n",
        "Всего записей: {}".format(data["total"]),
        "Отменено: {}".format(data["cancelled"]),
        "Потенциальная выручка: {} ₽".format(data["revenue"]),
        "",
        "<b>Популярные услуги:</b>",
    ]
    for name, count in data["by_service"]:
        lines.append("• {} — {}".format(name, count))
    await message.answer("\n".join(lines))


@router.message(Command("help"))
async def admin_help(message: Message):
    text = (
        "<b>Команды администратора</b>\n\n"
        "/today — записи на сегодня\n"
        "/tomorrow — записи на завтра\n"
        "/stats — статистика за 30 дней\n"
        "/myid — узнать свой Telegram ID для настройки\n"
    )
    await message.answer(text)


@router.message(Command("myid"))
async def admin_myid(message: Message):
    await message.answer("Ваш Telegram ID: <code>{}</code>".format(message.from_user.id))


async def notify_admin(bot, appointment_id, cancelled=False):
    row = storage.get_appointment(appointment_id)
    if row is None:
        return
    icon = "❌ Отмена записи" if cancelled else "🆕 Новая запись"
    text = (
        "{} №{}\n"
        "👤 {} · {}\n"
        "💅 {} · {} ₽\n"
        "📅 {} в {}"
    ).format(
        icon, row["id"], row["client_name"], row["phone"], row["service_name"],
        row["price"], human_date(row["date"]), row["time"],
    )
    for admin_id in BUSINESS.get("admin_ids", []):
        try:
            await bot.send_message(admin_id, text)
        except Exception as error:  # админ не начал чат с ботом
            logger.warning("Не удалось уведомить админа %s: %s", admin_id, error)


# --------------------------------------------------------------------------- напоминания

async def reminder_loop(bot):
    """Раз в 10 минут проверяет, кому пора напомнить о визите."""
    while True:
        try:
            for row, hours_before in storage.due_reminders():
                moment = "{} в {}".format(human_date(row["date"]), row["time"])
                if hours_before >= 12:
                    text = (
                        "🔔 Напоминаем: завтра вы записаны в <b>{}</b>.\n\n"
                        "Услуга: {}\nВремя: <b>{}</b>\n\n"
                        "Если планы изменились, отмените запись в разделе «Мои записи»."
                    ).format(BUSINESS["name"], row["service_name"], moment)
                else:
                    text = (
                        "⏰ Ваш визит <b>через 2 часа</b>: {}.\n\n"
                        "Услуга: {}\nЖдём вас по адресу: {}"
                    ).format(moment, row["service_name"], BUSINESS["address"])
                try:
                    await bot.send_message(row["user_id"], text)
                    storage.mark_reminder_sent(row["id"], hours_before)
                    storage.log_event("reminder_sent", row["user_id"], "{}h".format(hours_before))
                except Exception as error:
                    logger.warning("Напоминание не отправлено: %s", error)
        except Exception as error:
            logger.exception("Ошибка в цикле напоминаний: %s", error)
        await asyncio.sleep(600)


# --------------------------------------------------------------------------- запуск

async def main():
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token:
        print(
            "Не задан BOT_TOKEN.\n\n"
            "1. Откройте @BotFather в Telegram\n"
            "2. /newbot, придумайте имя и username\n"
            "3. Скопируйте токен и запустите:\n"
            '   export BOT_TOKEN="123456:AA..."\n'
            "   python bot.py",
            file=sys.stderr,
        )
        return 1

    storage.init_db()
    bot = Bot(token=token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    asyncio.create_task(reminder_loop(bot))

    logger.info("Бот запущен: %s", BUSINESS["name"])
    await bot.delete_webhook(drop_pending_updates=True)
    await dispatcher.start_polling(bot)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except (KeyboardInterrupt, SystemExit) as error:
        print("\nБот остановлен.")
        sys.exit(error.code if isinstance(error, SystemExit) else 0)

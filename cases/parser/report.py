#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Построение отчётов из собранных данных:
  - Excel: 5 листов, автофильтр, встроенный график Excel
  - HTML: самодостаточный отчёт с диаграммами (без интернета и библиотек)
"""

import html
import json
import os
from collections import defaultdict
from datetime import datetime

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=11)
ACCENT_FILL = PatternFill("solid", fgColor="EAF1FB")
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
MONEY_FORMAT = '#,##0.00\\ "£"'


def load_rows(json_path):
    with open(json_path, "r", encoding="utf-8") as file:
        return json.load(file)


def group_stats(rows, key):
    """Агрегация: количество, средняя/мин/макс цена, средний рейтинг, остаток."""
    buckets = defaultdict(list)
    for row in rows:
        buckets[row.get(key) or "—"].append(row)

    stats = []
    for name, items in buckets.items():
        prices = [i["price"] for i in items if i.get("price") is not None]
        ratings = [i["rating"] for i in items if i.get("rating") is not None]
        stocks = [i["stock_qty"] for i in items if i.get("stock_qty") is not None]
        stats.append(
            {
                "name": name,
                "count": len(items),
                "avg_price": round(sum(prices) / len(prices), 2) if prices else None,
                "min_price": min(prices) if prices else None,
                "max_price": max(prices) if prices else None,
                "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
                "total_stock": sum(stocks) if stocks else None,
                "revenue_potential": round(sum(prices) * 1, 2) if prices else None,
            }
        )
    stats.sort(key=lambda s: (s["avg_price"] or 0), reverse=True)
    return stats


def style_header(worksheet, row_index, columns_count):
    for column in range(1, columns_count + 1):
        cell = worksheet.cell(row=row_index, column=column)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER


def autosize(worksheet, widths):
    for index, width in enumerate(widths, start=1):
        worksheet.column_dimensions[get_column_letter(index)].width = width


def build_excel(rows, stats_category, stats_rating, out_path):
    workbook = Workbook()

    # --- Лист 1: все товары -------------------------------------------------
    sheet = workbook.active
    sheet.title = "Товары"
    headers = ["Название", "Категория", "Цена", "Рейтинг", "В наличии", "Остаток", "Ссылка", "Собрано"]
    sheet.append(headers)
    style_header(sheet, 1, len(headers))

    for row in rows:
        sheet.append(
            [
                row.get("title"),
                row.get("category"),
                row.get("price"),
                row.get("rating"),
                "да" if row.get("in_stock") else "нет",
                row.get("stock_qty"),
                row.get("url"),
                row.get("collected_at"),
            ]
        )

    for row_index in range(2, sheet.max_row + 1):
        sheet.cell(row=row_index, column=3).number_format = MONEY_FORMAT
        if row_index % 2 == 0:
            for column in range(1, len(headers) + 1):
                sheet.cell(row=row_index, column=column).fill = ACCENT_FILL
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = "A1:H{}".format(sheet.max_row)
    autosize(sheet, [58, 26, 12, 10, 11, 10, 46, 19])

    # --- Лист 2: сводка по категориям + график ------------------------------
    summary = workbook.create_sheet("По категориям")
    summary.append(
        ["Категория", "Товаров", "Средняя цена", "Мин. цена", "Макс. цена", "Средний рейтинг", "Остаток всего"]
    )
    style_header(summary, 1, 7)
    for item in stats_category:
        summary.append(
            [
                item["name"], item["count"], item["avg_price"], item["min_price"],
                item["max_price"], item["avg_rating"], item["total_stock"],
            ]
        )
    for row_index in range(2, summary.max_row + 1):
        for column in (3, 4, 5):
            summary.cell(row=row_index, column=column).number_format = MONEY_FORMAT
    autosize(summary, [30, 10, 14, 12, 12, 15, 13])

    chart = BarChart()
    chart.type = "bar"
    chart.title = "Средняя цена по категориям, £"
    chart.y_axis.title = "Категория"
    chart.x_axis.title = "Средняя цена"
    data = Reference(summary, min_col=3, min_row=1, max_row=min(summary.max_row, 16))
    categories = Reference(summary, min_col=1, min_row=2, max_row=min(summary.max_row, 16))
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(categories)
    chart.height = 12
    chart.width = 22
    summary.add_chart(chart, "I2")

    # --- Лист 3: распределение по рейтингу ---------------------------------
    rating_sheet = workbook.create_sheet("По рейтингу")
    rating_sheet.append(["Рейтинг", "Товаров", "Средняя цена", "Мин. цена", "Макс. цена"])
    style_header(rating_sheet, 1, 5)
    for item in sorted(stats_rating, key=lambda s: str(s["name"])):
        rating_sheet.append(
            [item["name"], item["count"], item["avg_price"], item["min_price"], item["max_price"]]
        )
    for row_index in range(2, rating_sheet.max_row + 1):
        for column in (3, 4, 5):
            rating_sheet.cell(row=row_index, column=column).number_format = MONEY_FORMAT
    autosize(rating_sheet, [12, 10, 14, 12, 12])

    # --- Лист 4: топ дорогих и дешёвых -------------------------------------
    extremes = workbook.create_sheet("Топ и антитоп")
    priced = [r for r in rows if r.get("price") is not None]
    top = sorted(priced, key=lambda r: r["price"], reverse=True)[:15]
    low = sorted(priced, key=lambda r: r["price"])[:15]

    extremes.append(["ТОП-15 ДОРОГИХ", "", "", "ТОП-15 ДЕШЁВЫХ", "", ""])
    style_header(extremes, 1, 6)
    extremes.append(["Название", "Категория", "Цена", "Название", "Категория", "Цена"])
    style_header(extremes, 2, 6)
    for index in range(15):
        left = top[index] if index < len(top) else {}
        right = low[index] if index < len(low) else {}
        extremes.append(
            [
                left.get("title"), left.get("category"), left.get("price"),
                right.get("title"), right.get("category"), right.get("price"),
            ]
        )
    for row_index in range(3, extremes.max_row + 1):
        extremes.cell(row=row_index, column=3).number_format = MONEY_FORMAT
        extremes.cell(row=row_index, column=6).number_format = MONEY_FORMAT
    autosize(extremes, [50, 24, 12, 50, 24, 12])

    # --- Лист 5: метаданные -------------------------------------------------
    info = workbook.create_sheet("Инфо")
    prices = [r["price"] for r in priced]
    info_rows = [
        ["Отчёт по парсингу каталога", ""],
        ["Дата формирования", datetime.now().strftime("%d.%m.%Y %H:%M")],
        ["Источник", "books.toscrape.com (демонстрационный каталог)"],
        ["Всего товаров", len(rows)],
        ["Категорий", len(stats_category)],
        ["Средняя цена", round(sum(prices) / len(prices), 2) if prices else None],
        ["Самая низкая цена", min(prices) if prices else None],
        ["Самая высокая цена", max(prices) if prices else None],
        ["Товаров в наличии", sum(1 for r in rows if r.get("in_stock"))],
    ]
    for item in info_rows:
        info.append(item)
    info["A1"].font = Font(bold=True, size=14, color="1F3864")
    info["B6"].number_format = MONEY_FORMAT
    info["B7"].number_format = MONEY_FORMAT
    info["B8"].number_format = MONEY_FORMAT
    autosize(info, [26, 46])

    workbook.save(out_path)
    return out_path


def svg_bar_chart(items, width=760, bar_height=26, gap=10, color="#2f6fed"):
    """Горизонтальная столбчатая диаграмма на чистом SVG."""
    max_value = max([i["value"] for i in items] or [1]) or 1
    label_width = 230
    chart_width = width - label_width - 90
    height = len(items) * (bar_height + gap) + 20
    parts = ['<svg viewBox="0 0 {} {}" width="100%" xmlns="http://www.w3.org/2000/svg">'.format(width, height)]
    for index, item in enumerate(items):
        y = index * (bar_height + gap)
        bar_width = max(2, int(chart_width * item["value"] / max_value))
        parts.append(
            '<text x="0" y="{}" font-size="13" fill="#333" font-family="Arial">{}</text>'.format(
                y + bar_height - 7, html.escape(str(item["label"])[:32])
            )
        )
        parts.append(
            '<rect x="{}" y="{}" width="{}" height="{}" rx="4" fill="{}"/>'.format(
                label_width, y, bar_width, bar_height, color
            )
        )
        parts.append(
            '<text x="{}" y="{}" font-size="13" fill="#111" font-family="Arial" font-weight="bold">{}</text>'.format(
                label_width + bar_width + 8, y + bar_height - 7, html.escape(str(item["text"]))
            )
        )
    parts.append("</svg>")
    return "".join(parts)


def svg_histogram(values, bins=10, width=760, height=240, color="#12b886"):
    """Гистограмма распределения цен."""
    if not values:
        return ""
    low, high = min(values), max(values)
    step = (high - low) / bins or 1
    counts = [0] * bins
    for value in values:
        index = min(int((value - low) / step), bins - 1)
        counts[index] += 1
    max_count = max(counts) or 1
    padding_left, padding_bottom, padding_top = 50, 40, 20
    plot_width = width - padding_left - 20
    plot_height = height - padding_bottom - padding_top
    bar_width = plot_width / bins

    parts = ['<svg viewBox="0 0 {} {}" width="100%" xmlns="http://www.w3.org/2000/svg">'.format(width, height)]
    parts.append(
        '<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#ccc"/>'.format(
            padding_left, height - padding_bottom, width - 20, height - padding_bottom
        )
    )
    for index, count in enumerate(counts):
        bar_h = int(plot_height * count / max_count)
        x = padding_left + index * bar_width + 2
        y = height - padding_bottom - bar_h
        parts.append(
            '<rect x="{:.1f}" y="{}" width="{:.1f}" height="{}" rx="3" fill="{}"/>'.format(
                x, y, bar_width - 4, bar_h, color
            )
        )
        parts.append(
            '<text x="{:.1f}" y="{}" font-size="11" fill="#555" text-anchor="middle" font-family="Arial">{}</text>'.format(
                x + (bar_width - 4) / 2, y - 5, count
            )
        )
        label = "{:.0f}".format(low + index * step)
        parts.append(
            '<text x="{:.1f}" y="{}" font-size="11" fill="#666" text-anchor="middle" font-family="Arial">{}</text>'.format(
                x + (bar_width - 4) / 2, height - padding_bottom + 18, label
            )
        )
    parts.append(
        '<text x="{}" y="16" font-size="13" fill="#333" font-family="Arial">Распределение цен, £</text>'.format(
            padding_left
        )
    )
    parts.append("</svg>")
    return "".join(parts)


def build_html(rows, stats_category, stats_rating, out_path, source):
    priced = [r for r in rows if r.get("price") is not None]
    prices = [r["price"] for r in priced]
    avg_price = sum(prices) / len(prices) if prices else 0

    top_categories = [
        {"label": item["name"], "value": item["avg_price"] or 0, "text": "{:.2f} £".format(item["avg_price"] or 0)}
        for item in stats_category[:12]
    ]
    rating_items = [
        {"label": "Рейтинг {} — {} шт.".format(item["name"], item["count"]), "value": item["count"], "text": str(item["count"])}
        for item in sorted(stats_rating, key=lambda s: str(s["name"]))
    ]
    histogram = svg_histogram(prices)
    category_chart = svg_bar_chart(top_categories)

    table_rows = "\n".join(
        "<tr><td>{}</td><td>{}</td><td class='num'>{:.2f} £</td><td class='num'>{}</td><td class='num'>{}</td></tr>".format(
            html.escape(str(item["name"])),
            item["count"],
            item["avg_price"] or 0,
            item["min_price"] or 0,
            item["max_price"] or 0,
        )
        for item in stats_category
    )

    top_items = "\n".join(
        "<tr><td>{}</td><td>{}</td><td class='num'>{:.2f} £</td></tr>".format(
            html.escape(str(row.get("title"))[:70]),
            html.escape(str(row.get("category"))),
            row["price"],
        )
        for row in sorted(priced, key=lambda r: r["price"], reverse=True)[:20]
    )

    document = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Отчёт по парсингу каталога</title>
<style>
  :root {{ --ink:#12203a; --muted:#6b7a99; --line:#e3e9f2; --accent:#2f6fed; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:#f5f7fb; color:var(--ink);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }}
  .wrap {{ max-width:1080px; margin:0 auto; padding:32px 20px 64px; }}
  header {{ background:linear-gradient(135deg,#12203a,#2f6fed); color:#fff;
            border-radius:16px; padding:28px 32px; margin-bottom:24px; }}
  header h1 {{ margin:0 0 8px; font-size:26px; }}
  header p {{ margin:0; opacity:.85; font-size:14px; }}
  .cards {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin-bottom:24px; }}
  .card {{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px 20px; }}
  .card .label {{ font-size:13px; color:var(--muted); margin-bottom:6px; }}
  .card .value {{ font-size:24px; font-weight:700; }}
  section {{ background:#fff; border:1px solid var(--line); border-radius:14px;
             padding:22px 24px; margin-bottom:20px; }}
  section h2 {{ margin:0 0 18px; font-size:18px; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }}
  th {{ text-align:left; padding:10px 12px; background:#f2f5fb; color:var(--muted);
        font-weight:600; font-size:13px; border-bottom:1px solid var(--line); }}
  td {{ padding:10px 12px; border-bottom:1px solid #f0f3f8; }}
  td.num, th.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
  tr:hover td {{ background:#fafcff; }}
  footer {{ color:var(--muted); font-size:13px; text-align:center; margin-top:28px; }}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Отчёт по парсингу каталога</h1>
    <p>Источник: {source} · сформирован {generated} · обход с пагинацией по категориям</p>
  </header>

  <div class="cards">
    <div class="card"><div class="label">Собрано товаров</div><div class="value">{total}</div></div>
    <div class="card"><div class="label">Категорий</div><div class="value">{categories}</div></div>
    <div class="card"><div class="label">Средняя цена</div><div class="value">{avg_price:.2f} £</div></div>
    <div class="card"><div class="label">Диапазон цен</div><div class="value">{min_price:.2f} – {max_price:.2f} £</div></div>
  </div>

  <section>
    <h2>Распределение цен</h2>
    {histogram}
  </section>

  <section>
    <h2>Средняя цена по категориям</h2>
    {category_chart}
  </section>

  <section>
    <h2>Товары по рейтингу</h2>
    {rating_chart}
  </section>

  <section>
    <h2>Сводка по категориям</h2>
    <table>
      <thead><tr><th>Категория</th><th class="num">Товаров</th><th class="num">Средняя цена</th>
      <th class="num">Мин.</th><th class="num">Макс.</th></tr></thead>
      <tbody>{table_rows}</tbody>
    </table>
  </section>

  <section>
    <h2>ТОП-20 самых дорогих позиций</h2>
    <table>
      <thead><tr><th>Название</th><th>Категория</th><th class="num">Цена</th></tr></thead>
      <tbody>{top_items}</tbody>
    </table>
  </section>

  <footer>Отчёт сформирован автоматически скриптом на Python. Данные получены из открытого источника
  с соблюдением пауз между запросами.</footer>
</div>
</body>
</html>
""".format(
        source=html.escape(source),
        generated=datetime.now().strftime("%d.%m.%Y %H:%M"),
        total=len(rows),
        categories=len(stats_category),
        avg_price=avg_price,
        min_price=min(prices) if prices else 0,
        max_price=max(prices) if prices else 0,
        histogram=histogram,
        category_chart=category_chart,
        rating_chart=svg_bar_chart(rating_items, color="#12b886"),
        table_rows=table_rows,
        top_items=top_items,
    )

    with open(out_path, "w", encoding="utf-8") as file:
        file.write(document)
    return out_path


def main(data_dir="data", out_dir="результат", source="books.toscrape.com"):
    json_path = os.path.join(data_dir, "raw.json")
    if not os.path.exists(json_path):
        raise SystemExit("Нет файла {}. Сначала запустите parser.py".format(json_path))

    rows = load_rows(json_path)
    stats_category = group_stats(rows, "category")
    stats_rating = group_stats(rows, "rating")
    os.makedirs(out_dir, exist_ok=True)

    excel_path = os.path.join(out_dir, "каталог_товаров.xlsx")
    html_path = os.path.join(out_dir, "отчёт.html")

    build_excel(rows, stats_category, stats_rating, excel_path)
    build_html(rows, stats_category, stats_rating, html_path, source)

    print("Excel: {}".format(excel_path))
    print("HTML : {}".format(html_path))
    return excel_path, html_path


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерация PNG-графиков из собранных данных.

Зачем: заказчику в чат и на обложку кворка нужны картинки, а не только Excel.
Графики строятся офлайн, без интерактивного окна и без интернета.

Запуск: python charts.py
Результат: результат/графики/*.png
"""

import json
import os
from collections import defaultdict

import matplotlib

matplotlib.use("Agg")  # рендер в файл, без окна

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(HERE, "data", "raw.json")
OUT_DIR = os.path.join(HERE, "результат", "графики")

ACCENT = "#2f6fed"
ACCENT_2 = "#12b886"
INK = "#12203a"
GRID = "#dfe6f1"

plt.rcParams.update(
    {
        "font.size": 11,
        "axes.edgecolor": GRID,
        "axes.labelcolor": INK,
        "text.color": INK,
        "xtick.color": "#5a6b8c",
        "ytick.color": "#5a6b8c",
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.grid": True,
        "grid.color": GRID,
        "grid.linewidth": 0.8,
    }
)


def load_rows():
    with open(DATA_PATH, "r", encoding="utf-8") as file:
        return json.load(file)


def style_axes(axes):
    axes.spines["top"].set_visible(False)
    axes.spines["right"].set_visible(False)
    axes.set_axisbelow(True)


def chart_categories(rows, path):
    buckets = defaultdict(list)
    for row in rows:
        if row.get("price") is not None:
            buckets[row["category"]].append(row["price"])
    averages = sorted(
        ((name, sum(values) / len(values), len(values)) for name, values in buckets.items()),
        key=lambda item: item[1],
        reverse=True,
    )[:12]

    names = [item[0][:26] for item in averages][::-1]
    values = [item[1] for item in averages][::-1]

    figure, axes = plt.subplots(figsize=(10, 6.2), dpi=150)
    bars = axes.barh(names, values, color=ACCENT, height=0.68)
    for bar, value in zip(bars, values):
        axes.text(
            bar.get_width() + max(values) * 0.015,
            bar.get_y() + bar.get_height() / 2,
            "{:.0f} £".format(value),
            va="center",
            fontsize=10,
            color=INK,
            fontweight="bold",
        )
    axes.set_title("Средняя цена по категориям", fontsize=15, fontweight="bold", pad=16)
    axes.set_xlabel("Средняя цена, £")
    axes.set_xlim(0, max(values) * 1.16)
    style_axes(axes)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)
    return path


def chart_price_distribution(rows, path):
    prices = [row["price"] for row in rows if row.get("price") is not None]
    figure, axes = plt.subplots(figsize=(10, 5.2), dpi=150)
    axes.hist(prices, bins=14, color=ACCENT_2, edgecolor="white", linewidth=1.2)
    axes.axvline(
        sum(prices) / len(prices),
        color="#e8590c",
        linestyle="--",
        linewidth=2,
        label="Средняя {:.0f} £".format(sum(prices) / len(prices)),
    )
    axes.set_title("Распределение цен", fontsize=15, fontweight="bold", pad=16)
    axes.set_xlabel("Цена, £")
    axes.set_ylabel("Количество товаров")
    axes.legend(frameon=False)
    style_axes(axes)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)
    return path


def chart_top_expensive(rows, path):
    priced = sorted(
        (row for row in rows if row.get("price") is not None),
        key=lambda row: row["price"],
        reverse=True,
    )[:10]
    titles = [row["title"][:34] + ("…" if len(row["title"]) > 34 else "") for row in priced][::-1]
    values = [row["price"] for row in priced][::-1]

    figure, axes = plt.subplots(figsize=(10, 5.6), dpi=150)
    bars = axes.barh(titles, values, color="#7048e8", height=0.66)
    for bar, value in zip(bars, values):
        axes.text(
            bar.get_width() + max(values) * 0.015,
            bar.get_y() + bar.get_height() / 2,
            "{:.2f} £".format(value),
            va="center",
            fontsize=10,
            color=INK,
        )
    axes.set_title("ТОП-10 самых дорогих позиций", fontsize=15, fontweight="bold", pad=16)
    axes.set_xlim(0, max(values) * 1.18)
    axes.xaxis.set_major_locator(MaxNLocator(nbins=6))
    style_axes(axes)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)
    return path


def chart_rating(rows, path):
    buckets = defaultdict(int)
    for row in rows:
        key = row.get("rating") if row.get("rating") is not None else 0
        buckets[key] += 1
    labels = ["без рейтинга"] + ["{} ★".format(star) for star in range(1, 6)]
    values = [buckets.get(0, 0)] + [buckets.get(star, 0) for star in range(1, 6)]

    figure, axes = plt.subplots(figsize=(8.4, 5), dpi=150)
    bars = axes.bar(labels, values, color="#f59f00", width=0.62)
    for bar, value in zip(bars, values):
        if value:
            axes.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + max(values) * 0.02,
                str(value),
                ha="center",
                fontsize=10,
                fontweight="bold",
            )
    axes.set_title("Товары по рейтингу", fontsize=15, fontweight="bold", pad=16)
    axes.set_ylabel("Количество товаров")
    axes.set_ylim(0, max(values) * 1.16)
    style_axes(axes)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)
    return path


def main():
    if not os.path.exists(DATA_PATH):
        raise SystemExit("Нет файла {}. Сначала запустите parser.py".format(DATA_PATH))
    os.makedirs(OUT_DIR, exist_ok=True)

    rows = load_rows()
    made = [
        chart_categories(rows, os.path.join(OUT_DIR, "01_средняя_цена_по_категориям.png")),
        chart_price_distribution(rows, os.path.join(OUT_DIR, "02_распределение_цен.png")),
        chart_rating(rows, os.path.join(OUT_DIR, "03_товары_по_рейтингу.png")),
        chart_top_expensive(rows, os.path.join(OUT_DIR, "04_топ_дорогих_позиций.png")),
    ]
    for path in made:
        print("Готово: {}".format(os.path.relpath(path, HERE)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

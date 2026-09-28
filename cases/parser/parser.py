#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Парсер каталога товаров -> Excel + HTML-отчёт.

Демонстрационный проект портфолио: обход каталога с пагинацией по категориям,
сбор структурированных данных, экспорт в Excel с графиком и HTML-отчёт с аналитикой.

Пример: python run.py --categories 8 --delay 0.2
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://books.toscrape.com/"
CATALOGUE_URL = urljoin(BASE_URL, "catalogue/")

RATING_MAP = {"One": 1, "Two": 2, "Three": 3, "Four": 4, "Five": 5}
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


class Fetcher:
    """HTTP-клиент с повторами, вежливой задержкой и корректной кодировкой."""

    def __init__(self, delay=0.3, retries=3, timeout=25):
        self.delay = delay
        self.retries = retries
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.requests_done = 0

    def get_soup(self, url):
        last_error = None
        for attempt in range(1, self.retries + 1):
            try:
                response = self.session.get(url, timeout=self.timeout)
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                response.encoding = response.apparent_encoding or "utf-8"
                self.requests_done += 1
                time.sleep(self.delay)
                return BeautifulSoup(response.text, "lxml")
            except requests.RequestException as error:
                last_error = error
                time.sleep(self.delay * attempt * 2)
        print("  ! не удалось получить {}: {}".format(url, last_error), file=sys.stderr)
        return None


def parse_price(raw_price):
    """'£51.77' -> (51.77, 'GBP')"""
    if not raw_price:
        return None, None
    digits = re.sub(r"[^0-9.,]", "", raw_price).replace(",", "")
    try:
        return float(digits), "GBP"
    except ValueError:
        return None, None


def parse_stock(raw_stock):
    """'In stock (22 available)' -> (True, 22)"""
    if not raw_stock:
        return None, None
    in_stock = "in stock" in raw_stock.lower()
    match = re.search(r"(\d+)\s+available", raw_stock)
    return in_stock, int(match.group(1)) if match else None


def parse_rating(classes):
    for name, value in RATING_MAP.items():
        if name in classes:
            return value
    return None


def get_categories(fetcher, limit=None):
    """Собирает список категорий из бокового меню каталога."""
    soup = fetcher.get_soup(CATALOGUE_URL + "page-1.html")
    if soup is None:
        return []
    categories = []
    for link in soup.select("div.side_categories ul li ul li a"):
        name = link.get_text(strip=True)
        href = link.get("href", "")
        # 'category/books/travel_2/index.html' -> абсолютный URL первой страницы
        absolute = urljoin(CATALOGUE_URL, href)
        categories.append({"name": name, "url": absolute})
    if limit:
        categories = categories[:limit]
    return categories


def parse_listing_page(soup, category_name, page_url):
    """Разбирает страницу листинга и возвращает список товаров."""
    items = []
    for card in soup.select("article.product_pod"):
        title_link = card.select_one("h3 a")
        if title_link is None:
            continue
        price_value, currency = parse_price(
            card.select_one("p.price_color").get_text(strip=True)
            if card.select_one("p.price_color")
            else ""
        )
        in_stock, stock_qty = parse_stock(
            card.select_one("p.instock.availability").get_text(" ", strip=True)
            if card.select_one("p.instock.availability")
            else ""
        )
        rating_node = card.select_one("p.star-rating")
        rating = parse_rating(rating_node["class"]) if rating_node else None
        items.append(
            {
                "title": title_link.get("title") or title_link.get_text(strip=True),
                "category": category_name,
                "price": price_value,
                "currency": currency,
                "rating": rating,
                "in_stock": in_stock,
                "stock_qty": stock_qty,
                "url": urljoin(page_url, title_link.get("href", "")),
                "collected_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        )
    return items


def crawl_category(fetcher, category, max_pages=50):
    """Обходит все страницы пагинации внутри одной категории."""
    collected = []
    page_url = category["url"]
    page_number = 1
    while page_url and page_number <= max_pages:
        soup = fetcher.get_soup(page_url)
        if soup is None:
            break
        page_items = parse_listing_page(soup, category["name"], page_url)
        collected.extend(page_items)
        print(
            "  {:<28} стр.{:<3} +{:<3} всего {}".format(
                category["name"][:28], page_number, len(page_items), len(collected)
            )
        )
        next_link = soup.select_one("li.next a")
        if next_link is None:
            break
        page_url = urljoin(page_url, next_link.get("href", ""))
        page_number += 1
    return collected


def save_results(rows, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rows_sorted = sorted(rows, key=lambda r: (r["category"] or "", r["title"] or ""))

    json_path = os.path.join(out_dir, "raw.json")
    with open(json_path, "w", encoding="utf-8") as file:
        json.dump(rows_sorted, file, ensure_ascii=False, indent=2)

    csv_path = os.path.join(out_dir, "books.csv")
    fieldnames = [
        "title", "category", "price", "currency", "rating",
        "in_stock", "stock_qty", "url", "collected_at",
    ]
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows_sorted)

    return json_path, csv_path


def main():
    parser = argparse.ArgumentParser(description="Парсер каталога в Excel и HTML-отчёт")
    parser.add_argument("--categories", type=int, default=8, help="сколько категорий обойти")
    parser.add_argument("--delay", type=float, default=0.2, help="пауза между запросами, сек")
    parser.add_argument("--max-pages", type=int, default=50, help="лимит страниц в категории")
    parser.add_argument("--out", default="data", help="папка для результатов")
    args = parser.parse_args()

    started = time.time()
    print("=" * 72)
    print("ПАРСЕР КАТАЛОГА -> EXCEL + HTML-ОТЧЁТ")
    print("=" * 72)

    fetcher = Fetcher(delay=args.delay)

    print("\n[1/3] Получаю список категорий...")
    categories = get_categories(fetcher, limit=args.categories)
    if not categories:
        print("Не удалось получить категории. Проверьте интернет.", file=sys.stderr)
        return 1
    print("      найдено категорий для обхода: {}".format(len(categories)))

    print("\n[2/3] Обхожу каталог...")
    all_rows = []
    for index, category in enumerate(categories, start=1):
        print("[{}/{}] {}".format(index, len(categories), category["name"]))
        all_rows.extend(crawl_category(fetcher, category, max_pages=args.max_pages))

    if not all_rows:
        print("Данные не собраны.", file=sys.stderr)
        return 1

    print("\n[3/3] Сохраняю результаты...")
    json_path, csv_path = save_results(all_rows, args.out)
    elapsed = time.time() - started
    print("      JSON: {}".format(json_path))
    print("      CSV : {}".format(csv_path))
    print(
        "\nГотово: {} товаров, {} запросов, {:.1f} сек.".format(
            len(all_rows), fetcher.requests_done, elapsed
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Запуск полного цикла: сбор данных -> Excel -> HTML-отчёт.

Использование:
    python run.py                  # 8 категорий
    python run.py --categories 20  # 20 категорий
    python run.py --categories 50 --delay 0.1
"""

import argparse
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    parser = argparse.ArgumentParser(description="Полный цикл: парсинг + отчёты")
    parser.add_argument("--categories", type=int, default=8, help="сколько категорий обойти")
    parser.add_argument("--delay", type=float, default=0.2, help="пауза между запросами, сек")
    parser.add_argument("--max-pages", type=int, default=50, help="лимит страниц в категории")
    args = parser.parse_args()

    parser_code = subprocess.call(
        [
            sys.executable,
            os.path.join(HERE, "parser.py"),
            "--categories", str(args.categories),
            "--delay", str(args.delay),
            "--max-pages", str(args.max_pages),
        ],
        cwd=HERE,
    )
    if parser_code != 0:
        return parser_code

    sys.path.insert(0, HERE)
    import report

    print("\nСтрою отчёты...")
    report.main(data_dir=os.path.join(HERE, "data"), out_dir=os.path.join(HERE, "результат"))
    print("\nГотово. Откройте папку «результат».")
    return 0


if __name__ == "__main__":
    sys.exit(main())

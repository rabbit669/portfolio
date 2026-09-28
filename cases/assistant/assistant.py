#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ИИ-ассистент по базе знаний: отвечает на вопросы клиентов, опираясь только на
документы компании, и всегда показывает источники.

Использование:
    python assistant.py --ask "сколько стоит доставка в Казань"
    python assistant.py --interactive
    python assistant.py --demo            # прогон набора вопросов и сохранение транскрипта

Без ключа LLM_API_KEY работает офлайн: ответ собирается из найденных фрагментов.
С ключом — ответ формулирует языковая модель, но факты берутся только из базы знаний.
"""

import argparse
import json
import os
import sys

import llm
import retrieval

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DOCS = os.path.join(HERE, "docs")
DEMO_QUESTIONS = [
    "Сколько стоит доставка в другой город?",
    "Можно ли вернуть товар, если он не подошёл?",
    "Как оплатить заказ и есть ли рассрочка?",
    "Что делать, если товар пришёл с браком?",
    "Даёте ли вы гарантию и на какой срок?",
    "Есть ли самовывоз со склада?",
    "Как узнать, где сейчас мой заказ?",
    "Предоставляете ли вы документы для юридических лиц?",
    "Можно ли изменить адрес доставки после оформления?",
    "А есть ли скидки при большом заказе?",
]


def answer_question(base, question, top_k=4, use_llm=True):
    hits = base.search(question, top_k=top_k)
    text = None
    source = "офлайн"
    if use_llm and llm.is_configured():
        text = llm.ask_llm(question, hits)
        source = "модель" if text else "офлайн (модель недоступна)"
    if not text:
        text = llm.template_answer(question, hits, idf=base.idf)
    return {
        "question": question,
        "answer": text,
        "source_mode": source,
        "hits": [
            {"score": round(score, 3), "label": chunk.label, "path": chunk.source_path}
            for score, chunk in hits
        ],
    }


def print_result(result):
    print("\n" + "=" * 72)
    print("ВОПРОС: {}".format(result["question"]))
    print("=" * 72)
    print(result["answer"])
    print("\nИсточники:")
    if not result["hits"]:
        print("  — ничего не найдено")
    for hit in result["hits"]:
        print("  • {} — релевантность {}".format(hit["label"], hit["score"]))
    print("(режим ответа: {})".format(result["source_mode"]))


def main():
    parser = argparse.ArgumentParser(description="ИИ-ассистент по базе знаний компании")
    parser.add_argument("--docs", default=DEFAULT_DOCS, help="папка с документами базы знаний")
    parser.add_argument("--ask", help="задать один вопрос")
    parser.add_argument("--interactive", action="store_true", help="режим диалога")
    parser.add_argument("--demo", action="store_true", help="прогнать набор демо-вопросов")
    parser.add_argument("--top-k", type=int, default=4, help="сколько фрагментов использовать")
    parser.add_argument("--no-llm", action="store_true", help="только офлайн-режим")
    parser.add_argument("--json", dest="as_json", help="сохранить результаты в файл JSON")
    args = parser.parse_args()

    base, documents = retrieval.build_index(args.docs)
    print("База знаний загружена: документов — {}, фрагментов — {}".format(
        len(documents), len(base.chunks)))
    print("Режим ответа: {}".format(
        "языковая модель ({})".format(os.getenv("LLM_MODEL", "по умолчанию"))
        if (llm.is_configured() and not args.no_llm) else "офлайн, без внешних запросов"
    ))

    results = []

    if args.ask:
        results.append(answer_question(base, args.ask, args.top_k, not args.no_llm))
    elif args.demo:
        for question in DEMO_QUESTIONS:
            results.append(answer_question(base, question, args.top_k, not args.no_llm))
    elif args.interactive:
        print("\nВведите вопрос (пустая строка — выход).")
        while True:
            try:
                question = input("\n> ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not question:
                break
            print_result(answer_question(base, question, args.top_k, not args.no_llm))
        return 0
    else:
        results.append(answer_question(base, "Сколько стоит доставка?", args.top_k, not args.no_llm))

    # Сначала сохраняем результаты в файлы, потом печатаем в консоль.
    # Так файлы не теряются, если вывод перенаправлен и оборвался (например, `| head`).
    if args.as_json:
        json_dir = os.path.dirname(os.path.abspath(args.as_json))
        os.makedirs(json_dir, exist_ok=True)
        with open(args.as_json, "w", encoding="utf-8") as file:
            json.dump(results, file, ensure_ascii=False, indent=2)

    if args.demo:
        out_dir = os.path.join(HERE, "результат")
        os.makedirs(out_dir, exist_ok=True)
        text_path = os.path.join(out_dir, "демо_ответы.txt")
        with open(text_path, "w", encoding="utf-8") as file:
            for result in results:
                file.write("ВОПРОС: {}\n{}\nИсточники: {}\n\n".format(
                    result["question"], result["answer"],
                    "; ".join(hit["label"] for hit in result["hits"]) or "—",
                ))

    try:
        for result in results:
            print_result(result)
        if args.as_json:
            print("\nРезультаты сохранены: {}".format(args.as_json))
        if args.demo:
            print("Транскрипт сохранён: {}".format(
                os.path.join(HERE, "результат", "демо_ответы.txt")))
    except BrokenPipeError:
        # Вывод оборван (например, вывод читает `head`) — файлы уже сохранены.
        try:
            sys.stdout.close()
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        os._exit(0)

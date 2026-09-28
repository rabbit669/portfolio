#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Подключение языковой модели. Работает с любым OpenAI-совместимым API
(OpenAI, OpenRouter, локальные серверы, российские провайдеры).

Если ключа нет — используется офлайн-режим: ответ собирается из найденных
фрагментов базы знаний без обращения к интернету. Демонстрация работает всегда.
"""

import json
import os
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"

SYSTEM_PROMPT = (
    "Ты — ассистент службы поддержки. Отвечай только на основе предоставленных фрагментов "
    "базы знаний. Если ответа в них нет, честно скажи: «В базе знаний нет ответа на этот "
    "вопрос, уточните у оператора». Отвечай кратко, по-русски, без выдумывания цифр и условий. "
    "В конце ответа не пересказывай источники — они будут показаны отдельно."
)


def is_configured():
    return bool(os.getenv("LLM_API_KEY", "").strip())


def build_context(hits):
    parts = []
    for number, (score, chunk) in enumerate(hits, start=1):
        parts.append("[Фрагмент {}: {}]\n{}".format(number, chunk.label, chunk.text))
    return "\n\n".join(parts)


def ask_llm(question, hits, timeout=60):
    """Запрос к LLM. Возвращает текст ответа или None, если не получилось."""
    api_key = os.getenv("LLM_API_KEY", "").strip()
    if not api_key:
        return None

    base_url = os.getenv("LLM_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    model = os.getenv("LLM_MODEL", DEFAULT_MODEL)
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": "База знаний:\n\n{}\n\nВопрос клиента: {}".format(
                    build_context(hits), question
                ),
            },
        ],
    }
    request = urllib.request.Request(
        base_url + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer {}".format(api_key),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, ValueError, TimeoutError):
        return None


def template_answer(question, hits, idf=None):
    """Офлайн-ответ без модели: аккуратная выжимка из найденных фрагментов.

    `idf` — функция редкости термина из поискового индекса: благодаря ей редкие
    слова вопроса («брак», «трек-номер») перевешивают частые («товар», «заказ»).
    """
    if not hits:
        return (
            "В базе знаний нет ответа на этот вопрос. "
            "Передам его оператору — он свяжется с вами."
        )
    from retrieval import rank_sentences

    # Учитываем все найденные фрагменты, а не только первый: нужный пункт
    # (например, про замену бракованного товара) часто лежит ниже в выдаче.
    chunks = [chunk for _score, chunk in hits]
    excerpt = rank_sentences(chunks, question, limit=4, idf=idf)
    if not excerpt:
        excerpt = [hits[0][1].text.strip()[:400]]
    return "{}\n\n(Ответ собран из базы знаний без обращения к внешней модели.)".format(
        " ".join(excerpt)
    )

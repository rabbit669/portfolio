#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Поиск по базе знаний: разбивка документов на фрагменты + ранжирование BM25.

Реализация без внешних зависимостей и без интернета — работает офлайн.
Для русского языка применяется упрощённая нормализация словоформ, чтобы
«доставка», «доставку», «доставке» считались одним словом.
"""

import math
import os
import re
import unicodedata
from collections import Counter

SUPPORTED_EXTENSIONS = (".txt", ".md", ".csv")

STOPWORDS = {
    "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то", "все", "она",
    "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за", "бы", "по", "только", "ее",
    "мне", "было", "вот", "от", "меня", "еще", "нет", "о", "из", "ему", "теперь", "когда",
    "даже", "ну", "вдруг", "ли", "если", "уже", "или", "ни", "быть", "был", "него", "до",
    "вас", "нибудь", "опять", "уж", "вам", "ведь", "там", "потом", "себя", "ничего", "ей",
    "может", "они", "тут", "где", "есть", "надо", "ней", "для", "мы", "тебя", "их", "чем",
    "была", "сам", "чтоб", "без", "будто", "чего", "раз", "тоже", "себе", "под", "будет",
    "ж", "тогда", "кто", "этот", "того", "потому", "этого", "какой", "совсем", "ним",
    "здесь", "этом", "один", "почти", "мой", "тем", "чтобы", "нее", "сейчас", "были", "куда",
    "зачем", "всех", "никогда", "можно", "при", "наконец", "два", "об", "другой", "хоть",
    "после", "над", "больше", "тот", "через", "эти", "нас", "про", "всего", "них", "какая",
    "много", "разве", "три", "эту", "моя", "впрочем", "хорошо", "свою", "этой", "перед",
    "иногда", "лучше", "чуть", "том", "нельзя", "такой", "им", "более", "всегда", "конечно",
    "всю", "между",
}

# Частые русские окончания: срезаем, чтобы «доставка/доставки/доставку» совпали.
# Порядок важен: длинные окончания проверяются раньше коротких.
SUFFIXES = (
    "иями", "ями", "ами", "ией", "иях", "ыми", "ими", "ого", "его", "ому", "ему",
    "ою", "ею", "ию", "ия", "ий", "ые", "ых", "их", "ой", "ей", "ом", "ем",
    "ам", "ям", "ах", "ях", "ов", "ев", "ие", "ая", "яя", "ое", "ее", "ый",
    "ую", "юю", "у", "ю", "а", "я", "ы", "и", "е", "о", "ь",
)


def normalize_token(token):
    """Приводит словоформу к основе: «брака», «браком», «брак» → «брак».

    Порог в 5 символов оставлял слова вроде «брака» без обработки, из-за чего
    нужные предложения не находились. Теперь срезаем окончания и у коротких слов,
    но требуем, чтобы основа осталась не короче трёх букв.
    """
    token = token.lower().replace("ё", "е")
    if len(token) > 4:
        for suffix in SUFFIXES:
            if token.endswith(suffix) and len(token) - len(suffix) >= 3:
                return token[: -len(suffix)]
    return token


def tokenize(text):
    text = unicodedata.normalize("NFKC", text)
    words = re.findall(r"[а-яa-z0-9]+", text.lower().replace("ё", "е"))
    return [normalize_token(word) for word in words if word not in STOPWORDS and len(word) > 1]


class Chunk(object):
    def __init__(self, doc_title, source_path, index, text):
        self.doc_title = doc_title
        self.source_path = source_path
        self.index = index
        self.text = text
        self.tokens = tokenize(text)
        self.term_freq = Counter(self.tokens)

    @property
    def label(self):
        return "{} · фрагмент {}".format(self.doc_title, self.index + 1)


def split_into_chunks(text, max_chars=900, overlap_chars=150):
    """Режет документ по абзацам, длинные абзацы добивает по предложениям."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks = []
    buffer = ""
    for paragraph in paragraphs:
        if len(buffer) + len(paragraph) + 2 <= max_chars:
            buffer = (buffer + "\n\n" + paragraph).strip()
            continue
        if buffer:
            chunks.append(buffer)
            buffer = ""
        if len(paragraph) <= max_chars:
            buffer = paragraph
            continue
        sentences = re.split(r"(?<=[.!?])\s+", paragraph)
        current = ""
        for sentence in sentences:
            if len(current) + len(sentence) + 1 <= max_chars:
                current = (current + " " + sentence).strip()
            else:
                if current:
                    chunks.append(current)
                current = sentence
        if current:
            buffer = current
    if buffer:
        chunks.append(buffer)
    return chunks


class KnowledgeBase(object):
    """Индекс BM25 по фрагментам документов."""

    def __init__(self, chunks):
        self.chunks = chunks
        self.doc_count = len(chunks)
        self.avg_length = (
            sum(len(chunk.tokens) for chunk in chunks) / self.doc_count if self.doc_count else 0
        )
        document_frequency = Counter()
        for chunk in chunks:
            for term in set(chunk.tokens):
                document_frequency[term] += 1
        self.document_frequency = document_frequency

    def idf(self, term):
        frequency = self.document_frequency.get(term, 0)
        return math.log(1 + (self.doc_count - frequency + 0.5) / (frequency + 0.5))

    def search(self, query, top_k=4, k1=1.5, b=0.75):
        query_tokens = tokenize(query)
        if not query_tokens:
            return []
        scored = []
        for chunk in self.chunks:
            length = len(chunk.tokens) or 1
            score = 0.0
            for term in query_tokens:
                frequency = chunk.term_freq.get(term, 0)
                if not frequency:
                    continue
                denominator = frequency + k1 * (1 - b + b * length / (self.avg_length or 1))
                score += self.idf(term) * frequency * (k1 + 1) / denominator
            if score > 0:
                scored.append((score, chunk))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return scored[:top_k]


def load_documents(docs_dir):
    """Читает все текстовые файлы из папки, возвращает (заголовок, путь, текст)."""
    documents = []
    for root, _dirs, files in os.walk(docs_dir):
        for name in sorted(files):
            if not name.lower().endswith(SUPPORTED_EXTENSIONS):
                continue
            path = os.path.join(root, name)
            with open(path, "r", encoding="utf-8") as file:
                text = file.read()
            title = name.rsplit(".", 1)[0].replace("_", " ").strip()
            documents.append((title, path, text))
    return documents


def build_index(docs_dir):
    documents = load_documents(docs_dir)
    chunks = []
    for title, path, text in documents:
        for index, piece in enumerate(split_into_chunks(text)):
            chunks.append(Chunk(title, path, index, piece))
    return KnowledgeBase(chunks), documents


def clean_sentence(text):
    """Убирает разметку markdown, оставляя читаемый текст."""
    text = re.sub(r"^[#>*\-\s]+", "", text)
    text = text.replace("**", "").replace("##", "").replace("#", "")
    return re.sub(r"\s+", " ", text).strip()


def candidate_sentences(chunk):
    """Разбирает фрагмент на предложения, пригодные для ответа.

    Предложения-вопросы отбрасываются: в базе знаний это заголовки разделов
    («Что делать, если товара нет в наличии?»), и в ответе они выглядят как шум.
    """
    candidates = []
    for line in chunk.text.split("\n"):
        line = clean_sentence(line)
        if len(line) < 30:
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", line):
            sentence = clean_sentence(sentence)
            if len(sentence) >= 30 and not sentence.endswith("?"):
                candidates.append(sentence)
    return candidates


CONTINUATION_STARTS = (
    "мы ", "это ", "также", "дополнительно", "либо", "или ", "при этом", "кроме того",
    "в этом случае", "тогда ", "после этого", "так ", "например", "если ",
)


def is_continuation(sentence):
    """Похоже ли предложение на продолжение предыдущей мысли, а не на новую тему."""
    lowered = sentence.lower()
    return any(lowered.startswith(marker) for marker in CONTINUATION_STARTS)


def rank_sentences(chunks, query, limit=3, idf=None, chunk_bonus=None):
    """Отбирает лучшие предложения из нескольких фрагментов.

    Два принципа, без которых ответ уходил не туда:
      1. Вес совпавшего слова считается по редкости (IDF): редкое «брак» важнее
         частого «товар».
      2. Фрагменты, стоящие выше в выдаче поиска, получают небольшую надбавку —
         но не настолько большую, чтобы перебить редкий термин из нижнего.
    """
    query_tokens = set(tokenize(query))
    if not query_tokens:
        return []

    def weight(token):
        if idf is None:
            return 1.0
        try:
            return max(idf(token), 0.1)
        except Exception:
            return 1.0

    weights = {token: weight(token) for token in query_tokens}
    bonuses = chunk_bonus or [1.0, 0.9, 0.8, 0.7, 0.6]
    scored = []
    seen = set()
    for chunk_order, chunk in enumerate(chunks):
        bonus = bonuses[min(chunk_order, len(bonuses) - 1)]
        for position, sentence in enumerate(candidate_sentences(chunk)):
            fingerprint = sentence[:70]
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            matched = set(tokenize(sentence)) & query_tokens
            if not matched:
                continue
            # Главный вес даёт САМЫЙ РЕДКИЙ совпавший термин: предложение про
            # «брак» важнее предложения, набитого частыми «товар» и «делать».
            rarity = max(weights[token] for token in matched)
            score = rarity * (1 + 0.04 * len(matched))
            score *= bonus
            scored.append((score, abs(len(sentence) - 170), chunk_order, position, sentence))

    if not scored:
        return []
    scored.sort(key=lambda item: (-item[0], item[1], item[2], item[3]))

    # Сначала берём главные предложения вместе с их продолжениями, и только потом
    # добираем остаток: иначе лимит заполняется раньше, чем подтянется вторая
    # половина мысли («...отправьте фотографии в поддержку.» + «Мы предложим замену...»).
    chosen = []
    used = set()

    def add_item(item, allow_continuation=True):
        sentence = item[4]
        if sentence in used or len(chosen) >= limit:
            return
        chosen.append(item)
        used.add(sentence)
        if not allow_continuation or len(chosen) >= limit:
            return
        following = candidate_sentences(chunks[item[2]])
        if item[3] + 1 < len(following):
            next_sentence = following[item[3] + 1]
            if is_continuation(next_sentence) and next_sentence not in used:
                chosen.append((item[0] * 0.99, item[1], item[2], item[3] + 1, next_sentence))
                used.add(next_sentence)

    for item in scored[: max(limit - 1, 1)]:
        add_item(item)
    for item in scored:
        if len(chosen) >= limit:
            break
        add_item(item, allow_continuation=False)

    chosen.sort(key=lambda item: (item[2], item[3]))   # вернуть в порядке чтения документа
    return [item[4] for item in chosen]


def best_sentences(chunk, query, limit=3, idf=None):
    """Экстрактивный ответ по одному фрагменту."""
    candidates = candidate_sentences(chunk)
    if not candidates:
        return clean_sentence(chunk.text)
    ranked = rank_sentences([chunk], query, limit=limit, idf=idf)
    return " ".join(ranked) if ranked else candidates[0]


if __name__ == "__main__":
    base, docs = build_index(os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs"))
    print("Документов: {}, фрагментов: {}".format(len(docs), len(base.chunks)))
    for question in ["сколько стоит доставка", "можно ли вернуть товар", "как оплатить"]:
        print("\nВопрос: {}".format(question))
        for score, chunk in base.search(question, top_k=2):
            print("  {:.2f}  {}".format(score, chunk.label))

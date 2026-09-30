/* ============================================================================
   Construct — логика лендинга.
   Всё на нативном JS, без библиотек. Блоки:
   1) подготовка страницы (классы-состояния, проверка стилей),
   2) липкая шапка, мобильное меню, подсветка активного раздела,
   3) плавный скролл по якорям,
   4) аккордеон «боль → что делаем»,
   5) анимация появления блоков и счётчиков,
   6) валидация формы и отправка заявки,
   7) кнопка «наверх», год в футере.
   ========================================================================== */

(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     КУДА ОТПРАВЛЯТЬ ЗАЯВКИ

     Пока оба поля пустые — лендинг работает в демо-режиме: заявка выводится
     в консоль браузера и показывается «Спасибо». Чтобы заявки приходили
     по-настоящему, заполните ОДИН из вариантов.

     1) Telegram-бот (самый быстрый способ):
        · создайте бота у @BotFather и скопируйте токен;
        · узнайте свой chat_id (например, у бота @userinfobot);
        · впишите ниже: telegram: { token: '123456789:AA...', chatId: '123456789' }

     2) Вебхук (Formspree, Getform, n8n или свой сервер):
        · webhook: 'https://formspree.io/f/xxxxxxx'

     Важно: отправка через fetch требует, чтобы страница была открыта
     по http/https. При открытии файла двойным кликом (file://) некоторые
     сервисы отклоняют запрос из-за происхождения «null» — проверяйте
     на опубликованной версии сайта.
     -------------------------------------------------------------------------- */
  var LEAD_CONFIG = {
    telegram: {
      token: '',
      chatId: ''
    },
    webhook: ''
  };

  /* --------------------------------------------------------------------------
     Настройки и ссылки на элементы
     -------------------------------------------------------------------------- */
  var header = document.getElementById('site-header');
  var mobileMenu = document.getElementById('mobile-menu');
  var burger = document.getElementById('burger');
  var toTop = document.getElementById('to-top');
  var leadForm = document.getElementById('lead-form');
  var formSuccess = document.getElementById('form-success');
  var formError = document.getElementById('form-error');
  var formReset = document.getElementById('form-reset');

  // Уважаем системную настройку «уменьшить движение»
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ==========================================================================
     1. ПОДГОТОВКА СТРАНИЦЫ
     ========================================================================== */

  // Класс включает анимации появления: если JS не выполнится, контент виден сразу
  document.documentElement.classList.add('js-ready');

  /**
   * Проверяем, применились ли стили Tailwind.
   * tailwind.css лежит рядом с index.html, но если файл не скопировали при
   * переносе проекта — вешаем tw-missing и включаем аварийный режим из style.css.
   */
  function checkTailwind() {
    var probe = document.createElement('div');
    probe.className = 'hidden';
    probe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(probe);
    var applied = window.getComputedStyle(probe).display === 'none';
    probe.remove();

    if (!applied) {
      document.documentElement.classList.add('tw-missing');
      console.warn('[Construct] Не найден tailwind.css: включён упрощённый режим отображения. Запустите bash tools/build-css.sh');
    }
  }

  /* ==========================================================================
     2. ШАПКА, МОБИЛЬНОЕ МЕНЮ, АКТИВНЫЙ РАЗДЕЛ
     ========================================================================== */

  /** Высота липкой шапки — нужна для подсветки разделов и плавного скролла. */
  function headerHeight() {
    if (!header) return 0;
    return window.getComputedStyle(header).position === 'fixed' ? header.offsetHeight : 0;
  }

  function openMenu() {
    if (!mobileMenu || !burger) return;
    mobileMenu.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Закрыть меню');
    document.getElementById('burger-open').classList.add('hidden');
    document.getElementById('burger-close').classList.remove('hidden');
  }

  function closeMenu() {
    if (!mobileMenu || !burger) return;
    mobileMenu.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Открыть меню');
    document.getElementById('burger-open').classList.remove('hidden');
    document.getElementById('burger-close').classList.add('hidden');
  }

  function toggleMenu() {
    if (mobileMenu && mobileMenu.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  if (burger) burger.addEventListener('click', toggleMenu);

  // Меню закрывается по Esc и при переходе на десктопную ширину
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 1024) closeMenu();
  });

  // Все ссылки внутри мобильного меню закрывают его после клика
  if (mobileMenu) {
    mobileMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
  }

  /** Подсвечиваем пункт меню, соответствующий текущему разделу. */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));

  function updateActiveNav() {
    if (!navLinks.length) return;
    var offset = headerHeight() + 120;
    var current = null;

    navLinks.forEach(function (link) {
      var section = document.querySelector(link.getAttribute('href'));
      if (section && section.getBoundingClientRect().top <= offset) current = link;
    });

    navLinks.forEach(function (link) {
      link.classList.toggle('is-active', link === current);
    });
  }

  /** Шапка получает тень после прокрутки, кнопка «наверх» — видимость. */
  function updateOnScroll() {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
    if (toTop) toTop.classList.toggle('is-visible', window.scrollY > 600);
    updateActiveNav();
  }

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* ==========================================================================
     3. ПЛАВНЫЙ СКРОЛЛ ПО ЯКОРЯМ (с учётом высоты шапки)
     ========================================================================== */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      var hash = link.getAttribute('href');
      if (!hash || hash === '#') return; // пустые ссылки не перехватываем

      var target = document.getElementById(hash.slice(1));
      if (!target) return;

      event.preventDefault();

      var top = target.getBoundingClientRect().top + window.scrollY - headerHeight() + 1;
      window.scrollTo({ top: Math.max(top, 0), behavior: reduceMotion ? 'auto' : 'smooth' });

      // Обновляем адресную строку, чтобы ссылку можно было скопировать
      try {
        history.replaceState(null, '', hash);
      } catch (error) {
        /* на file:// история может быть недоступна — это не критично */
      }
    });
  });

  /* ==========================================================================
     4. АККОРДЕОН
     Открыт всегда максимум один пункт: так пользователь читает последовательно.
     ========================================================================== */
  var accordionItems = Array.prototype.slice.call(document.querySelectorAll('[data-accordion]'));

  function setAccordionState(item, open) {
    var trigger = item.querySelector('.accordion-trigger');
    item.classList.toggle('is-open', open);
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  accordionItems.forEach(function (item) {
    var trigger = item.querySelector('.accordion-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', function () {
      var willOpen = !item.classList.contains('is-open');
      accordionItems.forEach(function (other) { setAccordionState(other, false); });
      setAccordionState(item, willOpen);
    });
  });

  // Первый пункт раскрыт сразу — чтобы блок не выглядел «пустым списком»
  if (accordionItems.length) setAccordionState(accordionItems[0], true);

  /* ==========================================================================
     5. ПОЯВЛЕНИЕ БЛОКОВ И АНИМАЦИЯ ЦИФР
     ========================================================================== */
  var revealItems = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealItems.forEach(function (item) { revealObserver.observe(item); });
  } else {
    // Фолбэк: показываем всё сразу
    revealItems.forEach(function (item) { item.classList.add('is-visible'); });
  }

  /** Плавный «набор» числа от 0 до data-count за ~1.4 секунды. */
  function animateCounter(element) {
    var target = parseInt(element.getAttribute('data-count'), 10) || 0;

    if (reduceMotion) {
      element.textContent = target;
      return;
    }

    var duration = 1400;
    var startedAt = null;

    function step(timestamp) {
      if (startedAt === null) startedAt = timestamp;
      var progress = Math.min((timestamp - startedAt) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      element.textContent = Math.round(target * eased);
      if (progress < 1) window.requestAnimationFrame(step);
    }

    window.requestAnimationFrame(step);
  }

  var counters = Array.prototype.slice.call(document.querySelectorAll('.counter'));

  if ('IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });

    counters.forEach(function (counter) { counterObserver.observe(counter); });
  } else {
    counters.forEach(function (counter) {
      counter.textContent = counter.getAttribute('data-count');
    });
  }

  /* ==========================================================================
     6. ФОРМА ЗАЯВКИ
     Отправки на сервер нет: показываем заглушку «Спасибо», как требует ТЗ.
     ========================================================================== */

  /** Лёгкая маска телефона для российских номеров: +7 (999) 123-45-67 */
  function formatPhone(value) {
    var digits = value.replace(/\D/g, '');

    // Приводим номер к формату 7XXXXXXXXXX
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    if (!digits.startsWith('7')) digits = '7' + digits;
    // Если номер вставили в уже заполненное поле, первая семёрка дублируется — убираем её
    if (digits.startsWith('77')) digits = '7' + digits.slice(2);
    digits = digits.slice(0, 11);

    var result = '+7';
    if (digits.length > 1) result += ' (' + digits.slice(1, 4);
    if (digits.length >= 5) result += ') ' + digits.slice(4, 7);
    if (digits.length >= 8) result += '-' + digits.slice(7, 9);
    if (digits.length >= 10) result += '-' + digits.slice(9, 11);
    return result;
  }

  var phoneInput = document.getElementById('phone');

  if (phoneInput) {
    phoneInput.addEventListener('input', function () {
      // Форматируем только если в поле есть цифры.
      // Поле намеренно не подставляем «+7 (» заранее: иначе вставка готового
      // номера склеивалась с шаблоном и номер портился.
      if (/\d/.test(phoneInput.value)) phoneInput.value = formatPhone(phoneInput.value);
    });
  }

  /** Показать/скрыть сообщение об ошибке под полем. */
  function setFieldError(field, hasError) {
    if (!field) return;
    var message = document.querySelector('[data-error-for="' + field.name + '"]');
    field.classList.toggle('input-invalid', hasError);
    field.setAttribute('aria-invalid', hasError ? 'true' : 'false');
    if (message) message.classList.toggle('is-visible', hasError);
  }

  /** Проверка одного поля. Возвращает true, если поле заполнено верно. */
  function validateField(field) {
    if (!field) return true;
    var value = (field.value || '').trim();
    var valid = true;

    switch (field.name) {
      case 'name':
        valid = value.length >= 2;
        break;
      case 'phone':
        valid = value.replace(/\D/g, '').length === 11;
        break;
      case 'email':
        // E-mail необязателен, но если указан — должен быть корректным
        valid = value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
        break;
      case 'consent':
        valid = field.checked;
        break;
      default:
        valid = true;
    }

    setFieldError(field, !valid);
    return valid;
  }

  /* --------------------------------------------------------------------------
     Отправка заявки
     -------------------------------------------------------------------------- */

  /** Куда отправлять заявку. null — демо-режим (никуда). */
  function leadEndpoint() {
    if (LEAD_CONFIG.telegram.token && LEAD_CONFIG.telegram.chatId) {
      return {
        type: 'telegram',
        url: 'https://api.telegram.org/bot' + LEAD_CONFIG.telegram.token + '/sendMessage'
      };
    }
    if (LEAD_CONFIG.webhook) {
      return { type: 'webhook', url: LEAD_CONFIG.webhook };
    }
    return null;
  }

  /** Текст заявки для сообщения в Telegram. */
  function leadMessage(data) {
    return [
      'Новая заявка с сайта Construct',
      'Имя: ' + data.name,
      'Телефон: ' + data.phone,
      data.email ? 'E-mail: ' + data.email : '',
      'Тип проекта: ' + data.project,
      data.task ? 'Задача: ' + data.task : ''
    ].filter(Boolean).join('\n');
  }

  /**
   * Отправить заявку. Возвращает промис с true (успех) или false (ошибка).
   * В демо-режиме ничего не отправляется, но результат тот же — успех.
   */
  function sendLead(data) {
    var endpoint = leadEndpoint();

    if (!endpoint) {
      console.log('[Construct] Демо-режим: заявка никуда не отправляется.', data);
      return Promise.resolve(true);
    }

    var request;
    if (endpoint.type === 'telegram') {
      request = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: LEAD_CONFIG.telegram.chatId,
          text: leadMessage(data),
          disable_web_page_preview: true
        })
      };
    } else {
      request = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      };
    }

    return fetch(endpoint.url, request)
      .then(function (response) { return response.ok; })
      .catch(function (error) {
        console.warn('[Construct] Не удалось отправить заявку:', error);
        return false;
      });
  }

  if (leadForm) {
    var fields = Array.prototype.slice.call(
      leadForm.querySelectorAll('input[name], textarea[name], select[name]')
    );
    var submitButton = leadForm.querySelector('button[type="submit"]');
    var submitLabel = submitButton ? submitButton.innerHTML : '';

    // Проверяем поле после того, как пользователь его заполнил
    fields.forEach(function (field) {
      field.addEventListener('blur', function () { validateField(field); });
      field.addEventListener('change', function () { validateField(field); });
      field.addEventListener('input', function () {
        if (field.classList.contains('input-invalid')) validateField(field);
      });
    });

    leadForm.addEventListener('submit', function (event) {
      event.preventDefault(); // страница статическая: отправляем сами через fetch

      if (formError) formError.classList.remove('is-visible');

      // Ловушка для спам-ботов: поле скрыто, живые люди его не заполняют
      var honeypot = leadForm.querySelector('input[name="company"]');
      if (honeypot && honeypot.value !== '') {
        console.warn('[Construct] Заявка отклонена как спам.');
        return;
      }

      var firstInvalid = null;
      fields.forEach(function (field) {
        var ok = validateField(field);
        if (!ok && !firstInvalid) firstInvalid = field;
      });

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      // Собираем данные заявки (поле-ловушку не отправляем)
      var data = {};
      fields.forEach(function (field) {
        if (field.name === 'company') return;
        data[field.name] = field.type === 'checkbox' ? field.checked : field.value.trim();
      });

      // Блокируем кнопку на время отправки: защита от двойных заявок
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.classList.add('opacity-60', 'cursor-wait');
        submitButton.innerHTML = 'Отправляем…';
      }

      sendLead(data).then(function (ok) {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.classList.remove('opacity-60', 'cursor-wait');
          submitButton.innerHTML = submitLabel;
        }

        if (!ok) {
          // Сервис или сеть подвели — не теряем клиента, показываем телефон
          if (formError) {
            formError.classList.add('is-visible');
            formError.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
          }
          return;
        }

        leadForm.classList.add('is-hidden');
        if (formSuccess) {
          formSuccess.classList.add('is-visible');
          formSuccess.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        }
      });
    });
  }

  // Кнопка «Отправить ещё одну заявку» возвращает форму
  if (formReset && leadForm && formSuccess) {
    formReset.addEventListener('click', function () {
      leadForm.reset();
      fields.forEach(function (field) { setFieldError(field, false); });
      formSuccess.classList.remove('is-visible');
      leadForm.classList.remove('is-hidden');
      var firstField = document.getElementById('name');
      if (firstField) firstField.focus();
    });
  }

  /* ==========================================================================
     7. МЕЛОЧИ: год в футере и первичный расчёт состояний
     ========================================================================== */
  var yearElement = document.getElementById('year');
  if (yearElement) yearElement.textContent = String(new Date().getFullYear());

  // Первый расчёт после загрузки страницы и дальше — по скроллу (через rAF)
  var scrollScheduled = false;
  window.addEventListener('scroll', function () {
    if (scrollScheduled) return;
    scrollScheduled = true;
    window.requestAnimationFrame(function () {
      updateOnScroll();
      scrollScheduled = false;
    });
  }, { passive: true });

  window.addEventListener('load', function () {
    checkTailwind();
    updateOnScroll();
  });

  updateOnScroll();
})();

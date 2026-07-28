/**
 * BOSTOM — приём заявок с сайта и отправка в Telegram.
 *
 * Cloudflare Worker. Бесплатный тариф: 100 000 запросов в сутки,
 * карта не нужна. Секреты хранятся в Cloudflare, в коде их нет.
 *
 * Секреты (ставятся командой `npx wrangler secret put <ИМЯ>`):
 *   BOT_TOKEN — токен бота от @BotFather
 *   CHAT_ID   — id чата/канала, куда падают заявки
 *
 * Переменная в wrangler.toml:
 *   ALLOWED_ORIGIN — домен сайта, только с него принимаем заявки
 */

const MAX = { name: 100, phone: 32, service: 80, msg: 1000 };

function cors(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Экранируем HTML, чтобы заявка не сломала разметку сообщения в Telegram. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clean(value, limit) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || '*';
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, headers);
    }
    // Чужой домен не может слать заявки от нашего имени
    if (allowed !== '*' && origin && origin !== allowed) {
      return json({ error: 'forbidden_origin' }, 403, headers);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: 'bad_json' }, 400, headers);
    }

    // Ловушка для ботов: люди это поле не видят
    if (clean(data.website, 50)) {
      return json({ ok: true }, 200, headers);   // молча гасим
    }

    const name = clean(data.name, MAX.name);
    const phone = clean(data.phone, MAX.phone);
    const service = clean(data.service, MAX.service);
    const msg = clean(data.msg, MAX.msg);

    const digits = phone.replace(/\D/g, '');
    if (!name || digits.length < 9 || digits.length > 15) {
      return json({ error: 'validation' }, 422, headers);
    }

    const when = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    const text =
      '<b>🦷 Нова заявка з сайту</b>\n\n' +
      `<b>Ім'я:</b> ${esc(name)}\n` +
      `<b>Телефон:</b> ${esc(phone)}\n` +
      `<b>Послуга:</b> ${esc(service || '—')}\n` +
      (msg ? `<b>Коментар:</b> ${esc(msg)}\n` : '') +
      `\n<i>${esc(when)}</i>`;

    const tg = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );

    if (!tg.ok) {
      // Тело ответа Telegram пишем в лог воркера, наружу не отдаём
      console.error('telegram_failed', tg.status, await tg.text());
      return json({ error: 'telegram_failed' }, 502, headers);
    }

    return json({ ok: true }, 200, headers);
  },
};

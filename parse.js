/* Сборка данных страницы из файлов базы.
   Повторяет шаг за шагом сборщик на Python, которым база собирается в одну страницу:
   те же разборы досье, карточек людей, цепочек писем, чатов и документов.
   Работает и в браузере (window.buildBase), и в Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.buildBase = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TYPES = ['Операторы', 'Клубные партнёры', 'Инвесторы и кредиторы', 'Консультанты'];
const ACTIVE = new Set(['ответ получен', 'звонок или встреча', 'предложение на руках', 'согласование условий', 'пауза']);
const FILTER = {'Операторы': 'operator', 'Клубные партнёры': 'club', 'Инвесторы и кредиторы': 'capital', 'Консультанты': 'consultant'};
const CONTACT_LABELS = ['Почта', 'WhatsApp', 'Telegram', 'LinkedIn'];
const COMPANIES = '02 Компании';
const TRANSLIT = Object.create(null);
'a b v g d e e zh z i y k l m n o p r s t u f h ts ch sh sch _ y _ e yu ya'.split(' ')
  .forEach((lat, i) => { TRANSLIT['абвгдеёжзийклмнопрстуфхцчшщъыьэюя'[i]] = lat === '_' ? '' : lat; });

/* Пробельные символы и границы строк — так, как их понимает Python. */
const WSC = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const W = '[' + WSC + ']', NW = '[^' + WSC + ']';
const EOL = '(?=\\n|(?![\\s\\S]))';          /* конец строки внутри текста */
const END = '(?=\\n?(?![\\s\\S]))';          /* конец всего текста */
const re = (src, flags) => new RegExp(src, flags || '');
const STRIP = re('^' + W + '+|' + W + '+$', 'g'), LSTRIP = re('^' + W + '+');
const strip = s => s.replace(STRIP, '');
const LINES = re('\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]');
const splitlines = s => {
  const a = s.split(LINES);
  if (a.length && a[a.length - 1] === '') a.pop();
  return a;
};
const splitN = (s, sep, n) => {
  const out = [];
  let rest = s;
  while (out.length < n) {
    const i = rest.indexOf(sep);
    if (i < 0) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
};
const all = (s, a, b) => s.split(a).join(b);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escHtml = s => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'}[c]));
const unesc = s => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m, e) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'"}[e]));
const quote = s => s.split('/').map(p => encodeURIComponent(p)
  .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
const unquote = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
const dirname = p => p.slice(0, p.lastIndexOf('/'));
const stem = p => p.slice(p.lastIndexOf('/') + 1).replace(/(.)\.[^.]*$/, '$1');

const H1 = re('^# ([^\\n]+)' + EOL, 'm');
const LETTER = re('^## (\\d+) · (\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2}) · ([^\\n]+?) → ([^\\n]+)' + EOL, 'gm');
const CHAT_DAY = re('^## (\\d{4}-\\d{2}-\\d{2})' + W + '*' + EOL, 'gm');
const CHAT_MSG = re('^\\*\\*(\\d{2}:\\d{2}) · ([^\\n]+?)\\*\\*' + W + '*' + EOL, 'gm');
const BULLET = re('^- \\*\\*([^\\n]+?):\\*\\* ([^\\n]+)' + EOL, 'gm');
const FIELD = re('^\\| \\*\\*([^\\n]+?)\\*\\* \\| ([^\\n]+?) \\|' + EOL, 'gm');
const LETTER_NO = re('·' + W + '*(\\d+)(?:' + W + '*[–-]' + W + '*\\d+)?' + W + '*' + END);
const LINK_ANGLE = /\[([^\]]+)\]\(<([^>]*)>\)/g;
const LINK_PLAIN = re('\\[([^\\]]+)\\]\\((?!<)([^)' + WSC + ']*)\\)', 'g');
const ANY_LINK = /\[[^\]]+\]\(<[^>]*>\)|\[[^\]]+\]\([^)]*\)/g;
const BARE_URL = re('https?://' + NW + '+', 'g');
const BACK = re('^← [^\\n]*' + EOL + '\\n?', 'gm');
const SIZE = '\\([^()]*(?:МБ|КБ|стр\\.)[^()]*\\)';
const SIZE_GET = re('\\(([^()]*(?:МБ|КБ|стр\\.)[^()]*)\\)' + W + '*' + END);
const SIZE_CUT = re(W + '*' + SIZE + W + '*' + END, 'g');
const CARD_LINK = re(W + '*·' + W + '*\\[[^\\]]+\\]\\(<[^>]*\\.md>\\)', 'g');
const WHERE_URL = re('https?://' + NW + '+' + W + '*(—' + W + '*)?', 'g');
const COPY = re(W + '*\\(копия:[^\\n]*\\)' + W + '*' + END);
const RULE_END = re('\\n---' + W + '*' + END);
const DUTY = re('^- \\*\\*(За ними|За нами):\\*\\*' + W + '*([^\\n]+)' + END);

function slug(text, limit) {
  let t = '';
  for (const ch of text.toLowerCase()) t += ch in TRANSLIT ? TRANSLIT[ch] : ch;
  t = t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t.slice(0, limit || 56).replace(/^-+|-+$/g, '') || 'x';
}

function route(ctx, prefix) {
  const parts = Array.prototype.slice.call(arguments, 2);
  const base = [prefix].concat(parts.map(p => slug(p))).join('-');
  let name = base, n = 2;
  while (ctx.used.has(name)) { name = base + '-' + n; n += 1; }
  ctx.used.add(name);
  return name;
}

const github = (ctx, path) => ctx.repoUrl + quote(path);

function letterNumber(label) {
  const m = LETTER_NO.exec(label);
  return m ? m[1] : '';
}

/* Адрес относительно папки -> путь от корня базы; null, если он выходит за базу. */
function joinPath(base, href) {
  if (href.charAt(0) === '/') return null;
  const parts = base ? base.split('/') : [];
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/') || '.';
}

/* Ссылки базы -> ссылки страницы: экраны — по имени, файлы — на GitHub. */
function fixLinks(ctx, fragment, base) {
  return fragment.replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (whole, h, inner) => {
    const href = unesc(h);
    const text = inner.replace(/<[^>]+>/g, '');
    if (/^(https?:|mailto:)/.test(href)) return '<a href="' + escHtml(href) + '" target="_blank" rel="noopener">' + inner + '</a>';
    if (href.charAt(0) === '#') return inner;
    const key = joinPath(base, unquote(href.split('#')[0]));
    if (key === null) return inner;
    if (ctx.routes.has(key)) {
      let name = ctx.routes.get(key);
      const n = letterNumber(unesc(text));
      if (name.indexOf('t-') === 0 && n) name = name + '-' + n;
      return '<a href="#' + name + '">' + inner + '</a>';
    }
    if (ctx.fs.exists(key)) return '<a href="' + escHtml(github(ctx, key)) + '" target="_blank" rel="noopener">' + inner + '</a>';
    return inner;
  });
}

function md(ctx, text, base, breaks) {
  let out = strip((breaks ? ctx.mdBreaks : ctx.md).render(strip(text)));
  out = all(all(out, '<table>', '<div class="tw"><table>'), '</table>', '</table></div>');
  return fixLinks(ctx, out, base);
}

function mdInline(ctx, text, base) {
  let out = md(ctx, text, base);
  if (out.indexOf('<p>') === 0 && out.slice(-4) === '</p>' && out.split('<p>').length === 2) out = out.slice(3, -4);
  return out;
}

const plain = text => strip(all(all(all(
  text.replace(/\[([^\]]+)\]\(<[^>]*>\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'), '**', ''), '`', ''), '\\_', '_'));

function links(text) {
  const found = [];
  for (const m of text.matchAll(LINK_ANGLE)) found.push([all(m[1], '\\_', '_'), m[2]]);
  for (const m of text.matchAll(LINK_PLAIN)) found.push([all(m[1], '\\_', '_'), m[2]]);
  for (const m of text.replace(ANY_LINK, '').matchAll(BARE_URL)) found.push(['', m[0].replace(/[.,;]+$/, '')]);
  return found;
}

function resolve(ctx, href, base) {
  if (/^https?:/.test(href)) return ['url', href];
  const key = joinPath(base, unquote(href.split('#')[0]));
  if (key === null) return ['none', ''];
  if (ctx.routes.has(key)) return ['route', ctx.routes.get(key)];
  if (ctx.fs.exists(key)) return ['file', github(ctx, key)];
  return ['none', ''];
}

const cellsOf = line => strip(line).replace(/^\|+|\|+$/g, '').split('|').map(strip);

function tableRows(text, width) {
  const rows = [];
  for (const line of splitlines(text)) {
    if (strip(line).charAt(0) !== '|') continue;
    const cells = cellsOf(line);
    if (cells.length === width && !/^[-: ]*$/.test(cells[0])) rows.push(cells);
  }
  return rows.slice(1);
}

const outsideTable = text => strip(splitlines(text).filter(l => strip(l).charAt(0) !== '|').join('\n'));

function bulletsHead(text) {
  const out = Object.create(null);
  for (const m of text.split('\n## ')[0].matchAll(BULLET)) out[m[1]] = m[2];
  return out;
}

function section(text, title) {
  const m = re('^## ' + escRe(title) + '\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))', 'm').exec(text);
  return m ? m[1] : '';
}

function parseDossier(text) {
  const fields = Object.create(null);
  for (const m of text.matchAll(FIELD)) fields[m[1]] = m[2];
  const history = [];
  for (const line of splitlines(section(text, 'История'))) {
    const cells = cellsOf(line);
    if (cells.length === 5 && /^\d{4}-\d{2}-\d{2}$/.test(cells[0])) history.push(cells);
  }
  const duties = splitlines(section(text, 'Обязательства')).map(strip).filter(l => l.indexOf('- ') === 0);
  return {name: strip(H1.exec(text)[1]), fields, history, duties};
}

function linkPeople(text, people) {
  let out = escHtml(text);
  const items = Array.from(people.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [name, r] of items) out = all(out, escHtml(name), '<a href="#' + r + '">' + escHtml(name) + '</a>');
  return out;
}

function parsePerson(ctx, path) {
  const text = ctx.fs.text(path), dir = dirname(path);
  const head = bulletsHead(text);
  const top = text.split('\n## ')[0];
  const intro = strip(splitlines(top).slice(1).filter(l => strip(l) && l.indexOf('- **') !== 0).join('\n'));
  const contacts = [];
  for (const label of CONTACT_LABELS) {
    if (head[label]) contacts.push({label, values: head[label].split(' · ').map(strip)});
  }
  const history = [];
  for (const line of splitlines(section(text, 'История общения'))) {
    if (line.indexOf('- ') !== 0) continue;
    const body = strip(line.slice(2));
    const parts = splitN(body, ' · ', 2).map(strip);
    const row = {dates: '', channel: '', title: '', note: '', route: '', html: ''};
    const found = links(body);
    if (parts.length === 3 && found.length) {
      const res = resolve(ctx, found[0][1], dir);
      const cut = parts[2].indexOf('>)');
      const after = cut >= 0 ? parts[2].slice(cut + 2) : '';
      row.dates = parts[0];
      row.channel = parts[1].slice(0, 1).toUpperCase() + parts[1].slice(1);
      row.title = found[0][0];
      row.note = strip(after) ? mdInline(ctx, strip(after.replace(/^[ —-]+/, '')), dir) : '';
      row.route = res[0] === 'route' ? res[1] : '';
    } else {
      row.html = mdInline(ctx, body, dir);
    }
    history.push(row);
  }
  return {id: ctx.routes.get(path), name: strip(H1.exec(text)[1]), position: head['Должность'] || '', contacts,
          intro: intro ? md(ctx, intro, dir) : '', bio: md(ctx, section(text, 'Биография'), dir), history};
}

function parseChat(ctx, path) {
  const text = ctx.fs.text(path);
  const t = H1.exec(text);
  const title = t ? strip(t[1]) : stem(path);
  const channel = bulletsHead(text)['Канал'] || title.split(' — ')[0];
  const messages = [];
  const days = Array.from(text.matchAll(CHAT_DAY));
  days.forEach((day, i) => {
    const block = text.slice(day.index + day[0].length, i + 1 < days.length ? days[i + 1].index : text.length);
    const marks = Array.from(block.matchAll(CHAT_MSG));
    marks.forEach((m, j) => {
      const body = strip(block.slice(m.index + m[0].length, j + 1 < marks.length ? marks[j + 1].index : block.length));
      messages.push({date: day[1], time: m[1], who: m[2], text: body});
    });
  });
  return {id: ctx.routes.get(path), title, channel: strip(channel), messages};
}

const later = (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]) || cmp(a[2], b[2]);

/* Последнее письмо и последнее сообщение в каждом мессенджере. */
function lastMessages(ctx, threads, chats, folder, people) {
  const out = [];
  let best = null;
  for (const t of threads) {
    t.letters.forEach((l, i) => {
      const key = [l.date, l.time, i];
      if (!best || later(key, best.key) > 0) best = {key, t, l};
    });
  }
  if (best) {
    out.push({channel: 'Почта', date: best.l.date, time: best.l.time, who: best.l.who.replace(COPY, ''),
              title: best.t.subject + ' · письмо ' + best.l.n, href: best.t.id + '-' + best.l.n, body: best.l.body});
  }
  const latest = new Map();
  for (const chat of chats) {
    chat.messages.forEach((m, i) => {
      const key = [m.date, m.time, i];
      if (!latest.has(chat.channel) || later(key, latest.get(chat.channel).key) >= 0) latest.set(chat.channel, {key, chat, m});
    });
  }
  for (const channel of Array.from(latest.keys()).sort(cmp)) {
    const {chat, m} = latest.get(channel);
    out.push({channel, date: m.date, time: m.time, who: linkPeople(m.who, people),
              title: chat.title, href: chat.id, body: md(ctx, m.text, folder, true)});
  }
  return out;
}

function parseThread(ctx, path, people) {
  const text = ctx.fs.text(path), dir = dirname(path);
  const head = bulletsHead(text);
  const top = text.split('\n## ')[0];
  const note = strip(splitlines(top).slice(1)
    .filter(l => strip(l) && l.indexOf('- **') !== 0 && strip(l) !== '---').join('\n'));
  const g = /\((https:\/\/mail\.google\.com\/[^)]+)\)/.exec(head['Тред Gmail'] || '');
  const letters = [];
  const marks = Array.from(text.matchAll(LETTER));
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const body = strip(strip(text.slice(m.index + m[0].length, end)).replace(RULE_END, ''));
    letters.push({n: m[1], date: m[2], time: m[3], who: linkPeople(m[4] + ' → ' + m[5], people),
                  body: md(ctx, body, dir, true)});
  });
  const item = {id: ctx.routes.get(path), subject: strip(H1.exec(text)[1]), path, github: github(ctx, path),
                gmail: g ? g[1] : '', letters,
                participants: linkPeople(head['Участники'] || '', people),
                attachments: head['Вложения'] ? mdInline(ctx, head['Вложения'], dir) : '',
                note: note ? md(ctx, note, dir) : ''};
  if (!letters.length) item.page = md(ctx, text.slice(text.indexOf('\n') + 1), dir);
  return item;
}

const mdNames = (fs, dir) => fs.list(dir).filter(n => n.slice(-3) === '.md').sort(cmp);

function parseCompany(ctx, dossier, kind) {
  const fs = ctx.fs, folder = dirname(dossier);
  const text = fs.text(dossier);
  const d = parseDossier(text);
  const fields = d.fields;

  const people = [], peopleRoutes = new Map();
  const peopleSection = section(text, 'Действующие лица');
  for (const cells of tableRows(peopleSection, 6)) {
    const found = links(cells[0]);
    if (!found.length) continue;
    const target = joinPath(folder, found[0][1]);
    if (target !== null && fs.exists(target)) {
      const person = parsePerson(ctx, target);
      people.push(person);
      peopleRoutes.set(person.name, person.id);
    }
  }

  const history = d.history.map(row => {
    const found = links(row[4]);
    const label = found.length ? found[0][0] : plain(row[4]);
    const href = found.length ? found[0][1] : '';
    const res = href ? resolve(ctx, href, folder) : ['none', ''];
    const n = letterNumber(label);
    if (res[0] === 'route' && res[1].indexOf('t-') === 0 && n) res[1] = res[1] + '-' + n;
    return {date: row[0], channel: row[1], dir: row[2], title: label, gist: mdInline(ctx, row[3], folder),
            kind: res[0], href: res[1]};
  });

  const docs = [];
  const docsSection = section(text, 'Документы');
  for (const cells of tableRows(docsSection, 4)) {
    const doc = cells[0], where = cells[3];
    const item = {title: '', from: cells[1], date: cells[2], size: '', where: '', card: '', file: '', url: ''};
    for (const pair of links(doc).concat(links(where))) {
      const res = resolve(ctx, pair[1], folder);
      if (res[0] === 'route' && !item.card) item.card = res[1];
      else if (res[0] === 'file' && !item.file) { item.file = res[1]; item.title = item.title || pair[0]; }
      else if (res[0] === 'url' && !item.url) item.url = res[1];
    }
    const cell = plain(doc.replace(CARD_LINK, ''));
    const m = SIZE_GET.exec(cell);
    if (m) item.size = m[1];
    item.title = item.title || cell.replace(SIZE_CUT, '');
    item.where = strip(plain(where).replace(WHERE_URL, ''));
    docs.push(item);
  }

  const duties = [];
  for (const line of d.duties) {
    const m = DUTY.exec(line);
    if (m) duties.push({side: m[1] === 'За нами' ? 'us' : 'them', html: mdInline(ctx, m[2], folder)});
  }

  const about = strip(splitlines(section(text, 'О компании')).filter(l => l.indexOf('Справка о компании') < 0).join('\n'));
  const brief = folder + '/Справка о компании.md';
  const mail = folder + '/Переписка/Почта', chatDir = folder + '/Переписка/Мессенджеры';
  const threads = mdNames(fs, mail).filter(n => n !== 'README.md').map(n => parseThread(ctx, mail + '/' + n, peopleRoutes));
  const chats = mdNames(fs, chatDir).filter(n => n !== 'README.md').map(n => parseChat(ctx, chatDir + '/' + n));
  const pages = [];
  for (const [sub, label] of [['Документы', 'Документы'], ['Переписка/Мессенджеры', 'Мессенджеры'], ['Встречи и звонки', 'Встречи и звонки']]) {
    for (const n of mdNames(fs, folder + '/' + sub)) {
      if (n === 'README.md') continue;
      const p = folder + '/' + sub + '/' + n;
      const body = fs.text(p);
      const title = H1.exec(body);
      const rest = body.indexOf('\n') >= 0 ? body.slice(body.indexOf('\n') + 1) : '';
      pages.push({id: ctx.routes.get(p), title: title ? strip(title[1]) : stem(p), group: label, path: p,
                  github: github(ctx, p), html: md(ctx, rest.replace(BACK, ''), dirname(p), label === 'Мессенджеры')});
    }
  }

  const last = fields['Последний контакт'] || '', stage = fields['Стадия'] || '';
  let briefItem = null;
  if (fs.exists(brief)) {
    const body = fs.text(brief);
    briefItem = {id: ctx.routes.get(brief), html: md(ctx, body.slice(body.indexOf('\n') + 1).replace(BACK, ''), folder),
                 path: brief, github: github(ctx, brief)};
  }
  return {
    id: ctx.routes.get(dossier), name: d.name, kind, filter: FILTER[kind] || '',
    type: fields['Тип'] || '', stage, active: ACTIVE.has(stage),
    last, lastDate: last.slice(0, 10), next: mdInline(ctx, fields['Следующий шаг'] || '', folder),
    about: md(ctx, about, folder), brief: briefItem,
    people, peopleNote: md(ctx, outsideTable(peopleSection), folder),
    history, docs, docsNote: md(ctx, outsideTable(docsSection), folder),
    terms: md(ctx, section(text, 'Их условия'), folder),
    lastMessages: lastMessages(ctx, threads, chats, folder, peopleRoutes),
    duties, threads, pages, path: dossier, github: github(ctx, dossier),
  };
}

/* Сначала раздаём имена экранам, чтобы ссылки между файлами находили друг друга. */
function register(ctx) {
  const fs = ctx.fs, found = [];
  for (const kind of TYPES) {
    const kdir = COMPANIES + '/' + kind;
    if (!fs.isDir(kdir)) continue;
    const names = fs.list(kdir).filter(n => fs.isFile(kdir + '/' + n + '/Досье.md')).sort(cmp);
    for (const cname of names) {
      const folder = kdir + '/' + cname, dossier = folder + '/Досье.md';
      ctx.routes.set(dossier, route(ctx, 'c', cname));
      const cid = ctx.routes.get(dossier).slice(2);
      const brief = folder + '/Справка о компании.md';
      if (fs.exists(brief)) ctx.routes.set(brief, route(ctx, 's', cid));
      for (const n of mdNames(fs, folder + '/Люди')) ctx.routes.set(folder + '/Люди/' + n, route(ctx, 'p', cid, stem(n)));
      for (const n of mdNames(fs, folder + '/Переписка/Почта')) {
        if (n === 'README.md') continue;
        const p = folder + '/Переписка/Почта/' + n;
        const m = /\*\*Тред Gmail:\*\* `([0-9a-f]+)`/.exec(fs.text(p));
        ctx.routes.set(p, m ? route(ctx, 't', m[1]) : route(ctx, 't', cid, stem(n)));
      }
      for (const [sub, prefix] of [['Документы', 'd'], ['Переписка/Мессенджеры', 'm'], ['Встречи и звонки', 'v']]) {
        for (const n of mdNames(fs, folder + '/' + sub)) {
          if (n !== 'README.md') ctx.routes.set(folder + '/' + sub + '/' + n, route(ctx, prefix, cid, stem(n)));
        }
      }
      found.push([dossier, kind]);
    }
  }
  return found;
}

/* fs: {exists, isFile, isDir, list, text} — файлы базы, пути от её корня.
   opts: {repo: 'владелец/имя', built: 'ГГГГ-ММ-ДД ЧЧ:ММ', markdownit: библиотека markdown-it}. */
function build(fs, opts) {
  const lib = opts.markdownit;
  const ctx = {fs, routes: new Map(), used: new Set(), repoUrl: 'https://github.com/' + opts.repo + '/blob/main/',
               md: lib('commonmark', {html: false}).enable('table'),
               mdBreaks: lib('commonmark', {html: false, breaks: true}).enable('table')};
  const companies = register(ctx).map(pair => parseCompany(ctx, pair[0], pair[1]));
  return {built: opts.built, repo: 'https://github.com/' + opts.repo, kinds: TYPES, companies};
}

/* Какие файлы нужно прочитать целиком: тексты из папки компаний, кроме заглушек README. */
build.wants = path => path.indexOf(COMPANIES + '/') === 0 && path.slice(-3) === '.md' && path.slice(-10) !== '/README.md';
return build;
});

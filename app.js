/* Скрипт показа. Собран из шаблона оформления: руками не правится. */
window.startApp = function (DATA) {
const page = document.getElementById('page');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MONTHS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const BUILT_YEAR = DATA.built.slice(0, 4);
const KIND_FILTER = {operator:'Оператор', club:'Клуб', capital:'Капитал', consultant:'Консультант'};
const state = {filter:'active', hist:'all', histAll:{}, q:''};

function fmtDate(iso, withYear){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const s = (+m[3]) + ' ' + MONTHS[+m[2] - 1];
  return (withYear || m[1] !== BUILT_YEAR) ? s + ' ' + m[1] : s;
}
const fmtDates = text => String(text || '').replace(/\d{4}-\d{2}-\d{2}/g, d => fmtDate(d));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const textOf = h => new DOMParser().parseFromString(h || '', 'text/html').body.textContent || '';

/* Экраны по именам */
const R = {};
DATA.companies.forEach(c => {
  R[c.id] = {type:'company', c};
  if (c.brief) R[c.brief.id] = {type:'brief', c};
  c.people.forEach(p => { R[p.id] = {type:'person', c, p}; });
  c.threads.forEach(t => { R[t.id] = {type:'thread', c, t}; });
  c.pages.forEach(g => { R[g.id] = {type:'page', c, g}; });
});
function parseHash(){
  let h = location.hash.slice(1);
  try { h = decodeURIComponent(h); } catch (e) {}
  if (h === 'journal' || h === 'duties') return {type:h};
  if (R[h]) return R[h];
  const m = /^(t-.+)-(\d+)$/.exec(h);
  if (m && R[m[1]]) return Object.assign({letter:m[2]}, R[m[1]]);
  return {type:'home'};
}

/* Оформление каналов и стадий */
function chan(ch){
  const k = String(ch || '').toLowerCase();
  if (k === 'почта') return {cls:'blue', group:'mail'};
  if (k === 'whatsapp' || k === 'telegram' || k === 'мессенджер') return {cls:'teal', group:'msg'};
  if (k === 'встреча' || k === 'звонок') return {cls:'violet', group:'meet'};
  if (k === 'документ') return {cls:'', group:'doc'};
  return {cls:'', group:'other'};
}
const stageCls = c => c.active ? 'blue' : '';
const lastText = c => {
  const parts = String(c.last || '').split(' · ');
  return parts.length > 1 ? fmtDate(parts[0], true) + ', ' + parts.slice(1).join(' · ') : fmtDate(c.last, true);
};
const docFrom = d => d.from === 'от них' ? 'Получен от них' : d.from === 'от нас' ? 'Отправлен нами' : cap(d.from);
const docSub = d => [docFrom(d), /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? fmtDate(d.date, true) : d.date, d.size, d.where].filter(Boolean).join(' · ');

/* Контакты */
function contactValue(label, v){
  const e = esc(v);
  if (label === 'Почта' && /^[^\s@]+@[^\s@]+$/.test(v)) return `<a href="mailto:${e}">${e}</a>`;
  if (label === 'WhatsApp' && /^\+[\d\s()-]+$/.test(v)) return `<a href="https://wa.me/${v.replace(/\D/g, '')}" target="_blank" rel="noopener">${e}</a>`;
  if (label === 'Telegram' && /^@[\w]+$/.test(v)) return `<a href="https://t.me/${esc(v.slice(1))}" target="_blank" rel="noopener">${e}</a>`;
  if (/^https?:\/\//.test(v)) return `<a href="${e}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`;
  return e;
}
const firstOf = (p, label) => { const c = p.contacts.find(x => x.label === label); return c ? c.values[0] : ''; };

/* Меню компаний */
function visibleCompanies(){
  return DATA.companies.filter(c => state.filter === 'all' ? true : state.filter === 'active' ? c.active : c.filter === state.filter)
    .sort((a, b) => a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0);
}
function firstInMenu(){
  const list = visibleCompanies();
  for (const kind of DATA.kinds) { const c = list.find(x => x.kind === kind); if (c) return c; }
  return list[0] || DATA.companies[0];
}
function side(current){
  const chips = [['active','Активные']].concat(Object.entries(KIND_FILTER)).concat([['all','Все']])
    .map(([k, t]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${t}</button>`).join('');
  const list = visibleCompanies();
  const groups = DATA.kinds.map(kind => {
    const rows = list.filter(c => c.kind === kind);
    if (!rows.length) return '';
    return `<div class="group"><h2>${esc(kind)}</h2>${rows.map(c =>
      `<a class="co" href="#${c.id}"${current && current.id === c.id ? ' aria-current="page"' : ''}><b>${esc(c.name)}</b><span>${esc(cap(c.stage))}</span></a>`).join('')}</div>`;
  }).join('');
  return `<nav class="side" aria-label="Компании"><div class="chips">${chips}</div>${groups || '<p class="empty">Компаний пока нет.</p>'}</nav>`;
}

/* Строки истории */
function historyRows(c){
  const rows = c.history.map(h => ({date:h.date, channel:h.channel, title:h.title,
    sub:esc(cap(h.dir)) + ' · ' + h.gist, href:h.kind === 'route' ? '#' + h.href : h.href, ext:h.kind !== 'route'}));
  c.docs.forEach(d => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date) && (d.from === 'от них' || d.from === 'от нас')) rows.push({date:d.date, channel:'Документ', title:d.title,
      sub:esc([docFrom(d), d.size, d.card ? 'есть карточка' : ''].filter(Boolean).join(' · ')),
      href:d.card ? '#' + d.card : (d.file || d.url || ''), ext:!d.card});
  });
  return rows.map((r, i) => [r, i]).sort((a, b) => a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : a[1] - b[1]).map(x => x[0]);
}
function hrow(r, withCompany){
  const k = chan(r.channel);
  const link = r.href ? `<a class="open" href="${esc(r.href)}"${r.ext ? ' target="_blank" rel="noopener"' : ''}>Открыть</a>` : '';
  return `<li><div class="hrow"><span class="d">${fmtDate(r.date)}</span><span class="pill sm ${k.cls}">${esc(r.channel)}</span>
    <div class="t"><b>${withCompany ? esc(withCompany) + ' · ' : ''}${esc(r.title)}</b><span>${r.sub}</span></div>${link}</div></li>`;
}

/* Досье компании */
function dossier(c){
  const people = c.people.map(p => {
    const contacts = p.contacts.length
      ? p.contacts.map(x => `<li><span class="k">${esc(x.label)}</span><span class="v">${x.values.map(v => contactValue(x.label, v)).join(' · ')}</span></li>`).join('')
      : '<li><span class="k">Проверенных контактов пока нет</span></li>';
    return `<article class="person"><div class="who"><a href="#${p.id}">${esc(p.name)}</a><span>${esc(p.position)}</span></div>
      <ul class="contacts">${contacts}</ul><a class="more" href="#${p.id}">Биография и история общения</a></article>`;
  }).join('');
  const plist = c.people.map(p => {
    const mail = firstOf(p, 'Почта'), wa = firstOf(p, 'WhatsApp');
    const acts = (/^[^\s@]+@[^\s@]+$/.test(mail) ? `<a href="mailto:${esc(mail)}" aria-label="Написать письмо: ${esc(p.name)}"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path></svg></a>` : '')
      + (/^\+[\d\s()-]+$/.test(wa) ? `<a href="https://wa.me/${wa.replace(/\D/g, '')}" target="_blank" rel="noopener" aria-label="Написать в WhatsApp: ${esc(p.name)}"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L4 20.5l1.1-4.4A8.5 8.5 0 1 1 21 12z"></path></svg></a>` : '');
    return `<li><a class="who" href="#${p.id}"><b>${esc(p.name)}</b><span>${esc(p.position)}</span></a>${acts ? `<div class="acts">${acts}</div>` : ''}</li>`;
  }).join('');

  const all = historyRows(c);
  const shown = all.filter(r => state.hist === 'all' || chan(r.channel).group === state.hist);
  const limit = state.histAll[c.id] ? shown.length : 10;
  const histChips = [['all','Всё'],['mail','Почта'],['msg','Мессенджеры'],['meet','Встречи и звонки'],['doc','Документы']]
    .map(([k, t]) => `<button type="button" class="chip" data-hist="${k}" aria-pressed="${state.hist === k}">${t}</button>`).join('');
  const emptyHist = {msg:'Выгрузок чатов по этой компании ещё не было.', meet:'Сюда попадают только встречи и звонки, у которых есть запись. Пока их нет.'}[state.hist] || 'Записей нет.';

  const docs = c.docs.map(d => `<li><div class="drow"><div class="t"><b>${esc(d.title)}</b><span>${esc(docSub(d))}</span></div>
    ${d.card ? `<a class="open" href="#${d.card}">Карточка</a>` : ''}
    ${d.file ? `<a class="open" href="${esc(d.file)}" target="_blank" rel="noopener">Оригинал</a>` : ''}
    ${d.url ? `<a class="open" href="${esc(d.url)}" target="_blank" rel="noopener">Открыть по ссылке</a>` : ''}</div></li>`).join('');

  const last = c.lastMessages.map(m => `<article class="lastmsg">
      <div class="lmeta"><span class="pill sm ${chan(m.channel).cls}">${esc(m.channel)}</span><span class="n">${fmtDate(m.date, true)}, ${esc(m.time)}</span><span class="w">${m.who}</span></div>
      <p class="sub">${esc(m.title)} · <a href="#${esc(m.href)}">Открыть ${m.channel === 'Почта' ? 'цепочку' : 'чат'}</a></p>
      <div class="prose">${m.body}</div></article>`).join('');

  const duties = c.duties.map(u => `<li><div class="urow"><span class="pill sm ${u.side === 'us' ? 'amber' : ''}">${u.side === 'us' ? 'За нами' : 'За ними'}</span><span class="x">${u.html}</span></div></li>`).join('');

  return `
  <section class="card head" aria-label="Шапка досье">
    <div class="title"><h1>${esc(c.name)}</h1><div class="pills"><span class="pill">${esc(c.type)}</span><span class="pill ${stageCls(c)}">${esc(cap(c.stage))}</span></div></div>
    <div class="fields">
      <div class="field wideonly"><span class="label">Последний контакт</span><span>${esc(lastText(c))}</span></div>
      <div class="field"><span class="label">Следующий шаг</span><span>${c.next}</span></div>
    </div>
  </section>
  <section class="card" aria-labelledby="about-title">
    <h2 id="about-title">О компании</h2>
    <div class="prose">${c.about}</div>
    ${c.brief ? `<div class="row"><a class="btn" href="#${c.brief.id}">Открыть справку о компании</a></div>` : ''}
  </section>
  <section class="card" aria-labelledby="people-title">
    <h2 id="people-title">Действующие лица</h2>
    ${c.people.length ? `<div class="people">${people}</div><ul class="rows plist">${plist}</ul>` : '<p class="empty">Пока никого.</p>'}
    ${c.peopleNote ? `<div class="prose dim">${c.peopleNote}</div>` : ''}
  </section>
  <section class="card" aria-labelledby="history-title">
    <h2 id="history-title">История</h2>
    <div class="chips scroll">${histChips}</div>
    ${shown.length ? `<ol class="rows">${shown.slice(0, limit).map(r => hrow(r)).join('')}</ol>` : `<p class="empty">${emptyHist}</p>`}
    ${shown.length > limit ? `<button type="button" class="more" data-more="${c.id}">Показать более ранние записи</button>` : ''}
  </section>
  <section class="card" aria-labelledby="docs-title">
    <h2 id="docs-title">Документы</h2>
    ${docs ? `<ul class="rows">${docs}</ul>` : '<p class="empty">Документов пока нет.</p>'}
    ${c.docsNote ? `<div class="prose dim">${c.docsNote}</div>` : ''}
  </section>
  <div class="cols">
    <section class="card half" aria-labelledby="terms-title">
      <h2 id="terms-title">Их условия</h2>
      <div class="prose">${c.terms || '<p class="empty">Пока не записаны.</p>'}</div>
    </section>
    <section class="card half" aria-labelledby="last-title">
      <h2 id="last-title">Последние сообщения</h2>
      ${last || '<p class="empty">Сообщений пока нет.</p>'}
    </section>
  </div>
  <section class="card" aria-labelledby="promises-title">
    <h2 id="promises-title">Обязательства</h2>
    ${duties ? `<ul class="rows">${duties}</ul>` : '<p class="empty">Записей нет.</p>'}
  </section>
  <p class="foot">Файл в базе: <a href="${esc(c.github)}" target="_blank" rel="noopener">${esc(c.path.split('/').join(' / '))}</a></p>`;
}
function viewCompanies(r){
  const c = r.c || firstInMenu();
  return `<div class="layout">${side(c)}<main class="main">${c ? dossier(c) : '<p class="empty">В базе пока нет компаний.</p>'}</main></div>`;
}

/* Путь */
const crumbs = items => `<nav class="crumbs" aria-label="Путь">${items.map((it, i) =>
  (i ? '<span aria-hidden="true">/</span>' : '') + (it[1] ? `<a href="${it[1]}">${esc(it[0])}</a>` : `<span${i === items.length - 1 ? ' aria-current="page"' : ''}>${esc(it[0])}</span>`)).join('')}</nav>`;

/* Карточка человека */
function viewPerson(r){
  const c = r.c, p = r.p;
  const contacts = p.contacts.map(x => `<li><span class="label">${esc(x.label)}</span>${x.values.map(v => `<span class="v">${contactValue(x.label, v)}</span>`).join('')}</li>`).join('');
  const rows = p.history.map(h => {
    if (h.html) return `<li><div class="hrow"><div class="t"><span>${h.html}</span></div></div></li>`;
    const k = chan(h.channel);
    return `<li><div class="hrow"><span class="d">${esc(fmtDates(h.dates))}</span><span class="pill sm ${k.cls}">${esc(h.channel)}</span>
      <div class="t"><b>${esc(h.title)}</b>${h.note ? `<span>${h.note}</span>` : ''}</div>${h.route ? `<a class="open" href="#${h.route}">Открыть</a>` : ''}</div></li>`;
  }).join('');
  return `<main class="main">
  ${crumbs([['Компании', '#companies'], [c.name, '#' + c.id], [p.name]])}
  <section class="card phead" aria-label="Шапка карточки">
    <div class="id"><h1>${esc(p.name)}</h1><span>${p.position ? esc(p.position) + ' · ' : ''}<a href="#${c.id}" style="font-weight:500">${esc(c.name)}</a></span>${p.intro ? `<div class="prose dim">${p.intro}</div>` : ''}</div>
    ${contacts ? `<ul class="pcontacts" aria-label="Контакты">${contacts}</ul>` : '<p class="sub">Проверенных контактов пока нет.</p>'}
  </section>
  <div class="cols">
    <section class="card c2 narrowrows" aria-labelledby="person-history-title">
      <div class="stack"><h2 id="person-history-title">История общения</h2><p class="sub">Только записи с участием этого человека.</p></div>
      ${rows ? `<ol class="rows">${rows}</ol>` : '<p class="empty">Записей пока нет.</p>'}
    </section>
    <section class="card c1" aria-labelledby="bio-title">
      <h2 id="bio-title">Биография</h2>
      <div class="prose">${p.bio || '<p class="empty">Пока не собрана.</p>'}</div>
    </section>
  </div></main>`;
}

/* Переписка */
function viewThread(r){
  const c = r.c, t = r.t;
  if (t.page) return viewPage({c, g:{title:t.subject, group:'Почта', html:t.page, path:t.path, github:t.github}});
  const first = t.letters[0], last = t.letters[t.letters.length - 1];
  const when = first ? (first.date === last.date ? fmtDate(first.date, true) : fmtDate(first.date, true) + ' — ' + fmtDate(last.date, true)) : '';
  const letters = t.letters.map(l => `<li id="l-${l.n}"><div class="lmeta"><span class="n">${l.n} · ${fmtDate(l.date, true)}, ${l.time}</span><span class="w">${l.who}</span></div><div class="prose">${l.body}</div></li>`).join('');
  const related = [`<li><a href="#${c.id}">Досье компании</a></li>`].concat(c.people.map(p => `<li><a href="#${p.id}">${esc(p.name)}, карточка</a></li>`)).join('');
  return `<main class="main">
  ${crumbs([['Компании', '#companies'], [c.name, '#' + c.id], ['Почта'], [when]])}
  <section class="card head" aria-label="Шапка записи">
    <div class="title"><h1>${esc(t.subject)}</h1><div class="pills"><span class="pill blue">Почта</span></div></div>
    <div class="fields">
      <div class="field"><span class="label">Когда</span><span>${esc(when)}</span></div>
      <div class="field"><span class="label">Писем</span><span>${t.letters.length}</span></div>
      <div class="field" style="flex-basis:320px"><span class="label">Участники</span><span style="overflow-wrap:anywhere">${t.participants}</span></div>
      ${t.attachments ? `<div class="field" style="flex-basis:320px"><span class="label">Вложения</span><span style="overflow-wrap:anywhere">${t.attachments}</span></div>` : ''}
    </div>
  </section>
  <div class="cols">
    <div class="wide">
      <section class="card" aria-labelledby="letters-title">
        <div class="stack"><h2 id="letters-title">Переписка</h2>${t.note ? `<div class="prose dim">${t.note}</div>` : ''}</div>
        <ol class="rows letters">${letters}</ol>
      </section>
    </div>
    <aside class="narrow">
      <section class="card" aria-labelledby="source-title">
        <h2 id="source-title">Источник</h2>
        <dl class="src">
          ${t.gmail ? `<div><dt class="label">Почта</dt><dd><a href="${esc(t.gmail)}" target="_blank" rel="noopener">Открыть цепочку в Gmail</a></dd></div>` : ''}
          <div><dt class="label">Файл в базе</dt><dd><a href="${esc(t.github)}" target="_blank" rel="noopener">${esc(t.path.split('/').join(' / '))}</a></dd></div>
        </dl>
      </section>
      <section class="card" aria-labelledby="related-title" style="gap:8px">
        <h2 id="related-title">Связано</h2>
        <ul class="links">${related}</ul>
      </section>
    </aside>
  </div></main>`;
}

/* Справка, карточка документа и прочие страницы из базы */
function viewPage(r){
  const c = r.c, g = r.g;
  const doc = g.id ? c.docs.find(d => d.card === g.id) : null;
  const orig = doc && (doc.file || doc.url);
  return `<main class="main">
  ${crumbs([['Компании', '#companies'], [c.name, '#' + c.id], [g.group], [g.title]])}
  <section class="card head"><div class="title"><h1>${esc(g.title)}</h1><div class="pills"><span class="pill">${esc(g.group)}</span></div></div>
    ${orig ? `<div class="row"><a class="btn" href="${esc(orig)}" target="_blank" rel="noopener">Открыть оригинал</a></div>` : ''}
    <div class="prose">${g.html}</div></section>
  <p class="foot">Файл в базе: <a href="${esc(g.github)}" target="_blank" rel="noopener">${esc(g.path.split('/').join(' / '))}</a></p></main>`;
}
const viewBrief = r => viewPage({c:r.c, g:{title:'Справка о компании · ' + r.c.name, group:'Справка', html:r.c.brief.html, path:r.c.brief.path, github:r.c.brief.github}});

/* Журнал и обязательства по всем компаниям */
function viewJournal(){
  const rows = [];
  DATA.companies.forEach(c => historyRows(c).forEach(r => { if (chan(r.channel).group !== 'doc') rows.push([r, c]); }));
  rows.sort((a, b) => a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : 0);
  let out = '', month = '';
  rows.forEach(([r, c]) => {
    const m = r.date.slice(0, 7);
    if (m !== month){
      if (month) out += '</ol>';
      month = m;
      out += `<h3 class="month">${MONTHS_FULL[+m.slice(5) - 1]} ${m.slice(0, 4)}</h3><ol class="rows">`;
    }
    out += hrow(r, c.name);
  });
  if (month) out += '</ol>';
  return `<main class="main"><section class="card"><div class="stack"><h2>Журнал контактов</h2><p class="sub">Все записи истории по всем компаниям, новые сверху.</p></div>${out || '<p class="empty">Записей нет.</p>'}</section></main>`;
}
function viewDuties(){
  const cards = DATA.companies.map(c => {
    const rows = c.duties.map(u => `<li><div class="urow"><span class="pill sm ${u.side === 'us' ? 'amber' : ''}">${u.side === 'us' ? 'За нами' : 'За ними'}</span><span class="x">${u.html}</span></div></li>`).join('');
    return `<section class="card"><h2><a href="#${c.id}">${esc(c.name)}</a></h2>${rows ? `<ul class="rows">${rows}</ul>` : '<p class="empty">Записей нет.</p>'}</section>`;
  }).join('');
  return `<main class="main">${cards || '<p class="empty">Записей нет.</p>'}</main>`;
}

/* Поиск */
let INDEX = null;
function buildIndex(){
  INDEX = [];
  const add = (kind, title, sub, href, text, ext) => INDEX.push({kind, title, sub, href, ext, text, low:(title + ' ' + text).toLowerCase()});
  DATA.companies.forEach(c => {
    add('Компания', c.name, cap(c.stage), '#' + c.id, [textOf(c.about), textOf(c.next), textOf(c.terms)].join(' '));
    if (c.brief) add('Справка', 'Справка о компании', c.name, '#' + c.brief.id, textOf(c.brief.html));
    c.people.forEach(p => add('Человек', p.name, [p.position, c.name].filter(Boolean).join(' · '), '#' + p.id,
      [p.position, p.contacts.map(x => x.values.join(' ')).join(' '), textOf(p.bio)].join(' ')));
    c.threads.forEach(t => {
      t.letters.forEach(l => add('Письмо', t.subject + ' · ' + l.n, [c.name, fmtDate(l.date, true), textOf(l.who)].join(' · '), '#' + t.id + '-' + l.n, textOf(l.body)));
      if (t.page) add('Почта', t.subject, c.name, '#' + t.id, textOf(t.page));
    });
    c.pages.forEach(g => add(g.group === 'Документы' ? 'Документ' : g.group, g.title, c.name, '#' + g.id, textOf(g.html)));
    c.docs.forEach(d => { if (!d.card) add('Документ', d.title, [c.name, docSub(d)].join(' · '), d.file || d.url || '#' + c.id, d.where || '', !!(d.file || d.url)); });
  });
}
function snippet(text, token){
  const i = text.toLowerCase().indexOf(token);
  if (i < 0) return esc(text.slice(0, 160)) + (text.length > 160 ? '…' : '');
  const from = Math.max(0, i - 60), to = Math.min(text.length, i + token.length + 110);
  return (from ? '…' : '') + esc(text.slice(from, i)) + '<mark>' + esc(text.slice(i, i + token.length)) + '</mark>' + esc(text.slice(i + token.length, to)) + (to < text.length ? '…' : '');
}
function viewSearch(q){
  if (!INDEX) buildIndex();
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = INDEX.filter(x => tokens.every(t => x.low.indexOf(t) >= 0));
  const rows = hits.slice(0, 60).map(x => `<li><div class="hrow"><span class="pill sm">${esc(x.kind)}</span>
    <div class="t"><b>${esc(x.title)}</b><span>${esc(x.sub)}</span><span>${snippet(x.text, tokens[0])}</span></div>
    <a class="open" data-result href="${esc(x.href)}"${x.ext ? ' target="_blank" rel="noopener"' : ''}>Открыть</a></div></li>`).join('');
  return `<main class="main"><section class="card"><div class="stack"><h2>Поиск: ${esc(q)}</h2>
    <p class="sub">${hits.length ? 'Найдено: ' + hits.length + (hits.length > 60 ? ', показаны первые 60' : '') : 'Ничего не найдено. Поиск идёт по компаниям, людям, письмам и карточкам документов.'}</p></div>
    ${rows ? `<ol class="rows">${rows}</ol>` : ''}</section></main>`;
}

/* Сборка экрана */
function chrome(r, searching){
  const tab = searching ? '' : (r.type === 'journal' || r.type === 'duties') ? r.type : 'companies';
  document.querySelectorAll('[data-tab]').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.body.className = searching ? '' : r.type === 'company' ? 'is-company' : r.type === 'home' ? 'is-list' : '';
  let back = '';
  if (!searching && r.type === 'company') back = ['Компании', '#companies'];
  else if (!searching && r.c) back = [r.c.name, '#' + r.c.id];
  document.getElementById('mtop').innerHTML = (back
    ? `<a class="back" href="${back[1]}"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg><span>${esc(back[0])}</span></a>`
    : '<span class="brand">' + esc(DATA.repo.split('/').pop()) + '</span>')
    + '<button type="button" id="msbtn" aria-label="Поиск"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg></button>';
}
function render(keepScroll){
  const r = parseHash();
  const y = window.scrollY;
  const q = state.q.trim();
  if (q) page.innerHTML = viewSearch(q);
  else if (r.type === 'person') page.innerHTML = viewPerson(r);
  else if (r.type === 'thread') page.innerHTML = viewThread(r);
  else if (r.type === 'page') page.innerHTML = viewPage(r);
  else if (r.type === 'brief') page.innerHTML = viewBrief(r);
  else if (r.type === 'journal') page.innerHTML = viewJournal();
  else if (r.type === 'duties') page.innerHTML = viewDuties();
  else page.innerHTML = viewCompanies(r);
  chrome(r, !!q);
  if (keepScroll) { window.scrollTo(0, y); return; }
  const hit = !q && r.letter ? document.getElementById('l-' + r.letter) : null;
  if (hit) { hit.classList.add('hit'); hit.scrollIntoView({block:'start'}); }
  else window.scrollTo(0, 0);
}
function clearSearch(){
  state.q = '';
  document.getElementById('q').value = '';
  document.getElementById('mq').value = '';
  document.getElementById('msearch').classList.remove('on');
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-filter],[data-hist],[data-more],[data-result],#msbtn,[data-tab],.brand');
  if (!el) return;
  if (el.dataset.filter) { state.filter = el.dataset.filter; render(true); }
  else if (el.dataset.hist) { state.hist = el.dataset.hist; render(true); }
  else if (el.dataset.more) { state.histAll[el.dataset.more] = true; render(true); }
  else if (el.id === 'msbtn') {
    const box = document.getElementById('msearch');
    box.classList.toggle('on');
    if (box.classList.contains('on')) document.getElementById('mq').focus(); else if (state.q) { clearSearch(); render(); }
  }
  else if (state.q) {          /* переход из результатов поиска или по разделам закрывает поиск */
    const href = el.getAttribute('href') || '';
    const willChange = href.charAt(0) === '#' && href !== location.hash && el.target !== '_blank';
    clearSearch();
    if (!willChange) render();
  }
});
['q', 'mq'].forEach(id => document.getElementById(id).addEventListener('input', e => {
  state.q = e.target.value;
  const other = document.getElementById(id === 'q' ? 'mq' : 'q');
  if (other.value !== state.q) other.value = state.q;
  render();
}));
window.addEventListener('hashchange', () => render());

(function(){
  const d = DATA.built.split(' ');
  document.getElementById('updated').textContent = 'Обновлено ' + fmtDate(d[0], true) + ' в ' + d[1];
})();
render();
};

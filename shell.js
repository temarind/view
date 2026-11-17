/* Вход по ключу, чтение базы прямо из GitHub и кэш в браузере.
   Данных базы в этом файле нет: страница получает их с ключом пользователя и хранит только в его браузере. */
(function () {
'use strict';

const API = 'https://api.github.com';
const KEY = 'base-view';
const $ = id => document.getElementById(id);

/* ——— ключ и кэш ——— */

function loadCreds() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
}

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(KEY, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('blobs'); r.result.createObjectStore('meta'); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }).catch(() => null);
  }
  return dbPromise;
}
const done = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

async function cacheGet(store, key) {
  const d = await db();
  if (!d) return undefined;
  try { return await done(d.transaction(store).objectStore(store).get(key)); } catch (e) { return undefined; }
}

async function cachePut(store, entries) {
  const d = await db();
  if (!d || !entries.length) return;
  try {
    const tx = d.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    for (const pair of entries) s.put(pair[1], pair[0]);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
  } catch (e) { /* без кэша страница работает, только медленнее */ }
}

async function cachedTexts() {
  const out = new Map();
  const d = await db();
  if (!d) return out;
  try {
    const s = d.transaction('blobs').objectStore('blobs');
    const both = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
    both[0].forEach((k, i) => out.set(k, both[1][i]));
  } catch (e) { /* пустой кэш */ }
  return out;
}

async function cachePrune(keep) {
  const d = await db();
  if (!d) return;
  try {
    const s = d.transaction('blobs', 'readwrite').objectStore('blobs');
    for (const k of await done(s.getAllKeys())) if (!keep.has(k)) s.delete(k);
  } catch (e) { /* не страшно */ }
}

/* Стирает из браузера и ключ, и сохранённую копию базы. */
async function wipe() {
  localStorage.removeItem(KEY);
  const d = await db();
  if (d) d.close();
  dbPromise = null;
  await new Promise(resolve => {
    try {
      const r = indexedDB.deleteDatabase(KEY);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch (e) { resolve(); }
  });
}

/* ——— запросы к GitHub ——— */

function problem(message, extra) { return Object.assign(new Error(message), extra); }

async function gh(creds, path, init) {
  init = init || {};
  const headers = Object.assign({Authorization: 'Bearer ' + creds.token, Accept: 'application/vnd.github+json'}, init.headers);
  let r;
  try {
    r = await fetch(API + path, {method: init.method || 'GET', body: init.body, headers, cache: 'no-store'});
  } catch (e) {
    throw problem('Нет связи с GitHub.', {offline: true});
  }
  if (r.status === 401) throw problem('Ключ не подходит или его срок истёк.', {access: true, status: 401});
  if (r.status === 404) throw problem('Репозиторий не найден, или у ключа нет к нему доступа.', {access: true, status: 404});
  if (r.status === 403 || r.status === 429) {
    const text = await r.text().catch(() => '');
    if (/rate limit/i.test(text)) throw problem('GitHub временно ограничил число запросов. Попробуйте через несколько минут.', {status: r.status});
    throw problem('GitHub отказал в доступе. Проверьте права ключа: нужно Contents — Read-only.', {access: true, status: r.status});
  }
  if (!r.ok) throw problem('GitHub ответил ошибкой ' + r.status + '.', {status: r.status});
  return r;
}

async function head(creds) {
  const j = await (await gh(creds, '/repos/' + creds.repo + '/commits/' + encodeURIComponent(creds.branch))).json();
  return {sha: j.sha, date: j.commit.committer.date};
}

async function pool(items, width, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({length: Math.min(width, items.length)}, worker));
}

/* Тексты файлов пачками через GraphQL; если GitHub так не отдаёт — по одному через REST. */
async function fetchTexts(creds, shas, tick) {
  const out = new Map();
  const parts = creds.repo.split('/');
  let graph = true;
  const batches = [];
  for (let i = 0; i < shas.length; i += 50) batches.push(shas.slice(i, i + 50));
  await pool(batches, 3, async batch => {
    const got = new Map();
    if (graph) {
      try {
        const query = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){' +
          batch.map((s, i) => 'b' + i + ':object(oid:"' + s + '"){...on Blob{text isTruncated}}').join(' ') + '}}';
        const r = await gh(creds, '/graphql', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                              body: JSON.stringify({query, variables: {o: parts[0], n: parts[1]}})});
        const j = await r.json();
        const repo = j.data && j.data.repository;
        if (!repo) throw new Error('graphql');
        batch.forEach((s, i) => { const b = repo['b' + i]; if (b && typeof b.text === 'string' && !b.isTruncated) got.set(s, b.text); });
      } catch (e) {
        if (e.status === 401) throw e;
        graph = false;          /* пачками не вышло (запрет, сбой, отказ браузера) — дальше по одному файлу */
      }
    }
    await pool(batch.filter(s => !got.has(s)), 6, async s => {
      const r = await gh(creds, '/repos/' + creds.repo + '/git/blobs/' + s, {headers: {Accept: 'application/vnd.github.raw+json'}});
      got.set(s, await r.text());
    });
    got.forEach((v, k) => out.set(k, v));
    tick(got.size);
  });
  return out;
}

const two = n => String(n).padStart(2, '0');
function bali(iso) {          /* время последнего изменения базы — по Бали */
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate()) + ' ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes());
}

/* Читает базу на состояние h и собирает данные страницы. Скачивает только то, чего ещё нет в кэше. */
async function sync(creds, h) {
  say('Читаю список файлов…');
  const t = await (await gh(creds, '/repos/' + creds.repo + '/git/trees/' + h.sha + '?recursive=1')).json();
  if (t.truncated) throw problem('База слишком велика, чтобы прочитать её одним списком.');
  const files = new Set(), dirs = new Set(['.']), kids = new Map(), shaOf = new Map();
  for (const e of t.tree) {
    const cut = e.path.lastIndexOf('/');
    const dir = cut < 0 ? '' : e.path.slice(0, cut);
    if (!kids.has(dir)) kids.set(dir, []);
    kids.get(dir).push(e.path.slice(cut + 1));
    if (e.type === 'tree') dirs.add(e.path); else { files.add(e.path); shaOf.set(e.path, e.sha); }
  }
  const wanted = Array.from(files).filter(window.buildBase.wants);
  const wantedShas = new Set(wanted.map(p => shaOf.get(p)));
  const texts = await cachedTexts();
  const need = Array.from(wantedShas).filter(s => !texts.has(s));
  if (need.length) {
    let got = 0;
    say('Загружаю базу: 0 из ' + need.length + ' файлов', 0, need.length);
    const fresh = await fetchTexts(creds, need, n => {
      got += n;
      say('Загружаю базу: ' + got + ' из ' + need.length + ' файлов', got, need.length);
    });
    fresh.forEach((v, k) => texts.set(k, v));
    await cachePut('blobs', Array.from(fresh));
  }
  say('Собираю страницу…');
  await new Promise(resolve => setTimeout(resolve, 0));
  const fs = {
    exists: p => files.has(p) || dirs.has(p),
    isFile: p => files.has(p),
    isDir: p => dirs.has(p),
    list: d => kids.get(d) || [],
    text: p => {
      const v = texts.get(shaOf.get(p));
      if (typeof v !== 'string') throw problem('Файл базы не загрузился: ' + p);
      return v;
    },
  };
  const data = window.buildBase(fs, {repo: creds.repo, built: bali(h.date), markdownit: window.markdownit});
  await cachePut('meta', [['current', {repo: creds.repo, commit: h.sha, data}]]);
  cachePrune(wantedShas);
  return data;
}

/* ——— экран ——— */

function show(id) {
  for (const name of ['wait', 'login', 'app-root']) $(name).hidden = name !== id;
}

function say(text, value, max) {
  $('wait-msg').textContent = text;
  const bar = $('wait-bar');
  bar.hidden = !max;
  if (max) { bar.max = max; bar.value = value; }
}

function askKey(message) {
  show('login');
  $('login-msg').textContent = message || '';
  $('login-go').disabled = false;
  ($('repo').value ? $('token') : $('repo')).focus();
}

function fail(message, retry) {
  show('wait');
  say(message);
  const again = $('wait-retry');
  again.hidden = false;
  again.onclick = () => { again.hidden = true; retry(); };
}

let shown = '', lastCheck = 0, started = false;

function start(creds, data, sha, note) {
  shown = sha;
  lastCheck = Date.now();
  const name = creds.repo.split('/')[1];
  document.title = 'Досье ' + name;
  const brand = document.querySelector('.brand');
  if (brand) brand.textContent = name;
  $('sync-note').textContent = note || '';
  show('app-root');
  if (!started) { started = true; window.startApp(data); }
}

async function boot(creds) {
  show('wait');
  say('Открываю…');
  const saved = await cacheGet('meta', 'current');
  const mine = saved && saved.repo === creds.repo ? saved : null;
  let h;
  try {
    h = await head(creds);
  } catch (e) {
    if (e.access) { await wipe(); return askKey(e.message); }
    if (mine) return start(creds, mine.data, mine.commit, 'Нет связи: показана сохранённая копия.');
    return fail(e.message, () => boot(creds));
  }
  try {
    const data = mine && mine.commit === h.sha ? mine.data : await sync(creds, h);
    start(creds, data, h.sha, '');
  } catch (e) {
    if (e.access) { await wipe(); return askKey(e.message); }
    if (mine) return start(creds, mine.data, mine.commit, 'Обновить не удалось: показана сохранённая копия. ' + e.message);
    fail(e.message, () => boot(creds));
  }
}

$('login').addEventListener('submit', async e => {
  e.preventDefault();
  const repo = $('repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const token = $('token').value.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) { $('login-msg').textContent = 'Репозиторий пишется так: владелец/название.'; return; }
  if (!token) { $('login-msg').textContent = 'Вставьте ключ.'; return; }
  $('login-msg').textContent = 'Проверяю ключ…';
  $('login-go').disabled = true;
  try {
    const info = await (await gh({token}, '/repos/' + repo)).json();
    const creds = {repo: info.full_name, token, branch: info.default_branch};
    localStorage.setItem(KEY, JSON.stringify(creds));
    $('token').value = '';
    boot(creds);
  } catch (err) {
    $('login-msg').textContent = err.message;
    $('login-go').disabled = false;
  }
});

$('refresh').addEventListener('click', () => location.reload());
$('bar-btn').addEventListener('click', () => location.reload());

let sure = 0;
$('logout').addEventListener('click', async e => {
  if (Date.now() - sure > 4000) {          /* первое нажатие — переспросить, второе — выйти */
    sure = Date.now();
    e.target.textContent = 'Точно выйти?';
    setTimeout(() => { e.target.textContent = 'Выйти'; }, 4000);
    return;
  }
  await wipe();
  location.reload();
});

/* Вернулись на вкладку — проверяем, не изменилась ли база. */
document.addEventListener('visibilitychange', async () => {
  const creds = loadCreds();
  if (document.visibilityState !== 'visible' || !shown || !creds || Date.now() - lastCheck < 60000) return;
  lastCheck = Date.now();
  try {
    const h = await head(creds);
    if (h.sha !== shown) { $('bar-msg').textContent = 'База обновилась.'; $('bar').hidden = false; }
  } catch (e) {
    if (e.access) { await wipe(); location.reload(); }
  }
});

const creds = loadCreds();
if (creds && creds.repo && creds.token && creds.branch) boot(creds); else askKey('');
})();

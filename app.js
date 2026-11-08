(() => {
  'use strict';
  const app = document.getElementById('app');

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)mixcloud\.com$/.test(x.hostname) ? x.href : ''; } catch { return ''; } };
  const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const norm = s => {
    let x = fold(s);
    x = x.replace(/[([][^)\]]*[)\]]/g, ' ');
    x = x.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, ' ');
    x = x.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the\s/, '');
    return x;
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${MONTHS[+m - 1]} ${+d}, ${y}`; };
  const fmtDur = m => m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
  const num = n => (n ?? 0).toLocaleString('en');
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
  const hl = (text, q) => {
    const s = esc(text);
    if (!q) return s;
    const f = fold(text), i = f.indexOf(q);
    if (i < 0) return s;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const tsSec = ts => { if (!ts) return null; const p = String(ts).split(':').map(Number); return p.some(isNaN) ? null : p.reduce((n, x) => n * 60 + x, 0); };
  const fmtTs = sec => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const searchIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const playIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l15 8-15 8z"/></svg>';
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- data ----------
  let DB;
  function build(raw) {
    const shows = raw.shows, showById = new Map(), tracks = [], songs = new Map(), artists = new Map();
    for (const s of shows) {
      showById.set(s.id, s);
      s.year = +s.date.slice(0, 4);
      s.url = safeUrl(s.url);
      s.cover = /^https:\/\//.test(s.cover || '') ? s.cover : '';
      s.search = fold(s.name + ' ' + (s.tags || []).join(' '));
      s.items = s.tracks.map((t, i) => ({ type: t[0], artist: t[1], title: t[2], ts: t[3], pos: i + 1, show: s }));
      const tl = s.items.filter(t => t.type === 'track');
      s.nTracks = tl.length;
      tl.forEach((t, i) => {
        t.prev = tl[i - 1] || null; t.next = tl[i + 1] || null;
        t.key = norm(t.artist) + '|' + norm(t.title);
        let g = songs.get(t.key);
        if (!g) { g = { key: t.key, artist: t.artist, title: t.title, plays: [] }; songs.set(t.key, g); }
        g.plays.push(t); t.song = g; tracks.push(t);
        const ak = norm(t.artist);
        if (!ak) return;
        let a = artists.get(ak);
        if (!a) { a = { key: ak, name: t.artist, plays: [], shows: new Set(), songs: new Set() }; artists.set(ak, a); }
        a.plays.push(t); a.shows.add(s.id); a.songs.add(t.key);
      });
    }
    for (const g of songs.values()) {
      g.count = g.plays.length; g.search = fold(g.artist + ' ' + g.title);
      g.first = g.plays[0].show.date; g.last = g.plays[g.plays.length - 1].show.date;
    }
    for (const a of artists.values()) {
      a.count = a.plays.length; a.search = fold(a.name);
      a.first = a.plays[0].show.date; a.last = a.plays[a.plays.length - 1].show.date;
    }
    const years = [...new Set(shows.map(s => s.year))].sort((a, b) => b - a);
    const cats = [...new Set(shows.map(s => s.category))].sort();
    const hours = Math.round(shows.reduce((n, s) => n + (s.duration || 0), 0) / 60);
    return { raw, shows, showById, tracks, songs, artists, years, cats, hours };
  }

  // ---------- routing ----------
  function parse() {
    const h = location.hash.replace(/^#\/?/, '') || 'home';
    const [path, qs] = h.split('?');
    return { parts: path.split('/').map(decodeURIComponent), params: new URLSearchParams(qs || '') };
  }
  const setTab = name => document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === name));
  const replaceParams = (base, obj) => {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => { if (v) p.set(k, v); });
    const s = p.toString();
    history.replaceState(null, '', `#/${base}${s ? '?' + s : ''}`);
  };
  function render() {
    if (!DB) return;
    const { parts: [p0, p1], params } = parse();
    window.scrollTo(0, 0);
    if (p0 === 'show' && p1) { setTab('shows'); return viewShow(+p1); }
    if (p0 === 'song' && p1) { setTab('songs'); return viewSong(p1); }
    if (p0 === 'artist' && p1) { setTab('artists'); return viewArtist(p1); }
    if (p0 === 'shows') { setTab('shows'); return viewShows(params); }
    if (p0 === 'songs') { setTab('songs'); return viewSongs(params); }
    if (p0 === 'artists') { setTab('artists'); return viewArtists(params); }
    if (p0 === 'dig') { setTab('dig'); return viewDig(); }
    setTab('home'); return viewHome();
  }

  // ---------- player (Mixcloud widget) ----------
  const Player = (() => {
    const bar = document.getElementById('player');
    let show = null, widget = null, apiPromise = null;
    const loadApi = () => apiPromise || (apiPromise = new Promise((ok, ko) => {
      const sc = document.createElement('script'); sc.src = 'https://widget.mixcloud.com/media/js/widgetApi.js'; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc);
    }));
    const msg = t => { const m = document.getElementById('pl-msg'); if (m) m.textContent = t || ''; };
    const wait = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
    function track(pos) {
      if (!show || location.hash.indexOf('#/show/' + show.id) !== 0) return;
      const rows = [...document.querySelectorAll('#app tr[data-sec]')];
      let cur = null;
      for (const r of rows) if (+r.dataset.sec <= pos + 1) cur = r;
      rows.forEach(r => r.classList.toggle('now', r === cur));
      const now = document.getElementById('pl-now');
      if (now) now.textContent = cur ? ' · ' + cur.dataset.label : '';
    }
    function close() { show = widget = null; bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('has-player'); }
    async function open(s, sec = 0) {
      if (!s.url) return;
      if (show && show.id === s.id && widget) return seek(sec);
      show = s; widget = null;
      bar.hidden = false; document.body.classList.add('has-player');
      bar.innerHTML = `
        <div class="wrap pl-inner">
          <div class="pl-meta"><div class="eyebrow">Now spinning<span id="pl-now"></span></div>
            <a class="pl-name" href="#/show/${s.id}">${esc(s.name)}</a></div>
          <div class="pl-slot" id="pl-slot"></div>
          <button class="pl-close" aria-label="Close player" title="Close">×</button>
        </div>
        <div class="wrap pl-msg" id="pl-msg"></div>`;
      bar.querySelector('.pl-close').onclick = close;
      const ifr = document.createElement('iframe');
      ifr.title = 'Mixcloud player'; ifr.allow = 'autoplay; encrypted-media'; ifr.height = 60; ifr.width = '100%';
      ifr.src = `https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&autoplay=1&feed=${encodeURIComponent(new URL(s.url).pathname)}`;
      document.getElementById('pl-slot').appendChild(ifr);
      msg('Dropping the needle…');
      try {
        await loadApi();
        const w = window.Mixcloud.PlayerWidget(ifr);
        await w.ready;
        if (show !== s) return;
        widget = w;
        w.events.progress.on(track);
        msg('');
        wait(w.play(), 3000);
        if (sec) {
          for (let i = 0; i < 20; i++) { if (await wait(w.getIsPaused(), 1500) === false) break; await new Promise(r => setTimeout(r, 500)); }
          await seek(sec);
        }
      } catch (e) { msg('The Mixcloud player could not load here. Use “Listen on Mixcloud” instead.'); }
    }
    async function seek(sec) {
      if (!widget) return;
      msg('Jumping to ' + fmtTs(sec) + '…');
      try {
        await wait(widget.play(), 3000);
        let ok = false;
        for (let i = 0; i < 12 && !ok; i++) {
          const allowed = await widget.seek(sec);
          await new Promise(r => setTimeout(r, 900));
          ok = allowed && Math.abs((await widget.getPosition()) - sec) < 8;
          if (!ok && !allowed && i > 6) break;
        }
        msg(ok ? '' : 'Mixcloud did not allow jumping here. Use the progress bar in the player.');
      } catch (e) { msg('Could not jump to this moment.'); }
    }
    return { open, seek, close, current: () => show };
  })();

  // ---------- building blocks ----------
  const PAL = ['var(--red)', 'var(--teal)', 'var(--blue)', '#b8730a', 'var(--ink)'];
  const shortName = s => s.name.replace(/^funky corners( show)?\s*/i, '').replace(/^#\d+\s*/, '').replace(/^[\s\-–|:]*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*/, '').replace(/^[\s\-–|:]+/, '') || 'Weekly show';
  const numLabel = s => s.number != null ? '#' + s.number : s.category;
  function art(s, lazy = true) {
    if (s.cover) return `<img src="${esc(s.cover)}" alt="Cover of ${esc(s.name)}" data-id="${s.id}" ${lazy ? 'loading="lazy"' : ''}>`;
    return genArt(s);
  }
  function genArt(s) {
    return `<div class="gen" style="background:${PAL[(s.number ?? s.id) % PAL.length]}"><span class="gn">${esc(s.number ?? '★')}</span><span class="gt">Funky Corners<br>${esc(fmtDate(s.date))}</span></div>`;
  }
  function sleeve(s, opts = {}) {
    return `<a class="sleeve" href="#/show/${s.id}">
      <div class="art">${art(s, !opts.eager)}${s.number != null ? `<span class="num">#${s.number}</span>` : ''}</div>
      ${opts.noMeta ? '' : `<div class="meta"><b>${esc(shortName(s))}</b><span>${esc(fmtDate(s.date))} · ${s.nTracks ? plural(s.nTracks, 'track') : 'no tracklist'}</span></div>`}
    </a>`;
  }
  const songLink = g => `<a href="#/song/${encodeURIComponent(g.key)}">${esc(g.title)}</a>`;
  const artistLink = name => { const k = norm(name); return k && DB.artists.has(k) ? `<a href="#/artist/${encodeURIComponent(k)}">${esc(name)}</a>` : esc(name); };
  const showLink = s => `<a href="#/show/${s.id}">${esc(numLabel(s))} · ${esc(fmtDate(s.date))}</a>`;
  function notFound(what) {
    app.innerHTML = `<div class="page-head"><h1>Wrong groove</h1><p>That ${esc(what)} is not in the crates. <a href="#/home">Back home</a>.</p></div>`;
  }

  // ---------- home ----------
  function viewHome() {
    const shows = DB.shows, latest = shows[shows.length - 1];
    const topArtists = [...DB.artists.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    const topSongs = [...DB.songs.values()].filter(g => g.count > 1).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)).slice(0, 10);
    app.innerHTML = `
      <section class="hero">
        <div>
          <div class="eyebrow">Albany, NY · Fridays 5:15am ET · since 2011</div>
          <h1>Funky<span class="l2">Corners</span></h1>
          <p class="tagline"><b>Return of the B-Boy Style.</b> Classic &amp; underground rap, funk, breaks, the samples and the records that sampled them. Every show, every record, searchable.</p>
          <div class="stamps">
            <div class="stamp"><b>${num(shows.length)}</b><span>shows</span></div>
            <div class="stamp"><b>${num(DB.tracks.length)}</b><span>records spun</span></div>
            <div class="stamp"><b>${num(DB.artists.size)}</b><span>artists</span></div>
            <div class="stamp"><b>${num(DB.hours)}</b><span>hours</span></div>
          </div>
        </div>
        <div>
          <label class="eyebrow" for="q">Dig for a song, an artist, a show</label>
          <div class="search">${searchIcon}<input id="q" type="search" placeholder="Try “Pete Rock”, “Apache”, “#700”…" autocomplete="off"></div>
          <div class="results" id="res"></div>
        </div>
      </section>

      <section class="sec">
        <div class="sec-head"><h2>Latest drop</h2><a class="more" href="#/shows">All shows →</a></div>
        <div class="drop panel">
          ${sleeve(latest, { noMeta: true, eager: true })}
          <div>
            <div class="eyebrow">${esc(numLabel(latest))} · ${esc(fmtDate(latest.date))} · ${esc(fmtDur(latest.duration))}</div>
            <h3>${esc(shortName(latest))}</h3>
            <div class="chips">${(latest.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
            ${latest.items.length ? `<ol class="muted" style="margin:0;padding-left:22px;columns:2 220px">${latest.items.filter(t => t.type === 'track').slice(0, 10).map(t => `<li>${esc(t.artist)} – ${esc(t.title)}</li>`).join('')}</ol>` : ''}
            <div class="btns"><button class="btn" data-play="${latest.id}">${playIcon} Play</button><a class="btn alt" href="#/show/${latest.id}">Tracklist</a></div>
          </div>
        </div>
      </section>

      <section class="sec">
        <div class="sec-head"><h2>Fresh out the crate</h2></div>
        <div class="crate">${shows.slice(-10).reverse().slice(1).map(s => sleeve(s)).join('')}</div>
      </section>

      <section class="sec cols">
        <div>
          <div class="sec-head"><h2>Heavy rotation</h2><a class="more" href="#/songs?sort=plays">More →</a></div>
          ${topSongs.length ? `<ul class="rows">${topSongs.map((g, i) => `<li><span class="rank">${i + 1}</span><span class="main">${songLink(g)}<span class="sub">${esc(g.artist)}</span></span><span class="big">${g.count}×</span></li>`).join('')}</ul>` : '<p class="muted">Every song played only once so far.</p>'}
        </div>
        <div>
          <div class="sec-head"><h2>Most spun artists</h2><a class="more" href="#/artists">More →</a></div>
          <ul class="rows">${topArtists.map((a, i) => `<li><span class="rank">${i + 1}</span><span class="main"><a href="#/artist/${encodeURIComponent(a.key)}">${esc(a.name)}</a><span class="sub">${plural(a.shows.size, 'show')} · since ${esc(a.first.slice(0, 4))}</span></span><span class="big">${a.count}</span></li>`).join('')}</ul>
        </div>
      </section>

      <section class="sec">
        <div class="sec-head"><h2>Pull a random record</h2><a class="more" href="#/dig">Dig deeper →</a></div>
        <div class="digs" id="digs"></div>
      </section>`;
    bindPlay();
    drawDigs(document.getElementById('digs'), 3);
    const q = document.getElementById('q'), res = document.getElementById('res');
    q.addEventListener('input', debounce(() => quickSearch(q.value, res), 120));
  }

  function quickSearch(raw, el) {
    const q = fold(raw.trim());
    if (q.length < 2) { el.innerHTML = ''; return; }
    const nq = q.replace(/^#/, '');
    const shows = DB.shows.filter(s => (/^\d+$/.test(nq) && String(s.number) === nq) || s.search.includes(q)).slice(-5).reverse();
    const artists = [...DB.artists.values()].filter(a => a.search.includes(q)).sort((a, b) => b.count - a.count).slice(0, 5);
    const songs = [...DB.songs.values()].filter(g => g.search.includes(q)).sort((a, b) => b.count - a.count).slice(0, 8);
    if (!shows.length && !artists.length && !songs.length) { el.innerHTML = '<div class="empty">Nothing in the crates for that one.</div>'; return; }
    el.innerHTML = `<ul class="rows">
      ${shows.map(s => `<li><span class="main"><a href="#/show/${s.id}">${hl(s.name, q)}</a><span class="sub">Show · ${esc(fmtDate(s.date))}</span></span></li>`).join('')}
      ${artists.map(a => `<li><span class="main"><a href="#/artist/${encodeURIComponent(a.key)}">${hl(a.name, q)}</a><span class="sub">Artist · ${plural(a.count, 'play')}</span></span></li>`).join('')}
      ${songs.map(g => `<li><span class="main"><a href="#/song/${encodeURIComponent(g.key)}">${hl(g.title, q)}</a><span class="sub">${hl(g.artist, q)}</span></span><span class="big">${g.count}×</span></li>`).join('')}
    </ul>
    <p class="muted" style="font:400 13px var(--mono)"><a href="#/songs?q=${encodeURIComponent(raw.trim())}">All matching songs →</a></p>`;
  }

  function drawDigs(el, n) {
    const pick = shuffle(DB.tracks).slice(0, n);
    el.innerHTML = pick.map(t => `<div class="card45">
      <a href="#/song/${encodeURIComponent(t.key)}"><b>${esc(t.title)}</b></a>
      ${artistLink(t.artist)}
      <span class="sub">Spun on ${showLink(t.show)}${t.ts ? ` at ${esc(t.ts)}` : ''}</span>
    </div>`).join('');
  }

  // ---------- shows ----------
  function viewShows(params) {
    const y = params.get('y') || '', c = params.get('c') || '', q0 = params.get('q') || '';
    app.innerHTML = `
      <div class="page-head"><h1>The shows</h1><p class="muted">${plural(DB.shows.length, 'show')} since ${esc(fmtDate(DB.shows[0].date))}.</p></div>
      <div class="bar">
        <input class="filter" id="f" type="search" placeholder="Filter by title or tag…" value="${esc(q0)}">
        <select id="y" aria-label="Year"><option value="">All years</option>${DB.years.map(v => `<option ${String(v) === y ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="chips">${['', ...DB.cats].map(v => `<button class="chip ${v === c ? 'on' : ''}" data-c="${esc(v)}">${esc(v || 'Everything')}</button>`).join('')}</div>
      <div id="list"></div>`;
    let cat = c, limit = 60;
    const f = document.getElementById('f'), ys = document.getElementById('y'), list = document.getElementById('list');
    function draw() {
      const q = fold(f.value.trim()), yr = ys.value;
      replaceParams('shows', { y: yr, c: cat, q: f.value.trim() });
      const nq = q.replace(/^#/, '');
      const rows = DB.shows.filter(s => (!yr || String(s.year) === yr) && (!cat || s.category === cat) && (!q || s.search.includes(q) || String(s.number) === nq)).reverse();
      list.innerHTML = rows.length ? `<div class="crate">${rows.slice(0, limit).map(s => sleeve(s)).join('')}</div>
        ${rows.length > limit ? `<div class="pager"><button class="btn y" id="more">Show more (${num(rows.length - limit)} left)</button></div>` : ''}` : '<div class="empty">No show matches.</div>';
      const m = document.getElementById('more'); if (m) m.onclick = () => { limit += 60; draw(); };
    }
    f.addEventListener('input', debounce(() => { limit = 60; draw(); }, 150));
    ys.onchange = () => { limit = 60; draw(); };
    app.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { cat = b.dataset.c; limit = 60; app.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
    draw();
  }

  function viewShow(id) {
    const s = DB.showById.get(id);
    if (!s) return notFound('show');
    const i = DB.shows.indexOf(s), prev = DB.shows[i - 1], next = DB.shows[i + 1];
    let n = 0;
    const rows = s.items.map(t => {
      const sec = tsSec(t.ts);
      const tsCell = t.ts ? (s.url ? `<button data-seek="${sec}" title="Play from ${esc(t.ts)}">${esc(t.ts)}</button>` : `<span>${esc(t.ts)}</span>`) : '';
      const label = esc(t.artist ? `${t.artist} – ${t.title}` : t.title);
      if (t.type === 'segment') return `<tr class="seg" ${sec != null ? `data-sec="${sec}"` : ''} data-label="${label}"><td class="n">◆</td><td class="t">${tsCell}</td><td colspan="2">${esc([t.artist, t.title].filter(Boolean).join(' – '))}</td></tr>`;
      n++;
      const other = t.song.count - 1;
      return `<tr ${sec != null ? `data-sec="${sec}"` : ''} data-label="${label}"><td class="n">${n}</td><td class="t">${tsCell}</td>
        <td><span class="a">${artistLink(t.artist)}</span> – ${songLink(t.song)}</td>
        <td class="c">${other ? `<a class="cnt" href="#/song/${encodeURIComponent(t.key)}" title="Played ${t.song.count} times on Funky Corners">${t.song.count}×</a>` : ''}</td></tr>`;
    }).join('');
    app.innerHTML = `
      <div class="show-head">
        ${sleeve(s, { noMeta: true, eager: true })}
        <div>
          <div class="eyebrow">${esc(s.category)}</div>
          <h1>${esc(s.name)}</h1>
          <div class="facts"><span>${esc(fmtDate(s.date))}</span>${s.duration ? `<span>${esc(fmtDur(s.duration))}</span>` : ''}<span>${plural(s.nTracks, 'track')}</span>${s.plays != null ? `<span>${num(s.plays)} plays</span>` : ''}${s.favorites ? `<span>${num(s.favorites)} favorites</span>` : ''}</div>
          <div class="chips">${(s.tags || []).map(t => `<a class="tag" href="#/shows?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
          <div class="btns">${s.url ? `<button class="btn" data-play="${s.id}">${playIcon} Play here</button><a class="btn alt" href="${esc(s.url)}" target="_blank" rel="noopener">Listen on Mixcloud ↗</a>` : ''}</div>
          ${s.description ? `<div class="desc" id="desc">${esc(s.description)}</div><button class="linkish" id="more">Read more</button>` : ''}
        </div>
      </div>
      <section class="sec">
        <div class="sec-head"><h2>Tracklist</h2>${s.items.some(t => t.ts) && s.url ? '<span class="muted" style="font:400 13px var(--mono)">Click a time to drop the needle there.</span>' : ''}</div>
        ${s.items.length ? `<table class="tl"><tbody>${rows}</tbody></table>` : '<div class="panel empty">No tracklist was published for this show on Mixcloud.</div>'}
      </section>
      <div class="nav-eps">
        ${prev ? `<a class="btn alt" href="#/show/${prev.id}">← ${esc(numLabel(prev))}</a>` : '<span></span>'}
        ${next ? `<a class="btn alt" href="#/show/${next.id}">${esc(numLabel(next))} →</a>` : ''}
      </div>`;
    bindPlay();
    app.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => Player.open(s, +b.dataset.seek));
    const more = document.getElementById('more'), desc = document.getElementById('desc');
    if (more) { if (desc.scrollHeight <= desc.clientHeight + 4) { more.remove(); desc.classList.add('open'); } else more.onclick = () => { desc.classList.toggle('open'); more.textContent = desc.classList.contains('open') ? 'Read less' : 'Read more'; }; }
  }
  function bindPlay() {
    app.querySelectorAll('[data-play]').forEach(b => b.onclick = () => Player.open(DB.showById.get(+b.dataset.play), 0));
  }

  // ---------- songs ----------
  function viewSongs(params) {
    const sort0 = params.get('sort') || 'plays';
    app.innerHTML = `
      <div class="page-head"><h1>Songs</h1><p class="muted">${plural(DB.songs.size, 'different song')} across ${plural(DB.shows.length, 'show')}.</p></div>
      <div class="bar">
        <input class="filter" id="f" type="search" placeholder="Search a title or an artist…" value="${esc(params.get('q') || '')}">
        <select id="s" aria-label="Sort"><option value="plays">Most played</option><option value="recent">Recently played</option><option value="az">A → Z</option></select>
      </div>
      <div id="list"></div>`;
    const f = document.getElementById('f'), sel = document.getElementById('s'), list = document.getElementById('list');
    sel.value = sort0;
    let limit = 100;
    function draw() {
      const q = fold(f.value.trim()), sort = sel.value;
      replaceParams('songs', { q: f.value.trim(), sort: sort === 'plays' ? '' : sort });
      let rows = [...DB.songs.values()].filter(g => !q || g.search.includes(q));
      rows.sort(sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : sort === 'recent' ? (a, b) => b.last.localeCompare(a.last) : (a, b) => b.count - a.count || b.last.localeCompare(a.last));
      list.innerHTML = rows.length ? `<ul class="rows">${rows.slice(0, limit).map(g => `<li><span class="main"><a href="#/song/${encodeURIComponent(g.key)}">${hl(g.title, q)}</a><span class="sub">${hl(g.artist, q)} · last spun ${esc(fmtDate(g.last))}</span></span><span class="big">${g.count}×</span></li>`).join('')}</ul>
        ${rows.length > limit ? `<div class="pager"><button class="btn y" id="more">Show more (${num(rows.length - limit)} left)</button></div>` : ''}` : '<div class="empty">No song matches.</div>';
      const m = document.getElementById('more'); if (m) m.onclick = () => { limit += 100; draw(); };
    }
    f.addEventListener('input', debounce(() => { limit = 100; draw(); }, 150));
    sel.onchange = () => { limit = 100; draw(); };
    draw();
  }

  function viewSong(key) {
    const g = DB.songs.get(key);
    if (!g) return notFound('song');
    const ak = norm(g.artist);
    const others = DB.artists.has(ak) ? [...DB.artists.get(ak).songs].filter(k => k !== key).map(k => DB.songs.get(k)).sort((a, b) => b.count - a.count).slice(0, 8) : [];
    app.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Song</div>
        <h1>${esc(g.title)}</h1>
        <p style="font-size:20px;font-weight:700">${artistLink(g.artist)}</p>
        <div class="facts"><span>Spun ${g.count === 1 ? 'once' : g.count + ' times'}</span><span>First: ${esc(fmtDate(g.first))}</span>${g.count > 1 ? `<span>Last: ${esc(fmtDate(g.last))}</span>` : ''}</div>
      </div>
      <section class="sec">
        <div class="sec-head"><h2>Where it was played</h2></div>
        <ul class="rows">${g.plays.slice().reverse().map(t => `<li>
          <span class="main">${showLink(t.show)} <span class="sub">${esc(shortName(t.show))}</span>
          <span class="sub">${t.prev ? `after ${esc(t.prev.artist)} – ${esc(t.prev.title)}` : 'opened the show'}${t.next ? ` · before ${esc(t.next.artist)} – ${esc(t.next.title)}` : ''}</span></span>
          ${t.ts && t.show.url ? `<button class="btn y" data-show="${t.show.id}" data-seek="${tsSec(t.ts)}">${playIcon} ${esc(t.ts)}</button>` : ''}
        </li>`).join('')}</ul>
      </section>
      ${others.length ? `<section class="sec"><div class="sec-head"><h2>More by ${esc(g.artist)}</h2></div>
        <ul class="rows">${others.map(o => `<li><span class="main">${songLink(o)}</span><span class="big">${o.count}×</span></li>`).join('')}</ul></section>` : ''}`;
    app.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => Player.open(DB.showById.get(+b.dataset.show), +b.dataset.seek));
  }

  // ---------- artists ----------
  function viewArtists(params) {
    app.innerHTML = `
      <div class="page-head"><h1>Artists</h1><p class="muted">${plural(DB.artists.size, 'artist')} in the crates.</p></div>
      <div class="bar">
        <input class="filter" id="f" type="search" placeholder="Search an artist…" value="${esc(params.get('q') || '')}">
        <select id="s" aria-label="Sort"><option value="plays">Most played</option><option value="shows">Most shows</option><option value="az">A → Z</option></select>
      </div>
      <div id="list"></div>`;
    const f = document.getElementById('f'), sel = document.getElementById('s'), list = document.getElementById('list');
    let limit = 100;
    function draw() {
      const q = fold(f.value.trim()), sort = sel.value;
      replaceParams('artists', { q: f.value.trim() });
      let rows = [...DB.artists.values()].filter(a => !q || a.search.includes(q));
      rows.sort(sort === 'az' ? (a, b) => a.name.localeCompare(b.name) : sort === 'shows' ? (a, b) => b.shows.size - a.shows.size : (a, b) => b.count - a.count);
      list.innerHTML = rows.length ? `<ul class="rows">${rows.slice(0, limit).map(a => `<li><span class="main"><a href="#/artist/${encodeURIComponent(a.key)}">${hl(a.name, q)}</a><span class="sub">${plural(a.songs.size, 'song')} · ${plural(a.shows.size, 'show')} · ${esc(a.first.slice(0, 4))}${a.last.slice(0, 4) !== a.first.slice(0, 4) ? '–' + esc(a.last.slice(0, 4)) : ''}</span></span><span class="big">${a.count}</span></li>`).join('')}</ul>
        ${rows.length > limit ? `<div class="pager"><button class="btn y" id="more">Show more (${num(rows.length - limit)} left)</button></div>` : ''}` : '<div class="empty">No artist matches.</div>';
      const m = document.getElementById('more'); if (m) m.onclick = () => { limit += 100; draw(); };
    }
    f.addEventListener('input', debounce(() => { limit = 100; draw(); }, 150));
    sel.onchange = draw;
    draw();
  }

  function viewArtist(key) {
    const a = DB.artists.get(key);
    if (!a) return notFound('artist');
    const songs = [...a.songs].map(k => DB.songs.get(k)).sort((x, y) => y.count - x.count || x.title.localeCompare(y.title));
    const y0 = DB.years[DB.years.length - 1], y1 = DB.years[0], per = {};
    a.plays.forEach(t => { per[t.show.year] = (per[t.show.year] || 0) + 1; });
    const span = []; for (let y = y0; y <= y1; y++) span.push(y);
    const max = Math.max(...Object.values(per));
    const shows = [...a.shows].map(id => DB.showById.get(id)).reverse();
    app.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Artist</div>
        <h1>${esc(a.name)}</h1>
        <div class="facts"><span>${plural(a.count, 'play')}</span><span>${plural(a.songs.size, 'song')}</span><span>${plural(a.shows.size, 'show')}</span><span>First spun ${esc(fmtDate(a.first))}</span></div>
      </div>
      ${span.length > 1 ? `<section class="sec panel"><div class="eyebrow">Plays per year</div>
        <div class="years">${span.map(y => `<div style="height:${per[y] ? Math.max(4, per[y] / max * 100) : 0}%" title="${y}: ${per[y] || 0}"></div>`).join('')}</div>
        <div class="years-l">${span.map(y => `<span>${String(y).slice(2)}</span>`).join('')}</div></section>` : ''}
      <section class="sec cols">
        <div><div class="sec-head"><h2>Songs</h2></div>
          <ul class="rows">${songs.map(g => `<li><span class="main">${songLink(g)}<span class="sub">last ${esc(fmtDate(g.last))}</span></span><span class="big">${g.count}×</span></li>`).join('')}</ul></div>
        <div><div class="sec-head"><h2>Shows</h2></div>
          <ul class="rows">${shows.slice(0, 40).map(s => `<li><span class="main">${showLink(s)}<span class="sub">${esc(shortName(s))}</span></span></li>`).join('')}</ul></div>
      </section>`;
  }

  // ---------- dig ----------
  function viewDig() {
    const shows = shuffle(DB.shows.filter(s => s.nTracks)).slice(0, 4);
    app.innerHTML = `
      <div class="page-head"><h1>Dig the crates</h1><p class="muted">Random records from ${num(DB.shows.length)} shows. Pull again until something grabs you.</p></div>
      <div class="btns"><button class="btn" id="again">Pull 9 more records</button><button class="btn y" id="lucky">Random full show</button></div>
      <div class="digs" id="digs"></div>
      <section class="sec"><div class="sec-head"><h2>Forgotten shows</h2></div><div class="crate">${shows.map(s => sleeve(s)).join('')}</div></section>`;
    const el = document.getElementById('digs');
    drawDigs(el, 9);
    document.getElementById('again').onclick = () => drawDigs(el, 9);
    document.getElementById('lucky').onclick = () => { const s = shuffle(DB.shows)[0]; location.hash = '#/show/' + s.id; };
  }

  // broken cover image -> generated sleeve
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.id && DB) img.outerHTML = genArt(DB.showById.get(+img.dataset.id));
  }, true);

  // ---------- boot ----------
  fetch('data/shows.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(raw => {
      DB = build(raw);
      document.getElementById('foot').innerHTML = `
        <span>Data from <a href="https://www.mixcloud.com/FunkyCorners/" target="_blank" rel="noopener">mixcloud.com/FunkyCorners</a> · updated ${esc(fmtDate(raw.updated))}</span>
        <span>Built with love from Caen, France by <a href="https://lafabrock.github.io/lafabrock/" target="_blank" rel="noopener">La fabrock</a> (Radio 666) for the 15th anniversary. Keep diggin’.</span>`;
      addEventListener('hashchange', render);
      render();
    })
    .catch(() => { app.innerHTML = '<div class="loading">The crates could not be opened (data/shows.json missing). Serve this folder over HTTP.</div>'; });
})();

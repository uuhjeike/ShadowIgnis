/* =========================================================
   ShadowIgnis — profile logic
   Speed strategy:
   1. Photos   -> IntersectionObserver lazy load (starts ~600px early) + async decode + blur-up
   2. Videos   -> nothing downloads until scrolled near; preload="metadata" only on demand
                  and full playback only on tap; auto-pause when scrolled away
   3. YouTube  -> click-to-load facade (thumbnail only, no iframe / no 500KB+ of scripts)
   4. Feed     -> rendered in small batches via a sentinel (infinite scroll), never all at once
   5. Priority -> first ~2 images use eager/high priority, rest low
   ========================================================= */
(() => {
  'use strict';

  const D = window.PROFILE_DATA;
  if (!D) return;

  /* ---------- tiny helpers ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, cls, attrs) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const svg = (d, w = 20) =>
    `<svg viewBox="0 0 24 24" width="${w}" height="${w}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON = {
    heart:   'M12 21s-7-4.6-9.3-9.1C1.2 8.6 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h.9C12.1 6.1 13.5 5 15.6 5 19 5 20.8 8.6 21.3 11.9 19 16.4 12 21 12 21z',
    comment: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z',
    share:   'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14',
    dots:    'M5 12h.01M12 12h.01M19 12h.01'
  };

  /* ---------- profile header ---------- */
  document.title = D.name;
  $('#name').textContent   = D.name;
  $('#handle').textContent = '@' + D.handle;
  $('#bio').textContent    = D.bio;
  $('#topName').textContent = D.name;

  const avatar = $('#avatar');
  avatar.src = D.avatar;
  avatar.addEventListener('error', () => { avatar.style.visibility = 'hidden'; });
  const topAv = $('#topAvatar');
  topAv.src = D.avatar;

  const counts = {
    posts:  D.posts.length,
    photos: D.posts.reduce((n, p) => n + p.media.filter(m => m.type === 'image').length, 0),
    videos: D.posts.reduce((n, p) => n + p.media.filter(m => m.type === 'video' || m.type === 'youtube').length, 0)
  };
  $('#stats').innerHTML =
    `<div class="stat"><b>${counts.posts}</b><span>Posts</span></div>` +
    `<div class="stat"><b>${counts.photos}</b><span>Photos</span></div>` +
    `<div class="stat"><b>${counts.videos}</b><span>Videos</span></div>`;

  /* ---------- top bar appears after scrolling past the header ---------- */
  const topbar = $('#topbar');
  const nameEl = $('#name');
  new IntersectionObserver(([e]) => topbar.classList.toggle('is-visible', !e.isIntersecting),
    { rootMargin: '-52px 0px 0px 0px' }).observe(nameEl);
  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  /* ---------- lazy media engine ---------- */
  // Images: start loading a bit BEFORE they enter the screen so they are ready on arrival.
  const imgIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const box = e.target;
      imgIO.unobserve(box);
      loadImage(box);
    }
  }, { rootMargin: '700px 0px' });

  function loadImage(box) {
    const img = box.querySelector('img');
    if (!img || img.src) return;
    img.decoding = 'async';
    img.onload  = () => box.classList.add('is-loaded');
    img.onerror = () => { box.classList.add('is-error'); box.classList.remove('is-loaded'); };
    img.src = img.dataset.src;
    if (img.complete && img.naturalWidth) box.classList.add('is-loaded');
  }

  // Videos: only touch the network when scrolled near AND only fetch metadata (first frame).
  const vidIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const wrap = e.target;
      const v = wrap.querySelector('video');
      if (e.isIntersecting) {
        if (!wrap.dataset.armed) { wrap.dataset.armed = '1'; armVideo(wrap); }
      } else if (v && !v.paused) {
        v.pause();                                        // save data/battery when scrolled away
      }
    }
  }, { rootMargin: '300px 0px' });

  function armVideo(wrap) {
    const v = wrap.querySelector('video');
    const box = wrap.querySelector('.media__box');
    v.preload = 'metadata';
    v.src = v.dataset.src + '#t=0.1';                      // #t=0.1 forces the browser to paint a poster frame
    v.addEventListener('loadeddata', () => box.classList.add('is-loaded'), { once: true });
    v.addEventListener('error', () => box.classList.add('is-error'), { once: true });
  }

  /* ---------- media builders ---------- */
  let eagerBudget = 2;                                      // first couple of images load immediately

  function imageCell(m, index, group, extraOverlay) {
    const cell = el('figure', 'cell'); cell.style.margin = 0;
    const box  = el('div', 'media__box');
    const img  = el('img', null, { alt: '', draggable: 'false' });
    img.dataset.src = m.src;
    box.appendChild(img);
    box.addEventListener('click', () => openLightbox(group, index));
    cell.appendChild(box);
    if (extraOverlay) cell.appendChild(extraOverlay);
    if (eagerBudget > 0) { eagerBudget--; img.fetchPriority = 'high'; loadImage(box); }
    else imgIO.observe(box);
    return cell;
  }

  function buildPhotoGrid(images) {
    const wrap = el('div', 'media');
    const shown = images.slice(0, 4);
    const grid = el('div', `grid grid--${shown.length}`);
    shown.forEach((m, i) => {
      let overlay = null;
      if (i === 3 && images.length > 4) {
        overlay = el('div', 'cell__more'); overlay.textContent = '+' + (images.length - 4);
      }
      grid.appendChild(imageCell(m, i, images, overlay));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function buildVideo(m) {
    const wrap = el('div', 'media video');
    const box  = el('div', 'media__box');
    const v    = el('video', null, { playsinline: '', preload: 'none', controlslist: 'nodownload', 'aria-label': 'Video' });
    v.dataset.src = m.src;
    v.muted = true; v.loop = false;
    const play = el('button', 'play', { 'aria-label': 'Play video' });
    play.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5v14l11-7z" fill="#fff"/></svg>';

    const start = () => {
      if (!wrap.dataset.armed) { wrap.dataset.armed = '1'; armVideo(wrap); }
      // pause any other playing video so only one plays at a time
      $$('.video video').forEach(o => { if (o !== v && !o.paused) o.pause(); });
      v.muted = false; v.controls = true;
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    };
    play.addEventListener('click', start);
    v.addEventListener('play',  () => wrap.classList.add('is-playing'));
    v.addEventListener('pause', () => { if (v.currentTime === 0 || v.ended) wrap.classList.remove('is-playing'); });
    v.addEventListener('ended', () => wrap.classList.remove('is-playing'));

    box.append(v, play);
    wrap.appendChild(box);
    vidIO.observe(wrap);
    return wrap;
  }

  function buildYouTube(m) {
    const wrap = el('div', 'media yt');
    const box  = el('div', 'media__box');
    const img  = el('img', null, { alt: 'YouTube video', draggable: 'false' });
    img.dataset.src = `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`;
    const play = el('button', 'play', { 'aria-label': 'Play YouTube video' });
    play.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5v14l11-7z" fill="#fff"/></svg>';
    const tag = el('span', 'yt__label'); tag.textContent = 'YOUTUBE';
    box.append(img, play, tag);
    wrap.appendChild(box);
    imgIO.observe(box);
    // Only now (on tap) does any YouTube code get downloaded.
    const load = () => {
      const f = el('iframe', null, {
        src: `https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&rel=0&playsinline=1`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: '', title: 'YouTube video'
      });
      box.innerHTML = ''; box.appendChild(f); box.classList.add('is-loaded'); box.style.cursor = 'default';
    };
    box.addEventListener('click', load, { once: true });
    return wrap;
  }

  /* ---------- post builder ---------- */
  const IS_LONG = 320;   // chars before a text gets collapsed
  const liked = new Set(JSON.parse(localStorage.getItem('si_liked') || '[]'));

  function buildPost(p) {
    const post = el('article', 'post'); post.dataset.id = p.id;

    // header
    const head = el('div', 'post__head');
    const av = el('img', 'post__avatar', { alt: '', width: 38, height: 38, decoding: 'async' });
    av.src = D.avatar; av.loading = 'lazy';
    const who = el('div', 'post__who');
    who.innerHTML = `<b>${escapeHTML(D.name)}</b><span>@${escapeHTML(D.handle)}</span>`;
    const more = el('button', 'post__more', { 'aria-label': 'More' });
    more.innerHTML = svg(ICON.dots);
    head.append(av, who, more);
    post.appendChild(head);

    // text
    if (p.text && p.text.trim()) {
      const t = el('p', 'post__text');
      t.innerHTML = linkify(escapeHTML(p.text));
      post.appendChild(t);
      if (p.text.length > IS_LONG) {
        t.classList.add('is-long');
        const btn = el('button', 'post__toggle'); btn.textContent = 'Show more';
        btn.addEventListener('click', () => {
          const open = t.classList.toggle('is-open');
          t.classList.toggle('is-long', !open);
          btn.textContent = open ? 'Show less' : 'Show more';
          if (!open) post.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        post.appendChild(btn);
      }
    }

    // media (images grouped into one grid, others stacked in order)
    const images = p.media.filter(m => m.type === 'image');
    let gridDone = false;
    for (const m of p.media) {
      if (m.type === 'image') {
        if (!gridDone) { post.appendChild(buildPhotoGrid(images)); gridDone = true; }
      } else if (m.type === 'video')   post.appendChild(buildVideo(m));
      else if (m.type === 'youtube')   post.appendChild(buildYouTube(m));
    }

    // actions
    const foot = el('div', 'post__foot');
    const like = el('button', 'act' + (liked.has(p.id) ? ' is-on' : ''), { 'aria-label': 'Like', 'aria-pressed': liked.has(p.id) });
    like.innerHTML = svg(ICON.heart) + '<span>Like</span>';
    like.addEventListener('click', () => {
      const on = like.classList.toggle('is-on');
      like.setAttribute('aria-pressed', on);
      on ? liked.add(p.id) : liked.delete(p.id);
      try { localStorage.setItem('si_liked', JSON.stringify([...liked])); } catch (_) {}
    });
    const share = el('button', 'act', { 'aria-label': 'Share' });
    share.innerHTML = svg(ICON.share) + '<span>Share</span>';
    share.addEventListener('click', async () => {
      const url = location.href.split('#')[0] + '#post-' + p.id;
      try {
        if (navigator.share) await navigator.share({ title: D.name, url });
        else { await navigator.clipboard.writeText(url); toast('Link copied'); }
      } catch (_) {}
    });
    foot.append(like, share);
    post.appendChild(foot);
    post.id = 'post-' + p.id;
    return post;
  }

  /* ---------- feed: batched, infinite scroll ---------- */
  const feed = $('#feed'), sentinel = $('#sentinel');
  const endMsg = $('#feedEnd'), emptyMsg = $('#feedEmpty');
  const BATCH = 5;

  let filter = 'all', newestFirst = true, list = [], cursor = 0;

  const kind = p => {
    const t = new Set(p.media.map(m => m.type));
    if (t.has('image')) return 'photo';
    if (t.has('video') || t.has('youtube')) return 'video';
    return 'text';
  };
  const hasKind = (p, f) => f === 'all'
    || (f === 'photo' && p.media.some(m => m.type === 'image'))
    || (f === 'video' && p.media.some(m => m.type === 'video' || m.type === 'youtube'))
    || (f === 'text'  && !p.media.length);

  function rebuild() {
    feed.innerHTML = ''; cursor = 0; eagerBudget = 2;
    endMsg.hidden = true; emptyMsg.hidden = true;
    list = D.posts.filter(p => hasKind(p, filter));
    if (newestFirst) list = list.slice().reverse();        // file order = oldest first
    if (!list.length) { emptyMsg.hidden = false; return; }
    renderBatch();
    feedIO.disconnect(); feedIO.observe(sentinel);
  }

  function renderBatch() {
    const frag = document.createDocumentFragment();
    const end = Math.min(cursor + BATCH, list.length);
    for (; cursor < end; cursor++) frag.appendChild(buildPost(list[cursor]));
    feed.appendChild(frag);
    if (cursor >= list.length) { endMsg.hidden = false; feedIO.disconnect(); }
  }

  const feedIO = new IntersectionObserver((es) => {
    if (es[0].isIntersecting && cursor < list.length) renderBatch();
  }, { rootMargin: '900px 0px' });

  /* ---------- tabs & sort ---------- */
  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.tab').forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('is-active'); tab.setAttribute('aria-selected', 'true');
    filter = tab.dataset.filter;
    rebuild();
    const top = $('.tabs').offsetTop;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'auto' });
  }));
  $('#sortBtn').addEventListener('click', () => {
    newestFirst = !newestFirst; rebuild(); toast(newestFirst ? 'Newest first' : 'Oldest first');
  });

  /* ---------- lightbox ---------- */
  const lb = $('#lightbox'), stage = $('#lbStage'), lbCount = $('#lbCount');
  const lbPrev = $('#lbPrev'), lbNext = $('#lbNext');
  let lbGroup = [], lbIndex = 0, lastFocus = null;

  function openLightbox(group, i) {
    lbGroup = group; lbIndex = i; lastFocus = document.activeElement;
    lb.hidden = false; document.body.style.overflow = 'hidden';
    showLb(); $('#lbClose').focus();
  }
  function showLb() {
    const m = lbGroup[lbIndex];
    stage.innerHTML = '';
    const img = new Image(); img.decoding = 'async'; img.alt = ''; img.src = m.src;
    stage.appendChild(img);
    lbCount.textContent = lbGroup.length > 1 ? `${lbIndex + 1} / ${lbGroup.length}` : '';
    lbPrev.hidden = lbNext.hidden = lbGroup.length < 2;
    // preload neighbours so next/prev is instant
    [lbIndex + 1, lbIndex - 1].forEach(n => { if (lbGroup[n]) { const pre = new Image(); pre.src = lbGroup[n].src; } });
  }
  const closeLb = () => { lb.hidden = true; stage.innerHTML = ''; document.body.style.overflow = ''; lastFocus && lastFocus.focus && lastFocus.focus(); };
  const stepLb = d => { const n = lbIndex + d; if (n >= 0 && n < lbGroup.length) { lbIndex = n; showLb(); } };
  $('#lbClose').addEventListener('click', closeLb);
  lbPrev.addEventListener('click', () => stepLb(-1));
  lbNext.addEventListener('click', () => stepLb(1));
  lb.addEventListener('click', e => { if (e.target === lb || e.target === stage) closeLb(); });
  document.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowRight') stepLb(1);
    else if (e.key === 'ArrowLeft')  stepLb(-1);
  });
  // swipe on touch
  let tx = 0;
  stage.addEventListener('touchstart', e => { tx = e.changedTouches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend',   e => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) stepLb(dx < 0 ? 1 : -1); }, { passive: true });

  /* ---------- utils ---------- */
  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function linkify(s) {
    return s.replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer" style="color:var(--red-hot)">${u.length > 46 ? u.slice(0, 44) + '…' : u}</a>`);
  }
  let toastT;
  function toast(msg) {
    let t = $('#toast');
    if (!t) {
      t = el('div', null, { id: 'toast', role: 'status' });
      Object.assign(t.style, { position: 'fixed', left: '50%', bottom: 'calc(28px + env(safe-area-inset-bottom))', transform: 'translateX(-50%) translateY(20px)',
        background: '#1b0d0f', color: '#f1e9ea', border: '1px solid #3a1a1d', padding: '10px 16px', borderRadius: '999px', fontSize: '.88rem',
        zIndex: 200, opacity: 0, transition: 'opacity .25s, transform .25s', boxShadow: '0 8px 30px rgba(0,0,0,.6)' });
      document.body.appendChild(t);
    }
    t.textContent = msg; requestAnimationFrame(() => { t.style.opacity = 1; t.style.transform = 'translateX(-50%)'; });
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translateX(-50%) translateY(20px)'; }, 1700);
  }

  /* ---------- go ---------- */
  rebuild();
})();

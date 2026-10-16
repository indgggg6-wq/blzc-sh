/* 碧萝找厂 · 站点交互
   - 顶栏 / 移动端菜单
   - 房源列表筛选、排序、URL 参数
   - 首页检索表单
   - 详情页画廊与灯箱（含视频）
   - 复制文本
   兼容 file:// 直接打开（不依赖 fetch 与 ES Module） */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initHeader() {
    var header = document.querySelector('.header');
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle('is-stuck', (window.scrollY || document.documentElement.scrollTop) > 6);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function initMobileNav() {
    var burger = document.querySelector('.burger');
    var panel = document.querySelector('.mnav');
    if (!burger || !panel) return;
    var setOpen = function (open) {
      burger.setAttribute('aria-expanded', String(open));
      panel.classList.toggle('is-open', open);
      document.body.classList.toggle('no-scroll', open);
    };
    burger.addEventListener('click', function () {
      setOpen(burger.getAttribute('aria-expanded') !== 'true');
    });
    panel.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  function initReveal() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!nodes.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  function initCounters() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
    if (!nodes.length) return;
    var fmt = function (v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
    var run = function (el) {
      var target = parseFloat(el.getAttribute('data-count'));
      if (isNaN(target)) return;
      if (reduceMotion) { el.textContent = fmt(target); return; }
      var dur = 900, t0 = null;
      var tick = function (ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(target);
      };
      requestAnimationFrame(tick);
    };
    if (!('IntersectionObserver' in window)) { nodes.forEach(run); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.4 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* 列表筛选 / 排序 / URL 参数 */
  function initFilters() {
    var root = document.querySelector('[data-filters]');
    var grid = document.querySelector('[data-results]');
    if (!root || !grid) return;

    var items = Array.prototype.slice.call(grid.querySelectorAll('[data-order]'));
    var countEl = document.querySelector('[data-result-count]');
    var emptyEl = document.querySelector('[data-empty]');
    var resetBtn = document.querySelector('[data-reset]');
    var sortSel = document.querySelector('[data-sort]');
    var state = { district: 'all', area: 'all', type: 'all', tag: 'all' };

    var bucketOf = function (el) {
      var raw = el.getAttribute('data-area');
      var n = raw === '' ? null : parseFloat(raw);
      if (n === null || isNaN(n)) return 'unknown';
      if (n <= 500) return 's';
      if (n <= 1000) return 'm';
      if (n <= 2000) return 'l';
      if (n <= 4000) return 'xl';
      return 'xxl';
    };

    var apply = function (animate) {
      var shown = 0;
      items.forEach(function (el) {
        var ok = true;
        if (state.district !== 'all' && el.getAttribute('data-district') !== state.district) ok = false;
        if (ok && state.area !== 'all') {
          var b = bucketOf(el);
          if (state.area === 'unknown' ? b !== 'unknown' : b !== state.area) ok = false;
        }
        if (ok && state.type !== 'all' && (el.getAttribute('data-types') || '').split(',').indexOf(state.type) === -1) ok = false;
        if (ok && state.tag !== 'all' && (el.getAttribute('data-tags') || '').split(',').indexOf(state.tag) === -1) ok = false;
        el.hidden = !ok;
        if (ok) {
          shown++;
          if (animate && !reduceMotion) {
            el.classList.remove('is-entering');
            void el.offsetWidth;
            el.style.animationDelay = Math.min(shown * 22, 240) + 'ms';
            el.classList.add('is-entering');
          }
        }
      });
      if (countEl) countEl.innerHTML = '<b>' + shown + '</b> / ' + items.length + ' 套';
      if (emptyEl) emptyEl.hidden = shown !== 0;
    };

    var pressed = function (group, value) {
      root.querySelectorAll('[data-group="' + group + '"]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === value));
      });
    };

    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-group]');
      if (!btn) return;
      var group = btn.getAttribute('data-group');
      state[group] = btn.getAttribute('data-value');
      pressed(group, state[group]);
      apply(true);
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state = { district: 'all', area: 'all', type: 'all', tag: 'all' };
        ['district', 'area', 'type', 'tag'].forEach(function (g) { pressed(g, 'all'); });
        apply(true);
      });
    }

    if (sortSel) {
      sortSel.addEventListener('change', function () {
        var mode = sortSel.value;
        var sorted = items.slice().sort(function (a, b) {
          var va = parseFloat(a.getAttribute('data-area') || '') || -1;
          var vb = parseFloat(b.getAttribute('data-area') || '') || -1;
          if (mode === 'area-desc') return vb - va;
          if (mode === 'area-asc') return va - vb;
          return parseFloat(a.getAttribute('data-order')) - parseFloat(b.getAttribute('data-order'));
        });
        sorted.forEach(function (el) { grid.appendChild(el); });
        apply(true);
      });
    }

    var params = new URLSearchParams(location.search);
    ['district', 'area', 'type', 'tag'].forEach(function (g) {
      var v = params.get(g);
      if (!v) return;
      var target = root.querySelector('[data-group="' + g + '"][data-value="' + CSS.escape(v) + '"]');
      if (target) { state[g] = v; pressed(g, v); }
    });
    apply(false);
  }

  function initSearchForm() {
    var form = document.querySelector('[data-search-form]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var params = new URLSearchParams();
      ['district', 'area', 'type', 'tag'].forEach(function (k) {
        var v = (fd.get(k) || '').toString().trim();
        if (v) params.set(k, v);
      });
      var base = form.getAttribute('data-action') || 'index.html';
      location.href = base + (params.toString() ? '?' + params.toString() : '');
    });
  }

  function initGallery() {
    var dataEl = document.getElementById('gallery-data');
    if (!dataEl) return;
    var items;
    try { items = JSON.parse(dataEl.textContent); } catch (e) { return; }
    if (!items || !items.length) return;

    var mainImg = document.getElementById('gallery-main-img');
    var counter = document.getElementById('gallery-count');
    var thumbs = Array.prototype.slice.call(document.querySelectorAll('.gallery__thumb'));
    var current = 0;

    var setMain = function (i) {
      current = (i + items.length) % items.length;
      var item = items[current];
      if (mainImg.getAttribute('src') !== item.large) {
        mainImg.classList.add('is-swapping');
        var done = function () { mainImg.classList.remove('is-swapping'); };
        mainImg.onload = done;
        setTimeout(done, 420);
      }
      mainImg.src = item.large;
      mainImg.alt = item.alt || '';
      if (counter) counter.textContent = (current + 1) + ' / ' + items.length;
      thumbs.forEach(function (t, ti) { t.classList.toggle('is-current', ti === current); });
    };

    thumbs.forEach(function (t, ti) { t.addEventListener('click', function () { setMain(ti); }); });

    var box = document.getElementById('lightbox');
    var boxImg = document.getElementById('lightbox-img');
    var boxCount = document.getElementById('lightbox-count');
    var boxStage = document.getElementById('lightbox-stage');
    var videoEl = null;
    var lbLoaded = false;

    function clearVideo() { if (videoEl) { videoEl.pause(); videoEl.remove(); videoEl = null; } }

    function render(i) {
      current = (i + items.length) % items.length;
      var item = items[current];
      clearVideo();
      if (item.video) {
        boxImg.style.display = 'none';
        videoEl = document.createElement('video');
        videoEl.src = item.video;
        videoEl.controls = true;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.preload = 'metadata';
        videoEl.className = 'lightbox__img is-ready';
        videoEl.style.maxHeight = '100%';
        boxStage.appendChild(videoEl);
      } else {
        boxImg.style.display = '';
        boxImg.classList.remove('is-ready');
        boxImg.src = item.large;
        boxImg.alt = item.alt || '';
        boxImg.onload = function () { boxImg.classList.add('is-ready'); };
        if (boxImg.complete) boxImg.classList.add('is-ready');
      }
      if (boxCount) boxCount.textContent = (current + 1) + ' / ' + items.length;
      box.querySelectorAll('.lightbox__thumb').forEach(function (t, ti) {
        t.classList.toggle('is-current', ti === current);
      });
    }

    function openLightbox(i) {
      if (!box) return;
      if (!lbLoaded) {
        box.querySelectorAll('.lightbox__thumb[data-src]').forEach(function (t) {
          t.src = t.getAttribute('data-src');
          t.removeAttribute('data-src');
        });
        lbLoaded = true;
      }
      box.classList.add('is-open');
      box.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      render(i);
    }
    function closeLightbox() {
      if (!box) return;
      box.classList.remove('is-open');
      box.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('no-scroll');
      clearVideo();
    }
    function step(d) { render(current + d); }

    if (box) {
      box.querySelectorAll('[data-lb-close]').forEach(function (b) { b.addEventListener('click', closeLightbox); });
      var prev = box.querySelector('[data-lb-prev]');
      var next = box.querySelector('[data-lb-next]');
      if (prev) prev.addEventListener('click', function () { step(-1); });
      if (next) next.addEventListener('click', function () { step(1); });
      box.querySelectorAll('.lightbox__thumb').forEach(function (t, ti) {
        t.addEventListener('click', function () { render(ti); });
      });
      box.addEventListener('click', function (e) { if (e.target === box || e.target === boxStage) closeLightbox(); });
      window.addEventListener('keydown', function (e) {
        if (!box.classList.contains('is-open')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
      });
    }

    var mainWrap = document.querySelector('.gallery__main');
    if (mainWrap) mainWrap.addEventListener('click', function () { openLightbox(current); });
    setMain(0);
  }

  function initVideoBlocks() {
    document.querySelectorAll('[data-video-poster]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = document.createElement('video');
        v.src = btn.getAttribute('data-video-poster');
        v.controls = true; v.autoplay = true; v.playsInline = true; v.preload = 'auto';
        btn.parentNode.appendChild(v);
        btn.remove();
      });
    });
  }

  function initCopy() {
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy');
        var state = null, el = btn.parentNode;
        while (el && el !== document.body) {
          state = el.querySelector('.copy-state');
          if (state) break;
          el = el.parentNode;
        }
        var done = function () {
          if (state) {
            state.textContent = '已复制：' + text;
            setTimeout(function () { state.textContent = ''; }, 2600);
          }
        };
        var fallback = function () {
          var ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (err) {}
          document.body.removeChild(ta);
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
      });
    });
  }

  function boot() {
    initHeader();
    initMobileNav();
    initReveal();
    initCounters();
    initFilters();
    initSearchForm();
    initGallery();
    initVideoBlocks();
    initCopy();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

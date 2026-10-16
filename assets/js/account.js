/* 碧萝找厂 · 账号与积分（前端演示实现）
   ------------------------------------------------------------------
   业务模型：用户注册 → 浏览房源 → 消耗积分解锁「业主联系方式」→ 直接与业主电话沟通，无中介转接。
   当前实现：账号、积分、解锁记录保存在浏览器 localStorage，用于演示完整流程。

   ⚠️ 正式版本的安全要求（务必遵守）：
   1. 业主联系电话属于付费内容，**必须由服务端在验证「已登录 + 积分充足 + 已扣分」后返回**，
      前端不得持有或下发明文号码；
   2. 扣减积分与写入解锁记录必须在同一数据库事务中完成，避免并发重复扣分或漏扣；
   3. 解锁记录以 (user_id, listing_id) 唯一约束保证「同一房源只扣一次」；
   4. 详见 ../docs/后端方案.md。
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* 存储结构：账号数据与会话分离，账号数据按手机号索引。
     这样退出登录不会丢积分与解锁记录，换手机号登录也不会串数据。 */
  var KEY_ACCOUNTS = 'blzc_accounts';   // { "<phone>": { name, phone, points, createdAt } }
  var KEY_SESSION = 'blzc_session';     // "<phone>"
  var KEY_UNLOCKS = 'blzc_unlocks';     // { "<phone>": [ unlock, ... ] }
  var KEY_POINTS = 'blzc_points';       // { "<phone>": [ log, ... ] }
  var CFG = window.BLZC_CONFIG || {};
  var POINTS_PER_UNLOCK = Number(CFG.pointsPerUnlock || 10);
  var SIGNUP_POINTS = Number(CFG.signupPoints || 30);
  var BASE = document.body.getAttribute('data-base') || '';

  function readJSON(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function accounts() { return readJSON(KEY_ACCOUNTS, {}); }
  function saveAccounts(map) { return writeJSON(KEY_ACCOUNTS, map); }
  function sessionPhone() {
    try { return localStorage.getItem(KEY_SESSION); } catch (e) { return null; }
  }
  function setSession(phone) { try { localStorage.setItem(KEY_SESSION, phone); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(KEY_SESSION); } catch (e) {} }

  function getUser() {
    var phone = sessionPhone();
    if (!phone) return null;
    return accounts()[phone] || null;
  }
  function saveUser(user) {
    var map = accounts();
    map[user.phone] = user;
    return saveAccounts(map);
  }
  function findAccount(phone) { return accounts()[phone] || null; }

  function getUnlocks() {
    var phone = sessionPhone();
    if (!phone) return [];
    var all = readJSON(KEY_UNLOCKS, {});
    return all[phone] || [];
  }
  function setUnlocks(list) {
    var phone = sessionPhone();
    if (!phone) return false;
    var all = readJSON(KEY_UNLOCKS, {});
    all[phone] = list;
    return writeJSON(KEY_UNLOCKS, all);
  }
  function getPointsLog() {
    var phone = sessionPhone();
    if (!phone) return [];
    var all = readJSON(KEY_POINTS, {});
    return all[phone] || [];
  }
  function setPointsLog(list) {
    var phone = sessionPhone();
    if (!phone) return false;
    var all = readJSON(KEY_POINTS, {});
    all[phone] = list;
    return writeJSON(KEY_POINTS, all);
  }

  function pointsOf(user) { return user ? Number(user.points || 0) : 0; }
  function isUnlocked(listingId) {
    return getUnlocks().some(function (u) { return u.listingId === listingId; });
  }

  function addPoints(delta, note) {
    var user = getUser();
    if (!user) return null;
    user.points = pointsOf(user) + delta;
    saveUser(user);
    var log = getPointsLog();
    log.unshift({ delta: delta, note: note, at: new Date().toISOString(), balance: user.points });
    setPointsLog(log);
    return user.points;
  }

  /* 顶栏：积分与登录态 */
  function renderHeader() {
    var user = getUser();
    var entries = document.querySelectorAll('[data-auth-entry]');
    var chips = document.querySelectorAll('[data-points-chip]');

    entries.forEach(function (el) {
      if (user) {
        el.textContent = '我的';
        el.setAttribute('href', BASE + 'account.html');
      } else {
        el.textContent = '登录 / 注册';
        el.setAttribute('href', BASE + 'login.html');
      }
    });
    chips.forEach(function (el) {
      if (user) {
        el.hidden = false;
        el.setAttribute('href', BASE + 'account.html');
        el.innerHTML = '积分 <b class="num">' + pointsOf(user) + '</b>';
      } else {
        el.hidden = true;
      }
    });
    document.querySelectorAll('[data-mnav-account]').forEach(function (el) {
      el.textContent = user ? '我的账号与积分' : '登录 / 注册';
      el.setAttribute('href', BASE + (user ? 'account.html' : 'login.html'));
    });
  }

  function maskPhone(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 7) return '****';
    return digits.slice(0, 3) + ' **** ' + digits.slice(-4);
  }

  /* 详情页：业主联系方式卡 */
  function initOwnerCard() {
    var dataEl = document.getElementById('owner-data');
    var card = document.querySelector('[data-owner-card]');
    if (!dataEl || !card) return;
    var data;
    try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }

    var render = function () {
      var user = getUser();
      var unlocked = isUnlocked(data.listingId);
      var points = pointsOf(user);
      var loginHref = BASE + 'login.html?next=' + encodeURIComponent(currentRelativePath());

      if (unlocked) {
        card.innerHTML =
          '<div class="owner-card__head">' +
            '<span class="badge-direct">业主直联</span>' +
            '<span class="tag">已解锁</span>' +
          '</div>' +
          '<div class="owner-card__body">' +
            '<div class="owner-card__person">' +
              '<span class="owner-card__avatar" aria-hidden="true">' + esc(data.owner.name.slice(0, 1)) + '</span>' +
              '<span>' +
                '<span class="owner-card__name">' + esc(data.owner.name) + '</span>' +
                '<span class="owner-card__role">' + esc(data.owner.role) + ' · 产权已核实</span>' +
              '</span>' +
            '</div>' +
            '<div class="owner-card__phone">' +
              '<a href="tel:' + esc(data.owner.tel) + '" class="num">' + esc(data.owner.phone) + '</a>' +
              '<span>业主本人接听</span>' +
            '</div>' +
            '<div class="owner-card__actions">' +
              '<a class="btn btn--primary btn--block" href="tel:' + esc(data.owner.tel) + '">立即拨打业主电话</a>' +
              '<button class="btn btn--block" type="button" data-copy="' + esc(data.owner.wechat) + '">复制业主微信号</button>' +
              '<p class="copy-state" aria-live="polite"></p>' +
            '</div>' +
            '<p class="owner-card__quote">' + esc(data.owner.note) + '</p>' +
            '<p class="owner-card__hint">业主直联，无中介转接。致电时请说明「在碧萝找厂看到房源」，便于业主核对。</p>' +
          '</div>';
        bindCopy(card);
        return;
      }

      // 未解锁
      var action;
      if (!user) {
        action = '<a class="btn btn--primary btn--block" href="' + loginHref + '">登录后查看业主联系方式</a>';
      } else if (points >= POINTS_PER_UNLOCK) {
        action = '<button class="btn btn--primary btn--block" type="button" data-unlock>' +
          '消耗 ' + POINTS_PER_UNLOCK + ' 积分查看业主电话</button>';
      } else {
        action = '<button class="btn btn--primary btn--block" type="button" disabled>积分不足，无法解锁</button>';
      }

      card.innerHTML =
        '<div class="owner-card__head">' +
          '<span class="badge-direct">业主直联</span>' +
          '<span class="tag tag--plain">未解锁</span>' +
        '</div>' +
        '<div class="owner-card__body">' +
          '<div class="owner-card__locked">' +
            '<span>业主</span><b class="num">' + maskPhone(data.owner.phone) + '</b>' +
          '</div>' +
          (user
            ? '<div class="points-balance"><span>我的积分</span><span><b class="num">' + points + '</b> 分</span></div>'
            : '<div class="points-balance"><span>查看业主电话需要</span><span><b class="num">' + POINTS_PER_UNLOCK + '</b> 积分</span></div>') +
          '<div class="owner-card__actions">' + action + '</div>' +
          '<p class="owner-card__hint">' +
            (user
              ? '解锁后永久可见该房源的业主联系方式，同一房源不重复扣分。'
              : '注册即赠 ' + SIGNUP_POINTS + ' 积分，可解锁 ' + Math.floor(SIGNUP_POINTS / POINTS_PER_UNLOCK) + ' 套房源的业主联系方式。') +
          '</p>' +
          (user && points < POINTS_PER_UNLOCK
            ? '<p class="owner-card__hint" style="color:var(--mark)">积分不足：当前 ' + points + ' 分，解锁需要 ' + POINTS_PER_UNLOCK + ' 分。可联系客服获取积分。</p>'
            : '') +
          '<p class="owner-card__hint">业主联系方式由平台核实后录入；平台不经手租金、不转接电话、不收取差价。</p>' +
        '</div>';

      var btn = card.querySelector('[data-unlock]');
      if (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('确认消耗 ' + POINTS_PER_UNLOCK + ' 积分查看业主联系方式？同一房源只需解锁一次。')) return;
          var left = addPoints(-POINTS_PER_UNLOCK, '解锁房源 ' + data.code + ' 业主联系方式');
          if (left === null) return;
          var unlocks = getUnlocks();
          unlocks.unshift({
            listingId: data.listingId,
            ref: BASE + 'listing/' + data.listingId + '.html',
            title: data.title,
            district: data.district,
            area: data.area,
            ownerName: data.owner.name,
            ownerPhone: data.owner.phone,
            cost: POINTS_PER_UNLOCK,
            at: new Date().toISOString(),
          });
          setUnlocks(unlocks);
          renderHeader();
          render();
        });
      }
    };

    render();
    window.addEventListener('storage', render);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function bindCopy(scope) {
    scope.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy');
        var state = scope.querySelector('.copy-state');
        var done = function () {
          if (state) { state.textContent = '已复制：' + text; setTimeout(function () { state.textContent = ''; }, 2600); }
        };
        var fallback = function () {
          var ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
          document.body.removeChild(ta);
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
      });
    });
  }
  function currentRelativePath() {
    var p = location.pathname.split('/').slice(-2).join('/');
    return p;
  }

  /* 登录 / 注册 */
  function initAuthPage() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.auth-tab'));
    if (tabs.length) {
      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          tabs.forEach(function (t) {
            var on = t === tab;
            t.setAttribute('aria-selected', String(on));
            var panel = document.getElementById(t.getAttribute('aria-controls'));
            if (panel) panel.hidden = !on;
          });
        });
      });
    }

    var isPhone = function (v) { return /^1[3-9]\d{9}$/.test(String(v || '').trim()); };
    var isCode = function (v) { return /^\d{4,6}$/.test(String(v || '').trim()); };
    var msg = function (form, text, ok) {
      var el = form.querySelector('[data-form-msg]');
      if (!el) return;
      el.textContent = text || '';
      el.style.color = ok ? 'var(--brand)' : 'var(--mark)';
    };
    var next = new URLSearchParams(location.search).get('next');

    var sendBtns = document.querySelectorAll('[data-send-code]');
    sendBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var form = btn.closest('form');
        var phoneField = form ? form.querySelector('input[name="phone"]') : null;
        if (!phoneField || !isPhone(phoneField.value)) return msg(form, '请先填写有效的手机号', false);
        var left = 60;
        btn.disabled = true;
        btn.textContent = left + 's 后重发';
        var timer = setInterval(function () {
          left -= 1;
          if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = '重新获取'; }
          else btn.textContent = left + 's 后重发';
        }, 1000);
        msg(form, '演示环境未接入短信服务，请随意填写 4–6 位数字', true);
      });
    });

    /* 登录成功：写入账号（按手机号）+ 建立会话；仅首次注册赠送积分 */
    var finish = function (user, form, isNew) {
      saveUser(user);
      setSession(user.phone);
      if (isNew) {
        var log = getPointsLog();
        log.unshift({
          delta: SIGNUP_POINTS,
          note: '新用户注册赠送',
          at: new Date().toISOString(),
          balance: user.points,
        });
        setPointsLog(log);
      }
      msg(form, '登录成功，正在跳转…', true);
      setTimeout(function () {
        // 回跳：仅接受本站内的 .html 相对路径，避免开放重定向
        var safe = next && /^[\w\-./]+\.html(\?[\w\-=&%.]*)?$/.test(next) && next.indexOf('..') === -1;
        location.href = safe ? BASE + next : BASE + 'account.html';
      }, 600);
    };

    var loginForm = document.querySelector('[data-login-form]');
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var phone = loginForm.querySelector('[name="phone"]').value.trim();
        var code = loginForm.querySelector('[name="code"]').value;
        if (!isPhone(phone)) return msg(loginForm, '请输入有效的 11 位手机号', false);
        if (!isCode(code)) return msg(loginForm, '请输入 4–6 位验证码', false);
        var existing = findAccount(phone);
        if (existing) return finish(existing, loginForm, false);   // 老用户：保留积分与解锁记录
        finish({
          name: '用户' + phone.slice(-4),
          phone: phone,
          points: SIGNUP_POINTS,
          createdAt: new Date().toISOString(),
        }, loginForm, true);
      });
    }

    var regForm = document.querySelector('[data-register-form]');
    if (regForm) {
      regForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = regForm.querySelector('[name="name"]').value.trim();
        var phone = regForm.querySelector('[name="phone"]').value.trim();
        var code = regForm.querySelector('[name="code"]').value;
        var agree = regForm.querySelector('[name="agree"]').checked;
        if (!name) return msg(regForm, '请填写称呼', false);
        if (!isPhone(phone)) return msg(regForm, '请输入有效的 11 位手机号', false);
        if (!isCode(code)) return msg(regForm, '请输入 4–6 位验证码', false);
        if (!agree) return msg(regForm, '请先阅读并同意用户协议', false);

        var existing = findAccount(phone);
        if (existing) {
          existing.name = name;             // 已注册过：只更新称呼，不重复赠送积分
          return finish(existing, regForm, false);
        }
        finish({
          name: name,
          phone: phone,
          points: SIGNUP_POINTS,
          createdAt: new Date().toISOString(),
        }, regForm, true);
      });
    }
  }

  /* 我的账号与积分 */
  function initAccountPage() {
    var wrap = document.querySelector('[data-account]');
    if (!wrap) return;
    var gate = document.querySelector('[data-requires-login]');
    var user = getUser();

    if (gate) gate.hidden = !!user;
    if (!user) return;
    wrap.hidden = false;

    var nameEl = document.querySelector('[data-user-name]');
    if (nameEl) nameEl.textContent = user.name + '（' + maskPhone(user.phone) + '）';

    document.querySelectorAll('[data-points-value]').forEach(function (el) { el.textContent = pointsOf(user); });
    document.querySelectorAll('[data-points-cost]').forEach(function (el) { el.textContent = POINTS_PER_UNLOCK; });
    document.querySelectorAll('[data-points-gift]').forEach(function (el) { el.textContent = SIGNUP_POINTS; });

    // 积分明细
    var logBody = document.querySelector('[data-points-rows]');
    if (logBody) {
      var log = getPointsLog();
      var empty = document.querySelector('[data-points-empty]');
      if (empty) empty.hidden = log.length !== 0;
      logBody.innerHTML = '';
      log.slice(0, 30).forEach(function (item) {
        var tr = document.createElement('tr');
        var td1 = document.createElement('td');
        td1.textContent = new Date(item.at).toLocaleString('zh-CN', { hour12: false });
        var td2 = document.createElement('td');
        td2.textContent = item.note;
        var td3 = document.createElement('td');
        td3.className = item.delta > 0 ? 'data-table__plus' : 'data-table__minus';
        td3.textContent = (item.delta > 0 ? '+' : '') + item.delta;
        var td4 = document.createElement('td');
        td4.textContent = item.balance != null ? item.balance : '—';
        [td1, td2, td3, td4].forEach(function (td) { tr.appendChild(td); });
        logBody.appendChild(tr);
      });
    }

    // 已解锁房源
    var unlockBody = document.querySelector('[data-unlock-rows]');
    if (unlockBody) {
      var unlocks = getUnlocks();
      var empty2 = document.querySelector('[data-unlock-empty]');
      if (empty2) empty2.hidden = unlocks.length !== 0;
      document.querySelectorAll('[data-unlock-count]').forEach(function (el) { el.textContent = unlocks.length; });
      unlockBody.innerHTML = '';
      unlocks.forEach(function (item) {
        var tr = document.createElement('tr');

        var tdTitle = document.createElement('td');
        tdTitle.className = 'data-table__title';
        var link = document.createElement('a');
        link.href = item.ref;
        link.textContent = item.title;
        link.style.color = 'var(--brand)';
        tdTitle.appendChild(link);

        var tdArea = document.createElement('td');
        tdArea.textContent = (item.district || '') + ' · ' + (item.area ? item.area + '㎡' : '面积详询');

        var tdOwner = document.createElement('td');
        tdOwner.textContent = item.ownerName + '　' + item.ownerPhone;

        var tdTime = document.createElement('td');
        tdTime.textContent = new Date(item.at).toLocaleDateString('zh-CN');

        var tdOps = document.createElement('td');
        var ops = document.createElement('div');
        ops.className = 'table-actions';
        var call = document.createElement('a');
        call.href = 'tel:' + String(item.ownerPhone).replace(/\D/g, '');
        call.textContent = '拨打';
        var view = document.createElement('a');
        view.href = item.ref;
        view.textContent = '查看房源';
        ops.appendChild(call);
        ops.appendChild(view);
        tdOps.appendChild(ops);

        [tdTitle, tdArea, tdOwner, tdTime, tdOps].forEach(function (td) { tr.appendChild(td); });
        unlockBody.appendChild(tr);
      });
    }

    var logout = document.querySelector('[data-logout]');
    if (logout) {
      logout.addEventListener('click', function () {
        if (!confirm('确认退出登录？积分与解锁记录会保留在本机，重新登录同一手机号即可恢复。')) return;
        clearSession();
        location.href = BASE + 'index.html';
      });
    }
  }

  function boot() {
    renderHeader();
    initOwnerCard();
    initAuthPage();
    initAccountPage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

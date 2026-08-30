/* 职场生物 · 天气
 *
 * 只做一件事：拿到「外面什么天」，给 UI 一句话。
 * 不改它做什么、不改它说什么——它开口只因为自己的事，下不下雨不是它的台词。
 *
 * 数据来自 open-meteo：免费、不需要注册、也不需要密钥，所以这一层直接放在渲染进程，
 * 浏览器版和桌面版走同一条路，不用像 LLM 那样把密钥锁进主进程再用 IPC 递结果。
 *
 * 城市存在 localStorage，不进存档：它跟着「这台机器」走，不跟着这只生物走，
 * 导出存档换台电脑打开时，那边的天气该是那边的。
 *
 * 所有失败都安静吞掉，line() 返回空字符串，那一行整个不显示。
 * 天气拿不到不该让任何别的东西出问题——它只是一句补充。
 */
(function (global) {
  'use strict';

  var KEY = 'workplace-creature/weather';
  var FRESH_MS = 30 * 60 * 1000;          // 半小时内不重复请求
  var RETRY_MS = 5 * 60 * 1000;           // 失败了也别马上重试，免得离线时每秒打一次
  var GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  var API_URL = 'https://api.open-meteo.com/v1/forecast';

  function COPY() {
    var d = global.GAME_DATA;
    return (d && d.copy && d.copy.weather) || null;
  }

  // { city, lat, lon, code, temp, at, failAt }
  var state = null;
  var loaded = false;
  var inflight = false;

  function load() {
    if (loaded) return state;
    loaded = true;
    try { state = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { state = null; }
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function getJSON(url) {
    if (typeof fetch !== 'function') return Promise.reject();
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  /* WMO 天气码 → 那一组。码表在 data/copy.json > weather.groups。
   * 没收录的码返回 null——宁可不显示，也不显示一句错的。 */
  function group(code) {
    var c = COPY();
    if (!c || !c.groups) return null;
    for (var i = 0; i < c.groups.length; i++) {
      if (c.groups[i].codes.indexOf(code) >= 0) return c.groups[i];
    }
    return null;
  }

  function fetchNow() {
    var s = load();
    if (!s || s.lat == null) return Promise.resolve(false);
    var url = API_URL + '?latitude=' + s.lat + '&longitude=' + s.lon
            + '&current=temperature_2m,weather_code&timezone=auto';
    return getJSON(url).then(function (d) {
      var cur = d && d.current;
      if (!cur) throw new Error('no current');
      state.code = cur.weather_code;
      state.temp = cur.temperature_2m;
      state.at = Date.now();
      state.failAt = 0;
      save();
      return true;
    })['catch'](function () {
      if (state) { state.failAt = Date.now(); save(); }
      return false;
    });
  }

  global.WEATHER = {
    city: function () { var s = load(); return (s && s.city) || ''; },

    /* 填一次城市。先查经纬度再取天气，两步都成了才写进去——
     * 只写一半会留下一个查得到名字却永远没有天气的城市。 */
    setCity: function (name) {
      name = (name || '').trim();
      if (!name) return Promise.resolve(false);
      var url = GEO_URL + '?name=' + encodeURIComponent(name) + '&count=1&language=zh';
      return getJSON(url).then(function (d) {
        var hit = d && d.results && d.results[0];
        if (!hit) return false;
        state = { city: hit.name, lat: hit.latitude, lon: hit.longitude, at: 0, failAt: 0 };
        loaded = true;
        save();
        return fetchNow().then(function () { return true; });
      })['catch'](function () { return false; });
    },

    forget: function () {
      state = null; loaded = true;
      try { localStorage.removeItem(KEY); } catch (e) {}
    },

    // 该更新就更新。UI 每隔一会儿叫一次，这里自己判断到没到点
    refresh: function () {
      var s = load();
      if (!s || s.lat == null || inflight) return Promise.resolve(false);
      var now = Date.now();
      if (s.at && now - s.at < FRESH_MS) return Promise.resolve(false);
      if (s.failAt && now - s.failAt < RETRY_MS) return Promise.resolve(false);
      inflight = true;
      return fetchNow().then(function (ok) { inflight = false; return ok; },
                             function () { inflight = false; return false; });
    },

    // 拿不到就返回空字符串，那一行整个不显示
    line: function () {
      var s = load(), c = COPY();
      if (!s || !c || s.code == null || !s.at) return '';
      var g = group(s.code);
      if (!g) return '';
      return c.template.replace('{text}', g.text).replace('{temp}', Math.round(s.temp));
    },

    /* 粗分类：rain / snow / thunder / fog / clear / cloud。
     * 引擎按这个挑文案——毛毛雨和大雨在「说什么」上是一回事，不必各写一套。
     * 没天气就返回空字符串，引擎那边当没这回事。 */
    kind: function () {
      var s = load();
      if (!s || s.code == null || !s.at) return '';
      var g = group(s.code);
      return (g && g.kind) || '';
    }
  };
})(window);

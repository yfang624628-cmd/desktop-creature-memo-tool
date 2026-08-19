/* 职场生物 · 便签分类层
 *
 * 边界：分类是概率的，调度是确定的。
 * 这一层只把一句话映射成 {domain, kind, urgency} 三个枚举；
 * 「几点排进日程」「算不算负载」全部由 data/classify.json 的 policy 表决定，不经过任何模型。
 *
 * 两个 provider：
 *   keyword  默认。同步、零依赖、永远可用。
 *   llm      可选增强。由 tools/classify-llm.mjs 离线批量跑，结果写回 note.cls。
 *            没有 key / 离线 / 超时 / 超额，产品都完整可用，只是分得糙一点。
 *
 * 分类现在只有一个用途：判断这件事算不算压在它身上。时段分流随便签日程一起删除了——
 * 你的 memo 不进它的日程，它有自己的一天。
 *
 * 分类结果缓存在便签自己身上（note.cls），一条只分类一次。
 */
(function (global) {
  'use strict';

  var C = global.GAME_DATA.classify;

  function keyword(text) {
    var rules = C.keyword.rules;
    for (var i = 0; i < rules.length; i++) {
      for (var j = 0; j < rules[i].any.length; j++) {
        if (text.indexOf(rules[i].any[j]) >= 0) {
          return {
            domain: rules[i].domain, kind: rules[i].kind, urgency: rules[i].urgency,
            source: 'keyword'
          };
        }
      }
    }
    var d = C.keyword.default;
    return { domain: d.domain, kind: d.kind, urgency: d.urgency, source: 'keyword' };
  }

  // 便签的分类。已经分过就直接用，没分过就现场跑关键词并缓存下来。
  function of(note) {
    if (note.cls && note.cls.domain) return note.cls;
    note.cls = keyword(note.text);
    return note.cls;
  }

  /* countsAsLoad 已删除：它的理由（买饺子不该让它掉状态）随状态系统一起消失了。
   * 分类结果目前没有任何消费方——保留这一层是因为将来想让「买饺子」和「改方案」
   * 在画面上不一样时，接回来比重写便宜。 */

  global.Classify = {
    of: of,
    keyword: keyword,
    DATA: C
  };
})(window);

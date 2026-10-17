/* Native micro-interactions. CDS_EASING.EASE_OUT_EXPO from open-claude-ui.
   Presentation only: no score, account, ordering or network state is written here. */
(function () {
  'use strict';
  var ease = 'cubic-bezier(0.16, 1, 0.3, 1)';
  var animations = new WeakMap(), timers = new WeakMap();
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function animate(el, frames, duration) {
    if (!el || reduced() || typeof el.animate !== 'function') return;
    var old = animations.get(el); if (old) old.cancel();
    var a = el.animate(frames, {duration: duration, easing: ease});
    animations.set(el, a);
  }
  function clear() {
    document.querySelectorAll('.score-feedback-target').forEach(function (el) {
      el.classList.remove('score-feedback-target'); clearTimeout(timers.get(el));
      var a = animations.get(el); if (a) a.cancel();
    });
    document.querySelectorAll('.score-delta').forEach(function (el) { el.remove(); });
  }
  function target(gno, field, index) {
    var card = document.querySelector('#groupList [data-card="' + gno + '"]');
    if (!card) return null;
    if (index != null) return card.querySelector('.pchip[data-i="' + index + '"]');
    if (field === 'first') return card.querySelector('[data-act="first"]');
    return field ? card.querySelector('input.num[data-f="' + field + '"]') : card;
  }
  function feedback(gno, field, index, delta, label, undo) {
    if (undo) clear();
    var el = target(gno, field, index);
    if (!el || (!undo && !delta)) return;
    clearTimeout(timers.get(el)); el.classList.add('score-feedback-target');
    animate(el, [{transform:'scale(1)'},{transform:'scale(1.045)',offset:.4},{transform:'scale(1)'}], 180);
    timers.set(el, setTimeout(function () { el.classList.remove('score-feedback-target'); }, 650));
    var live = document.getElementById('scoreFeedbackStatus');
    if (!live) { live = document.createElement('div'); live.id = 'scoreFeedbackStatus'; live.className = 'sr-feedback'; live.setAttribute('role','status'); live.setAttribute('aria-live','polite'); document.body.appendChild(live); }
    live.textContent = label;
    var bubble = document.createElement('span'); bubble.className = 'score-delta';
    bubble.textContent = undo ? '已撤销' : ((delta > 0 ? '+' : '−') + Math.abs(delta));
    bubble.setAttribute('aria-hidden','true');
    var r = el.getBoundingClientRect();
    var card = el.closest('.gcard');
    var control = el.closest('.gctl > div');
    var feedbackLane = card && (control ? control.querySelector('.lbl') :
      (el.matches('.pchip') ? card.querySelector('.plabel') : card.querySelector('.card-feedback-space')));
    if (feedbackLane) {
      var lane = feedbackLane.getBoundingClientRect();
      r = {left: lane.right - 48, width: 48, top: lane.top + 23};
      bubble.classList.add('in-card');
    }
    bubble.style.left = Math.max(32,Math.min(innerWidth - 40,r.left + r.width / 2)) + 'px';
    bubble.style.top = Math.max(8,r.top - 23) + 'px';
    var bubbles = document.querySelectorAll('.score-delta'); if (bubbles.length >= 8) bubbles[0].remove();
    document.body.appendChild(bubble);
    animate(bubble,[{opacity:1,translate:'0 0'},{opacity:0,translate:feedbackLane ? '0 0' : '0 -16px'}],500);
    setTimeout(function () { bubble.remove(); }, 520);
  }
  function pill() {
    var seg = document.getElementById('layoutSeg'), on = seg && seg.querySelector('button.on');
    if (!on || !on.offsetWidth) return;
    seg.style.setProperty('--layout-pill-x',on.offsetLeft + 'px');
    seg.style.setProperty('--layout-pill-width',on.offsetWidth + 'px');
    seg.classList.add('motion-ready');
    seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed',String(b === on)); });
  }
  function layout(render) {
    clear();
    var host = document.getElementById('groupList'), x = window.scrollX, y = window.scrollY;
    var top = host.getBoundingClientRect().top + y;
    host.style.minHeight = host.offsetHeight + 'px';
    render();
    host.style.minHeight = Math.max(0,y + innerHeight - top) + 'px';
    window.scrollTo(x,y); pill();
    animate(host,[{opacity:.65},{opacity:1}],160);
  }
  window.addEventListener('resize',pill);
  window.JFDT_UI = {feedback:feedback, clear:clear, pill:pill, layout:layout, reduced:reduced};
})();

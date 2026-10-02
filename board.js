/*
 * Interactive zugzwang board. You play White; Black is played by ZZEngine.
 * Every scenario starts with White to move and White in zugzwang: the
 * position would be fine if White could pass, but every legal move hurts.
 */
(function () {
  'use strict';

  var E = window.ZZEngine;
  var root = document.getElementById('zz-board');
  if (!E || !root) return;

  var SCENARIOS = [
    { name: 'The Trébuchet',        fen: '8/8/8/3pK3/2kP4/8/8/8 w - - 0 1' },
    { name: 'The Opposition',       fen: '8/8/8/4p3/4k3/8/4K3/8 w - - 0 1' },
    { name: 'The Double Trébuchet', fen: '8/8/3K4/2p1p3/2PkP3/8/8/8 w - - 0 1' },
    { name: 'The Mutual Guard',     fen: '8/8/8/1p6/1P3Kp1/6Pk/8/8 w - - 0 1' },
    { name: 'The Standoff',         fen: '8/6k1/3p4/3Pp1K1/4P3/8/8/8 w - - 0 1' },
    { name: 'The Last Tempo',       fen: '8/6p1/8/8/pKp5/P1P5/1k4P1/8 w - - 0 1' },
    { name: 'The Knight’s Burden',  fen: '8/8/8/5p2/5P2/6p1/7k/5KN1 w - - 0 1' },
    { name: 'The Corner Rook',      fen: '8/8/p7/P7/8/6k1/7p/5K1R w - - 0 1' },
    { name: 'The Rook’s Watch',     fen: '8/8/8/7p/7P/1k6/p7/R1K5 w - - 0 1' },
    { name: 'The Edge',             fen: '8/8/8/8/1pK1p3/kP2P3/8/8 w - - 0 1' }
  ];

  var SHAPES = {
    k: '<rect x="12" y="35" width="21" height="4.5" rx="1.5"/><path d="M15.5 35 18 18h9l2.5 17z"/><rect x="16" y="14" width="13" height="3.2" rx="1"/><rect x="21.25" y="3.5" width="2.5" height="10"/><rect x="18" y="6.5" width="9" height="2.5"/>',
    q: '<rect x="12" y="35" width="21" height="4.5" rx="1.5"/><path d="M15.5 35 18 19h9l2.5 16z"/><path d="M14.5 17.5 16.5 8l4 6 2-8 2 8 4-6 2 9.5z"/>',
    r: '<rect x="12" y="35" width="21" height="4.5" rx="1.5"/><path d="M16 35l1.5-17.5h10L29 35z"/><path d="M14 9h3.6v3.2h3.1V9h3.6v3.2h3.1V9H31v7.5H14z"/>',
    b: '<rect x="13" y="35" width="19" height="4.5" rx="1.5"/><path d="M17 35l2.3-10.5h6.4L28 35z"/><rect x="17.5" y="21.8" width="10" height="2.6" rx="1"/><path d="M22.5 6.8c3.6 3.3 6 6.9 6 10.2 0 3-2.6 4.8-6 4.8s-6-1.8-6-4.8c0-3.3 2.4-6.9 6-10.2z"/><circle cx="22.5" cy="5" r="1.9"/>',
    n: '<rect x="12" y="35" width="21" height="4.5" rx="1.5"/><path d="M15.5 35c0-5.2 2.6-8.3 5.8-10.8-2.3.7-4.8.4-6.8-1-1.5-1-1.7-2.9-.6-4.4L20.8 12l.9-4.8 2.8 2.9c5.8 1.3 9.3 6.8 8.8 14.7L32.8 35z"/>',
    p: '<rect x="13" y="35" width="19" height="4.5" rx="1.5"/><path d="M17 35 19.3 22h6.4L28 35z"/><circle cx="22.5" cy="16" r="5.5"/>'
  };
  var NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
  var FILES = 'abcdefgh';
  var sqName = function (s) { return FILES[E.fileOf(s)] + (8 - E.rowOf(s)); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  var grid = root.querySelector('.zz-squares');
  var layer = root.querySelector('.zz-pieces');
  var statusEl = document.getElementById('zz-status');
  var nameEl = document.getElementById('zz-name');
  var countEl = document.getElementById('zz-count');

  var index = 0, pos, pieces, selected, lastMove, busy, over, seen, history, token = 0;

  for (var r = 0; r < 8; r++) {
    for (var f = 0; f < 8; f++) {
      var d = document.createElement('div');
      d.className = 'zz-sq ' + ((f + r) % 2 ? 'dark' : 'light');
      d.dataset.sq = r * 8 + f;
      grid.appendChild(d);
    }
  }

  function place(el, s) {
    el.style.transform = 'translate(' + E.fileOf(s) * 100 + '%,' + E.rowOf(s) * 100 + '%)';
  }

  function label(p) {
    return (p.color === 'w' ? 'White ' : 'Black ') + NAMES[p.type] + ' on ' + sqName(p.sq);
  }

  function makePiece(code, s) {
    var p = { color: E.colorOf(code), type: code.toLowerCase(), sq: s, el: document.createElement('div') };
    p.el.className = 'zz-piece ' + p.color;
    p.el.innerHTML = '<svg viewBox="0 0 45 45" aria-hidden="true">' + SHAPES[p.type] + '</svg>';
    p.el.setAttribute('role', 'img');
    p.el.setAttribute('aria-label', label(p));
    place(p.el, s);
    layer.appendChild(p.el);
    return p;
  }

  function pieceAt(s) {
    for (var i = 0; i < pieces.length; i++) if (pieces[i].sq === s) return pieces[i];
    return null;
  }

  function load(i) {
    token++;
    index = (i + SCENARIOS.length) % SCENARIOS.length;
    var sc = SCENARIOS[index];
    pos = E.fromFen(sc.fen);
    layer.innerHTML = '';
    pieces = [];
    pos.b.forEach(function (code, s) { if (code) pieces.push(makePiece(code, s)); });
    selected = null; lastMove = null; busy = false; over = false;
    history = [E.hash(pos)];
    seen = {}; seen[history[0]] = 1;

    nameEl.textContent = sc.name;
    countEl.textContent = pad(index + 1) + ' / ' + pad(SCENARIOS.length);
    root.setAttribute('aria-label', sc.name + ', White to move');
    [layer, nameEl].forEach(function (el) {
      el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    });
    setStatus('White to move.');
    paint();
  }

  function setStatus(text) { statusEl.textContent = text; }

  function paint() {
    var targets = selected !== null ? E.legalMoves(pos).filter(function (m) { return m.from === selected; }) : [];
    grid.querySelectorAll('.zz-sq').forEach(function (el) {
      var s = +el.dataset.sq;
      el.classList.toggle('last', !!lastMove && (lastMove.from === s || lastMove.to === s));
      el.classList.toggle('sel', selected === s);
      var t = targets.filter(function (m) { return m.to === s; })[0];
      el.classList.toggle('dot', !!t && !t.cap);
      el.classList.toggle('ring', !!t && !!t.cap);
    });
    root.classList.toggle('active', !busy && !over && pos.turn === 'w');
  }

  function play(m) {
    var mover = pieceAt(m.from);
    var victim = m.cap ? pieceAt(m.ep ? m.to + (pos.turn === 'w' ? 8 : -8) : m.to) : null;
    if (victim) {
      pieces.splice(pieces.indexOf(victim), 1);
      victim.el.classList.add('gone');
      setTimeout(function () { victim.el.remove(); }, 300);
    }
    mover.sq = m.to;
    place(mover.el, m.to);
    if (m.promo) {
      mover.type = m.promo;
      mover.el.querySelector('svg').innerHTML = SHAPES[m.promo];
    }
    mover.el.setAttribute('aria-label', label(mover));

    var who = pos.turn === 'w' ? 'White' : 'Black';
    E.make(pos, m);
    lastMove = m;
    selected = null;
    var key = E.hash(pos);
    history.push(key);
    seen[key] = (seen[key] || 0) + 1;

    if (!E.legalMoves(pos).length) {
      return finish(E.inCheck(pos) ? 'Checkmate. ' + who + ' wins.' : 'Stalemate. A draw.');
    }
    if (E.insufficient(pos)) return finish('Draw. Nothing left to mate with.');
    if (seen[key] >= 3) return finish('Draw by repetition.');

    if (m.promo) setStatus(who + ' queens.');
    else if (E.inCheck(pos)) setStatus('Check.');
    else if (m.cap) setStatus(who + ' takes on ' + sqName(m.to) + '.');
    else setStatus(pos.turn === 'w' ? 'White to move.' : 'Black to move…');
    return false;
  }

  function finish(text) {
    over = true;
    setStatus(text);
    paint();
    return true;
  }

  function humanMove(m) {
    busy = true;
    var ended = play(m);
    paint();
    if (ended) return;
    var t = token;
    // Let the move animate before the (blocking) search starts.
    setTimeout(function () {
      if (t !== token) return;
      var reply = E.think(pos, { ms: 700, history: history }).move;
      if (t !== token || !reply) return;
      play(reply);
      busy = false;
      paint();
    }, 380);
  }

  function tryMove(from, to) {
    var m = E.legalMoves(pos).filter(function (x) { return x.from === from && x.to === to; })[0];
    if (m) { humanMove(m); return true; }
    return false;
  }

  function squareFromPoint(x, y) {
    var b = grid.getBoundingClientRect();
    var f = Math.floor((x - b.left) / (b.width / 8));
    var r = Math.floor((y - b.top) / (b.height / 8));
    return (f < 0 || f > 7 || r < 0 || r > 7) ? null : r * 8 + f;
  }

  // Click-to-move and drag-and-drop share one pointer path.
  var drag = null;

  root.addEventListener('pointerdown', function (e) {
    if (busy || over || pos.turn !== 'w') return;
    var s = squareFromPoint(e.clientX, e.clientY);
    if (s === null) return;
    var p = pieceAt(s);
    if (selected !== null && selected !== s && tryMove(selected, s)) return;
    if (p && p.color === 'w') {
      selected = s;
      paint();
      drag = { piece: p, x: e.clientX, y: e.clientY, moved: false };
      try { root.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    } else {
      selected = null;
      paint();
    }
  });

  root.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    var el = drag.piece.el, s = drag.piece.sq;
    el.classList.add('dragging');
    el.style.transform = 'translate(calc(' + E.fileOf(s) * 100 + '% + ' + dx + 'px), calc(' +
      E.rowOf(s) * 100 + '% + ' + dy + 'px)) scale(1.08)';
  });

  function endDrag(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.piece.el.classList.remove('dragging');
    if (!d.moved) return;
    var to = squareFromPoint(e.clientX, e.clientY);
    if (to === null || !tryMove(d.piece.sq, to)) place(d.piece.el, d.piece.sq);
  }

  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  document.getElementById('zz-prev').addEventListener('click', function () { load(index - 1); });
  document.getElementById('zz-next').addEventListener('click', function () { load(index + 1); });
  document.getElementById('zz-reset').addEventListener('click', function () { load(index); });
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') load(index - 1);
    else if (e.key === 'ArrowRight') load(index + 1);
  });

  load(0);
})();

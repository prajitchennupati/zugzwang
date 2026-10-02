/*
 * A small chess engine for the zugzwang board.
 * Full piece movement, en passant and promotion; no castling, since every
 * position on the board is an endgame. Search is iterative-deepening
 * alpha-beta with a transposition table and a capture-only quiescence pass.
 */
(function (global) {
  'use strict';

  var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  var MATE = 100000;
  var N = -8, S = 8, E = 1, W = -1;
  var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  // Squares: 0 = a8 … 63 = h1, so row 0 is rank 8.
  var fileOf = function (s) { return s & 7; };
  var rowOf = function (s) { return s >> 3; };
  var at = function (f, r) { return (f < 0 || f > 7 || r < 0 || r > 7) ? -1 : r * 8 + f; };
  var colorOf = function (pc) { return pc === pc.toUpperCase() ? 'w' : 'b'; };
  var other = function (c) { return c === 'w' ? 'b' : 'w'; };
  var dist = function (a, b) {
    return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rowOf(a) - rowOf(b)));
  };

  // ---------- Zobrist keys (two 32-bit halves → one safe integer) ----------
  var seed = 0x2545f491;
  function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
  var PIECES = 'PNBRQKpnbrqk';
  var ZA = [], ZB = [];
  for (var i = 0; i < 12 * 64; i++) { ZA.push(rnd()); ZB.push(rnd() & 0x1fffff); }
  var ZSIDE_A = rnd(), ZSIDE_B = rnd() & 0x1fffff;

  function hash(pos) {
    var a = 0, b = 0;
    for (var s = 0; s < 64; s++) {
      var pc = pos.b[s];
      if (pc) { var z = PIECES.indexOf(pc) * 64 + s; a ^= ZA[z]; b ^= ZB[z]; }
    }
    if (pos.turn === 'b') { a ^= ZSIDE_A; b ^= ZSIDE_B; }
    if (pos.ep >= 0) a ^= ZA[pos.ep];
    return (a >>> 0) + b * 4294967296;
  }

  // ---------- Position ----------
  function fromFen(fen) {
    var parts = fen.split(' '), b = [], rows = parts[0].split('/');
    rows.forEach(function (row) {
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (/\d/.test(ch)) for (var n = 0; n < +ch; n++) b.push('');
        else b.push(ch);
      }
    });
    var ep = -1;
    if (parts[3] && parts[3] !== '-') ep = at('abcdefgh'.indexOf(parts[3][0]), 8 - +parts[3][1]);
    return { b: b, turn: parts[1] || 'w', ep: ep, kings: { w: b.indexOf('K'), b: b.indexOf('k') } };
  }

  function clone(pos) {
    return { b: pos.b.slice(), turn: pos.turn, ep: pos.ep, kings: { w: pos.kings.w, b: pos.kings.b } };
  }

  function attacked(pos, s, by) {
    var b = pos.b, f = fileOf(s), r = rowOf(s), i, t, pc;
    var up = by === 'w' ? 1 : -1; // white pawns attack toward row-1, so look at row+1
    var pawn = by === 'w' ? 'P' : 'p', knight = by === 'w' ? 'N' : 'n', king = by === 'w' ? 'K' : 'k';
    var bish = by === 'w' ? 'B' : 'b', rook = by === 'w' ? 'R' : 'r', queen = by === 'w' ? 'Q' : 'q';
    t = at(f - 1, r + up); if (t >= 0 && b[t] === pawn) return true;
    t = at(f + 1, r + up); if (t >= 0 && b[t] === pawn) return true;
    for (i = 0; i < 8; i++) {
      t = at(f + KNIGHT[i][0], r + KNIGHT[i][1]); if (t >= 0 && b[t] === knight) return true;
      t = at(f + KING[i][0], r + KING[i][1]); if (t >= 0 && b[t] === king) return true;
    }
    for (i = 0; i < 4; i++) {
      var df = ROOK[i][0], dr = ROOK[i][1], nf = f + df, nr = r + dr;
      while ((t = at(nf, nr)) >= 0) {
        pc = b[t];
        if (pc) { if (pc === rook || pc === queen) return true; break; }
        nf += df; nr += dr;
      }
      df = BISHOP[i][0]; dr = BISHOP[i][1]; nf = f + df; nr = r + dr;
      while ((t = at(nf, nr)) >= 0) {
        pc = b[t];
        if (pc) { if (pc === bish || pc === queen) return true; break; }
        nf += df; nr += dr;
      }
    }
    return false;
  }

  function inCheck(pos, c) { return attacked(pos, pos.kings[c || pos.turn], other(c || pos.turn)); }

  function pseudo(pos, capturesOnly) {
    var b = pos.b, c = pos.turn, out = [];
    for (var s = 0; s < 64; s++) {
      var pc = b[s];
      if (!pc || colorOf(pc) !== c) continue;
      var type = pc.toLowerCase(), f = fileOf(s), r = rowOf(s), t, i;
      if (type === 'p') {
        var dir = c === 'w' ? -1 : 1, start = c === 'w' ? 6 : 1, last = c === 'w' ? 0 : 7;
        t = at(f, r + dir);
        if (!capturesOnly || rowOf(t) === last) {
          if (t >= 0 && !b[t]) {
            out.push({ from: s, to: t, promo: rowOf(t) === last ? 'q' : null });
            var t2 = at(f, r + 2 * dir);
            if (!capturesOnly && r === start && !b[t2]) out.push({ from: s, to: t2, dbl: true });
          }
        }
        [-1, 1].forEach(function (df) {
          var x = at(f + df, r + dir);
          if (x < 0) return;
          if (b[x] && colorOf(b[x]) !== c) out.push({ from: s, to: x, cap: b[x], promo: rowOf(x) === last ? 'q' : null });
          else if (x === pos.ep) out.push({ from: s, to: x, cap: c === 'w' ? 'p' : 'P', ep: true });
        });
      } else if (type === 'n' || type === 'k') {
        var offs = type === 'n' ? KNIGHT : KING;
        for (i = 0; i < 8; i++) {
          t = at(f + offs[i][0], r + offs[i][1]);
          if (t < 0) continue;
          if (!b[t]) { if (!capturesOnly) out.push({ from: s, to: t }); }
          else if (colorOf(b[t]) !== c) out.push({ from: s, to: t, cap: b[t] });
        }
      } else {
        var dirs = type === 'r' ? ROOK : type === 'b' ? BISHOP : ROOK.concat(BISHOP);
        for (i = 0; i < dirs.length; i++) {
          var nf = f + dirs[i][0], nr = r + dirs[i][1];
          while ((t = at(nf, nr)) >= 0) {
            if (!b[t]) { if (!capturesOnly) out.push({ from: s, to: t }); }
            else { if (colorOf(b[t]) !== c) out.push({ from: s, to: t, cap: b[t] }); break; }
            nf += dirs[i][0]; nr += dirs[i][1];
          }
        }
      }
    }
    return out;
  }

  function make(pos, m) {
    var b = pos.b, c = pos.turn, pc = b[m.from];
    var undo = { m: m, pc: pc, cap: b[m.to], ep: pos.ep, kw: pos.kings.w, kb: pos.kings.b };
    b[m.to] = m.promo ? (c === 'w' ? m.promo.toUpperCase() : m.promo) : pc;
    b[m.from] = '';
    if (m.ep) { undo.epSq = m.to + (c === 'w' ? S : N); undo.epPc = b[undo.epSq]; b[undo.epSq] = ''; }
    if (pc === 'K') pos.kings.w = m.to; else if (pc === 'k') pos.kings.b = m.to;
    pos.ep = m.dbl ? (m.from + m.to) / 2 : -1;
    pos.turn = other(c);
    return undo;
  }

  function unmake(pos, u) {
    var b = pos.b, m = u.m;
    b[m.from] = u.pc;
    b[m.to] = u.cap;
    if (m.ep) b[u.epSq] = u.epPc;
    pos.ep = u.ep; pos.kings.w = u.kw; pos.kings.b = u.kb;
    pos.turn = other(pos.turn);
  }

  function legalMoves(pos, capturesOnly) {
    var c = pos.turn;
    return pseudo(pos, capturesOnly).filter(function (m) {
      var u = make(pos, m);
      var ok = !attacked(pos, pos.kings[c], other(c));
      unmake(pos, u);
      return ok;
    });
  }

  function insufficient(pos) {
    var minors = 0;
    for (var s = 0; s < 64; s++) {
      var t = pos.b[s].toLowerCase();
      if (t === 'p' || t === 'r' || t === 'q') return false;
      if (t === 'n' || t === 'b') minors++;
    }
    return minors <= 1;
  }

  // ---------- Evaluation (white's point of view) ----------
  function evaluate(pos) {
    var b = pos.b, score = 0, mat = { w: 0, b: 0 }, pieces = { w: 0, b: 0 }, pawns = [];
    for (var s = 0; s < 64; s++) {
      var pc = b[s];
      if (!pc) continue;
      var c = colorOf(pc), t = pc.toLowerCase(), sign = c === 'w' ? 1 : -1;
      mat[c] += VAL[t];
      if (t === 'p') pawns.push(s);
      else if (t !== 'k') pieces[c]++;
      if (t === 'n' || t === 'b') score += sign * (6 - 2 * dist(s, 27) - 2 * dist(s, 36)) * 2;
    }
    score += mat.w - mat.b;

    pawns.forEach(function (s) {
      var pc = b[s], c = colorOf(pc), sign = c === 'w' ? 1 : -1, o = other(c);
      var adv = c === 'w' ? 6 - rowOf(s) : rowOf(s) - 1;          // 0..5
      var dir = c === 'w' ? -1 : 1, f = fileOf(s), passed = true;
      for (var r = rowOf(s) + dir; r >= 0 && r <= 7 && passed; r += dir) {
        for (var df = -1; df <= 1; df++) {
          var x = at(f + df, r);
          if (x >= 0 && b[x] === (c === 'w' ? 'p' : 'P')) { passed = false; break; }
        }
      }
      score += sign * adv * adv * 4;
      if (passed) {
        var goal = at(f, c === 'w' ? 0 : 7);
        score += sign * (15 + adv * adv * 8);
        score += sign * 6 * (dist(pos.kings[o], s) - dist(pos.kings[c], s));
        if (!pieces[o]) {
          var steps = 5 - adv + 1 - (adv === 0 ? 1 : 0);
          var theirs = dist(pos.kings[o], goal) - (pos.turn === o ? 1 : 0);
          if (theirs > steps) score += sign * 700;
        }
      }
    });

    // Kings: centralise in the endgame; drive a lone king to the edge.
    ['w', 'b'].forEach(function (c) {
      var sign = c === 'w' ? 1 : -1, k = pos.kings[c];
      score += sign * (6 - dist(k, 27) - dist(k, 36)) * 3;
      if (mat[c] - mat[other(c)] >= 400 && mat[other(c)] === 0) {
        var ok = pos.kings[other(c)];
        var edge = Math.min(fileOf(ok), 7 - fileOf(ok), rowOf(ok), 7 - rowOf(ok));
        score += sign * ((3 - edge) * 30 + (7 - dist(k, ok)) * 12);
      }
    });
    return score;
  }

  // ---------- Search ----------
  function Searcher(deadline, history, maxNodes) {
    this.deadline = deadline;
    this.maxNodes = maxNodes;
    this.tt = new Map();
    this.path = history.slice();
    this.nodes = 0;
    this.stopped = false;
  }

  Searcher.prototype.timeUp = function () {
    if ((++this.nodes & 1023) === 0 && (Date.now() > this.deadline || this.nodes > this.maxNodes)) this.stopped = true;
    return this.stopped;
  };

  function orderMoves(moves, best) {
    moves.forEach(function (m) {
      m.o = (best && m.from === best.from && m.to === best.to) ? 1e6
        : (m.cap ? 10 * VAL[m.cap.toLowerCase()] + 1000 : 0) + (m.promo ? 5000 : 0);
    });
    return moves.sort(function (a, b) { return b.o - a.o; });
  }

  Searcher.prototype.quiesce = function (pos, alpha, beta, ply) {
    var stand = pos.turn === 'w' ? evaluate(pos) : -evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 40) return stand;
    var moves = orderMoves(legalMoves(pos, true));
    for (var i = 0; i < moves.length; i++) {
      var u = make(pos, moves[i]);
      var sc = -this.quiesce(pos, -beta, -alpha, ply + 1);
      unmake(pos, u);
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  };

  Searcher.prototype.search = function (pos, depth, alpha, beta, ply) {
    if (this.timeUp()) return 0;
    var key = hash(pos);
    if (ply > 0) {
      if (this.path.indexOf(key) !== -1) return 0;
      if (insufficient(pos)) return 0;
    }
    var check = inCheck(pos);
    if (check && ply < 30) depth++;
    var entry = this.tt.get(key), best = null;
    if (entry) {
      best = entry.best;
      if (ply > 0 && entry.depth >= depth) {
        if (entry.flag === 0) return entry.score;
        if (entry.flag === 1 && entry.score >= beta) return entry.score;
        if (entry.flag === -1 && entry.score <= alpha) return entry.score;
      }
    }
    var moves = legalMoves(pos);
    if (!moves.length) return check ? -MATE + ply : 0;
    if (depth <= 0) return this.quiesce(pos, alpha, beta, ply);

    orderMoves(moves, best);
    var a0 = alpha, bestScore = -Infinity;
    this.path.push(key);
    for (var i = 0; i < moves.length; i++) {
      var u = make(pos, moves[i]);
      var sc = -this.search(pos, depth - 1, -beta, -alpha, ply + 1);
      unmake(pos, u);
      if (this.stopped) break;
      if (sc > bestScore) { bestScore = sc; best = moves[i]; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    this.path.pop();
    if (!this.stopped) {
      this.tt.set(key, {
        depth: depth, score: bestScore, best: best,
        flag: bestScore <= a0 ? -1 : bestScore >= beta ? 1 : 0
      });
    }
    return bestScore;
  };

  // Returns { move, score, depth } with score from the mover's point of view.
  function think(pos, opts) {
    opts = opts || {};
    var p = clone(pos);
    var s = new Searcher(Date.now() + (opts.ms || 500), opts.history || [], opts.maxNodes || 600000);
    var result = { move: null, score: 0, depth: 0 };
    var root = legalMoves(p);
    if (!root.length) return result;
    for (var d = 1; d <= (opts.maxDepth || 64); d++) {
      var alpha = -Infinity, best = null;
      orderMoves(root, result.move);
      s.path.push(hash(p));
      for (var i = 0; i < root.length; i++) {
        var u = make(p, root[i]);
        var sc = -s.search(p, d - 1, -Infinity, -alpha, 1);
        unmake(p, u);
        if (s.stopped) break;
        if (sc > alpha) { alpha = sc; best = root[i]; }
      }
      s.path.pop();
      if (s.stopped && !best) break;
      if (best) result = { move: best, score: alpha, depth: d };
      if (s.stopped || Math.abs(alpha) > MATE - 200) break;
    }
    return result;
  }

  var Engine = {
    fromFen: fromFen, clone: clone, legalMoves: legalMoves, make: make, unmake: unmake,
    inCheck: inCheck, insufficient: insufficient, think: think, hash: hash, evaluate: evaluate,
    fileOf: fileOf, rowOf: rowOf, colorOf: colorOf, MATE: MATE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else global.ZZEngine = Engine;
})(this);

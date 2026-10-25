/* Procedural 16x16 pixel-art portraits. Exposes window.drawAvatar(canvas, key). */
(function () {
  'use strict';

  var SPRITES = {
    sentinel: { skin: '#F2C9A5', hair: '#3B2F2F', style: 'short',    shirt: '#5B7FA6', trim: '#D9E4F2', deco: 'badge',   hat: null },
    medic:    { skin: '#E8B99A', hair: '#7A4A2B', style: 'bun',      shirt: '#F5F5F5', trim: '#E0556B', deco: 'cross',   hat: null },
    rescue:   { skin: '#B9825F', hair: '#1E1A1A', style: 'long',     shirt: '#E08A3C', trim: '#F2D16B', deco: 'stripe',  hat: '#E08A3C' },
    guardian: { skin: '#D9A77F', hair: '#A8A29E', style: 'short',    shirt: '#4E6E58', trim: '#C9B37E', deco: 'collar',  hat: null },
    scout:    { skin: '#F0C7A0', hair: '#D9A441', style: 'ponytail', shirt: '#6B8F5E', trim: '#8B6A3E', deco: 'scarf',   hat: '#6B8F5E' },
    coach:    { skin: '#8D5A3B', hair: '#222222', style: 'curly',    shirt: '#8E7AC7', trim: '#F2F2F2', deco: 'whistle', hat: null }
  };

  var INK = '#2A2030';
  var BLUSH = '#E8A0A0';
  var MOUTH = '#A4505A';

  function blank() {
    var g = [];
    for (var y = 0; y < 16; y++) {
      var row = [];
      for (var x = 0; x < 16; x++) row.push(null);
      g.push(row);
    }
    return g;
  }

  function put(g, x, y, c) {
    if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c;
  }

  function rect(g, x0, y0, x1, y1, c) {
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) put(g, x, y, c);
    }
  }

  function darken(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.round(((n >> 16) & 255) * f);
    var gg = Math.round(((n >> 8) & 255) * f);
    var b = Math.round((n & 255) * f);
    return 'rgb(' + r + ',' + gg + ',' + b + ')';
  }

  function hair(g, sp) {
    var c = sp.hair;
    rect(g, 5, 2, 10, 2, c);
    rect(g, 4, 3, 11, 3, c);
    rect(g, 4, 4, 4, 5, c);
    rect(g, 11, 4, 11, 5, c);
    if (sp.style === 'long') {
      rect(g, 3, 4, 3, 11, c);
      rect(g, 12, 4, 12, 11, c);
    } else if (sp.style === 'bun') {
      rect(g, 7, 0, 8, 1, c);
    } else if (sp.style === 'ponytail') {
      rect(g, 12, 4, 13, 8, c);
    } else if (sp.style === 'curly') {
      rect(g, 4, 1, 11, 1, c);
      rect(g, 3, 3, 3, 6, c);
      rect(g, 12, 3, 12, 6, c);
    }
  }

  function deco(g, sp) {
    var t = sp.trim;
    if (sp.deco === 'badge') {
      put(g, 10, 12, t);
      put(g, 10, 13, t);
    } else if (sp.deco === 'cross') {
      put(g, 7, 12, t); put(g, 8, 12, t);
      put(g, 6, 13, t); put(g, 7, 13, t); put(g, 8, 13, t); put(g, 9, 13, t);
      put(g, 7, 14, t); put(g, 8, 14, t);
    } else if (sp.deco === 'stripe') {
      rect(g, 3, 13, 12, 13, t);
    } else if (sp.deco === 'collar') {
      rect(g, 6, 11, 9, 11, t);
    } else if (sp.deco === 'scarf') {
      rect(g, 4, 11, 11, 11, t);
      put(g, 10, 12, t);
      put(g, 10, 13, t);
    } else if (sp.deco === 'whistle') {
      rect(g, 6, 11, 9, 11, t);
      put(g, 8, 12, t);
      put(g, 8, 13, t);
    }
  }

  function build(sp, blink) {
    var g = blank();

    // Body
    rect(g, 3, 11, 12, 15, sp.shirt);
    // Neck
    rect(g, 6, 10, 9, 10, sp.skin);
    // Head
    rect(g, 5, 3, 10, 3, sp.skin);
    rect(g, 4, 4, 11, 8, sp.skin);
    rect(g, 5, 9, 10, 9, sp.skin);

    hair(g, sp);

    if (sp.hat) {
      rect(g, 5, 0, 10, 1, sp.hat);
      rect(g, 3, 2, 12, 2, sp.hat);
    }

    // Face
    var eye = blink ? darken(sp.skin, 0.6) : INK;
    put(g, 6, 6, eye);
    put(g, 9, 6, eye);
    put(g, 5, 8, BLUSH);
    put(g, 10, 8, BLUSH);
    put(g, 7, 8, MOUTH);
    put(g, 8, 8, MOUTH);

    deco(g, sp);

    // 1px darker outline on the silhouette edge
    var src = g.map(function (row) { return row.slice(); });
    for (var y = 0; y < 16; y++) {
      for (var x = 0; x < 16; x++) {
        var c = src[y][x];
        if (!c || c.charAt(0) !== '#') continue;
        var edge = false;
        var nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (var i = 0; i < nb.length; i++) {
          var nx = nb[i][0], ny = nb[i][1];
          if (nx < 0 || nx > 15 || ny < 0 || ny > 15 || !src[ny][nx]) { edge = true; break; }
        }
        if (edge) g[y][x] = darken(c, 0.55);
      }
    }
    return g;
  }

  function paint(canvas, key, blink) {
    var sp = SPRITES[key] || SPRITES.sentinel;
    var g = build(sp, blink);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 16, 16);
    for (var y = 0; y < 16; y++) {
      for (var x = 0; x < 16; x++) {
        if (g[y][x]) {
          ctx.fillStyle = g[y][x];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  var live = [];
  var blinking = false;

  function redrawAll() {
    live = live.filter(function (e) { return e.canvas.isConnected; });
    live.forEach(function (e) { paint(e.canvas, e.key, blinking); });
  }

  function drawAvatar(canvas, key) {
    if (!canvas || !canvas.getContext) return;
    canvas.width = 16;
    canvas.height = 16;
    canvas.style.imageRendering = 'pixelated';
    var entry = null;
    for (var i = 0; i < live.length; i++) {
      if (live[i].canvas === canvas) { entry = live[i]; break; }
    }
    if (!entry) {
      entry = { canvas: canvas, key: key };
      live.push(entry);
    }
    entry.key = key;
    paint(canvas, key, blinking);
  }

  // Soft blink roughly every 4 seconds.
  setInterval(function () {
    blinking = true;
    redrawAll();
    setTimeout(function () {
      blinking = false;
      redrawAll();
    }, 140);
  }, 4000);

  window.drawAvatar = drawAvatar;
})();

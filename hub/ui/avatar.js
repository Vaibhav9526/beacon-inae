/* Procedural 16x16 pixel-art portraits.
 *
 * Exposes on window:
 *   drawAvatar(canvas, key, look?)        paint a portrait and keep it blinking
 *   avatarDataUrl(key, look?, size?)      PNG data URL (for <img> uses)
 *   HAIR_STYLES, SKINS, SWATCHES          option lists for a look picker
 *
 * `look` is {hair:number, skin:number, color:string}. Without it the key's
 * built-in default look is used.
 */
(function () {
  'use strict';

  var SKINS = ['#FBE3CC', '#F2C9A5', '#D9A77F', '#B9825F', '#8D5A3B', '#5A3825'];
  var HAIR_STYLES = ['short', 'bun', 'curly', 'long', 'spiky', 'side'];
  var SWATCHES = ['#E0482F', '#2F7DE0', '#8A3FD6', '#2FA35B', '#E0A02F', '#D6408F', '#2F9FB5', '#0A0A0C'];

  var SPRITES = {
    sentinel: { skin: '#F2C9A5', hair: '#3B2F2F', style: 'short',    shirt: '#5B7FA6', trim: '#D9E4F2', acc: 'cap' },
    medic:    { skin: '#E8B99A', hair: '#7A4A2B', style: 'bun',      shirt: '#F5F5F5', trim: '#E0556B', acc: 'coat' },
    rescue:   { skin: '#B9825F', hair: '#1E1A1A', style: 'long',     shirt: '#E08A3C', trim: '#F2D16B', acc: 'helmet' },
    guardian: { skin: '#D9A77F', hair: '#A8A29E', style: 'short',    shirt: '#4E6E58', trim: '#C9B37E', acc: 'cardigan' },
    scout:    { skin: '#F0C7A0', hair: '#D9A441', style: 'ponytail', shirt: '#6B8F5E', trim: '#8B6A3E', acc: 'glasses' },
    coach:    { skin: '#8D5A3B', hair: '#222222', style: 'curly',    shirt: '#8E7AC7', trim: '#F2F2F2', acc: 'whistle' }
  };

  var INK = '#2A2030';
  var BLUSH = '#E8A0A0';
  var MOUTH = '#A4505A';
  var RED = '#D7301F';
  var YEL = '#F2C230';
  var CAP = '#2F4B6E';
  var CAP_DARK = '#223A55';
  var CLIP = '#F25F5C';
  var CREAM = '#F7EFE0';
  var LENS = '#3A3340';
  var HEADBAND = '#6B8F5E';
  var LANYARD = '#E0482F';
  var WHISTLE = '#C8CDD4';

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

  function isHex(s) {
    return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
  }

  // Wrap any number into 0..len-1; non-numbers become 0.
  function pick(n, len) {
    n = Math.floor(Number(n));
    if (!isFinite(n)) return 0;
    return ((n % len) + len) % len;
  }

  function hair(g, sp) {
    var c = sp.hair;
    rect(g, 5, 2, 10, 2, c);
    rect(g, 4, 3, 11, 3, c);
    rect(g, 4, 4, 4, 5, c);
    rect(g, 11, 4, 11, 5, c);
    switch (sp.style) {
      case 'long':
        rect(g, 3, 4, 3, 11, c);
        rect(g, 12, 4, 12, 11, c);
        break;
      case 'bun':
        rect(g, 7, 0, 8, 1, c);
        break;
      case 'ponytail':
        rect(g, 12, 4, 13, 8, c);
        break;
      case 'curly':
        rect(g, 4, 1, 11, 1, c);
        rect(g, 3, 3, 3, 6, c);
        rect(g, 12, 3, 12, 6, c);
        break;
      case 'spiky':
        put(g, 5, 1, c);
        put(g, 7, 0, c); put(g, 7, 1, c);
        put(g, 9, 0, c); put(g, 9, 1, c);
        put(g, 10, 1, c);
        break;
      case 'side':
        rect(g, 4, 1, 10, 1, c);
        rect(g, 3, 2, 4, 2, c);
        rect(g, 3, 3, 3, 5, c);
        break;
      default:
        break; // short
    }
  }

  // Headwear and hair accessories, drawn after hair and before the face.
  function accTop(g, sp) {
    var a = sp.acc;
    if (a === 'helmet') {
      // Firefighter helmet: red shell, yellow brim, yellow badge dot.
      rect(g, 5, 0, 10, 0, RED);
      rect(g, 4, 1, 11, 2, RED);
      rect(g, 3, 3, 12, 3, YEL);
      rect(g, 7, 1, 8, 2, YEL);
    } else if (a === 'cap') {
      // Peaked cap with a crest.
      rect(g, 5, 0, 10, 1, CAP);
      rect(g, 3, 2, 12, 2, CAP_DARK);
      put(g, 7, 1, sp.trim);
    } else if (a === 'glasses') {
      // Headband.
      rect(g, 4, 3, 11, 3, HEADBAND);
    } else if (a === 'cardigan') {
      // Hair clip.
      rect(g, 10, 3, 11, 3, CLIP);
    }
  }

  // Accessories drawn over the face.
  function accFace(g, sp) {
    if (sp.acc !== 'glasses') return;
    // Round-ish lenses: a 3x3 frame around each eye (the eye pixel is kept).
    var eyes = [6, 9];
    for (var i = 0; i < eyes.length; i++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          put(g, eyes[i] + dx, 6 + dy, LENS);
        }
      }
    }
  }

  // Accessories on the torso, drawn last.
  function accBody(g, sp) {
    var a = sp.acc;
    if (a === 'coat') {
      // White coat: darker lapels and a red cross pin on the chest.
      var lapel = darken(sp.shirt, 0.85);
      put(g, 6, 11, lapel); put(g, 9, 11, lapel);
      put(g, 7, 12, lapel); put(g, 8, 12, lapel);
      var t = sp.trim;
      put(g, 10, 12, t);
      put(g, 9, 13, t); put(g, 10, 13, t); put(g, 11, 13, t);
      put(g, 10, 14, t);
    } else if (a === 'cardigan') {
      // Open cardigan: cream tee showing down the front, buttons on the edge.
      rect(g, 7, 11, 8, 15, CREAM);
      put(g, 6, 12, sp.trim);
      put(g, 6, 14, sp.trim);
    } else if (a === 'whistle') {
      // Lanyard across the collar with a silver whistle.
      rect(g, 6, 11, 9, 11, LANYARD);
      put(g, 8, 12, WHISTLE);
      put(g, 8, 13, WHISTLE);
      put(g, 9, 13, WHISTLE);
    } else if (a === 'cap') {
      // Shoulder badge.
      rect(g, 3, 12, 4, 13, sp.trim);
    }
  }

  // Works out the sprite to draw: the key's default, or the given look on top of it.
  function resolve(key, look) {
    var base = SPRITES[key] || SPRITES.sentinel;
    var sp = {
      skin: base.skin,
      hair: base.hair,
      style: base.style,
      shirt: base.shirt,
      trim: base.trim,
      acc: base.acc
    };
    if (look) {
      sp.style = HAIR_STYLES[pick(look.hair, HAIR_STYLES.length)];
      sp.skin = SKINS[pick(look.skin, SKINS.length)];
      if (isHex(look.color)) sp.shirt = look.color;
    }
    return sp;
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
    accTop(g, sp);

    // Face
    var eye = blink ? darken(sp.skin, 0.6) : INK;
    put(g, 6, 6, eye);
    put(g, 9, 6, eye);
    put(g, 5, 8, BLUSH);
    put(g, 10, 8, BLUSH);
    put(g, 7, 8, MOUTH);
    put(g, 8, 8, MOUTH);

    accFace(g, sp);
    accBody(g, sp);

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

  function paintTo(canvas, key, look, blink) {
    if (!canvas || !canvas.getContext) return;
    var g = build(resolve(key, look), blink);
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

  // One blink timer per canvas. Any earlier timer on the canvas is cleared first,
  // and it stops itself once the canvas leaves the document.
  function startBlink(canvas) {
    if (canvas._avatarTimer) clearInterval(canvas._avatarTimer);
    canvas._avatarTimer = setInterval(function () {
      if (!canvas.isConnected) {
        clearInterval(canvas._avatarTimer);
        canvas._avatarTimer = null;
        return;
      }
      var st = canvas._avatarState || {};
      paintTo(canvas, st.key, st.look, true);
      setTimeout(function () {
        if (canvas.isConnected) paintTo(canvas, st.key, st.look, false);
      }, 140);
    }, 4000);
  }

  function drawAvatar(canvas, key, look) {
    if (!canvas || !canvas.getContext) return;
    canvas.width = 16;
    canvas.height = 16;
    canvas.style.imageRendering = 'pixelated';
    canvas._avatarState = { key: key, look: look || null };
    paintTo(canvas, key, look, false);
    startBlink(canvas);
  }

  function avatarDataUrl(key, look, size) {
    var base = document.createElement('canvas');
    base.width = 16;
    base.height = 16;
    paintTo(base, key, look, false);
    var s = size ? Math.max(1, Math.round(size)) : 16;
    if (s === 16) return base.toDataURL('image/png');
    var out = document.createElement('canvas');
    out.width = s;
    out.height = s;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, s, s);
    return out.toDataURL('image/png');
  }

  window.drawAvatar = drawAvatar;
  window.avatarDataUrl = avatarDataUrl;
  window.HAIR_STYLES = HAIR_STYLES;
  window.SKINS = SKINS;
  window.SWATCHES = SWATCHES;
})();

(() => {
  const RATIOS = [
    { id: 'free', name: '自由' },
    { id: 'orig', name: '原图' },
    { id: '1:1', rw: 1, rh: 1 },
    { id: '4:3', rw: 4, rh: 3 },
    { id: '3:4', rw: 3, rh: 4 },
    { id: '3:2', rw: 3, rh: 2 },
    { id: '2:3', rw: 2, rh: 3 },
    { id: '16:9', rw: 16, rh: 9 },
    { id: '9:16', rw: 9, rh: 16 },
  ];
  const MARD = (window.MARD221_RAW || []).map(([code, hex]) => {
    const n = parseInt(hex, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return {
      code,
      hex: `#${hex}`,
      r, g, b,
      lum: 0.299 * r + 0.587 * g + 0.114 * b,
    };
  });

  const $ = (id) => document.getElementById(id);
  const state = {
    source: null,
    grid: null,
    w: 0,
    h: 0,
    size: 32,
    sizeH: 0,
    dither: false,
    labels: true,
    contrast: 1.1,
    saturate: 1.1,
    busy: false,
    crop: null,
    cropRatio: 'orig',
  };
  let timer = 0;
  let cropDrag = null;
  let cropDraft = null;

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('on'), 1600);
  }

  function clampInt(v, a, b, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(a, Math.min(b, n));
  }

  function srcWH() {
    const s = state.source;
    return s ? { w: s.width, h: s.height } : { w: 1, h: 1 };
  }

  function fullCrop() {
    const { w, h } = srcWH();
    return { x: 0, y: 0, w, h };
  }

  function getCrop() {
    return cropDraft || state.crop || fullCrop();
  }

  function clampCrop(box) {
    const { w, h } = srcWH();
    const min = 8;
    let x = box.x, y = box.y, cw = box.w, ch = box.h;
    if (cw < min) cw = min;
    if (ch < min) ch = min;
    if (cw > w) cw = w;
    if (ch > h) ch = h;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + cw > w) x = w - cw;
    if (y + ch > h) y = h - ch;
    return { x, y, w: cw, h: ch };
  }

  function ratioOf(id) {
    return RATIOS.find((r) => r.id === id) || RATIOS[0];
  }

  function fitRatioAtCenter(rw, rh, center) {
    const { w, h } = srcWH();
    const ar = rw / rh;
    let cw, ch;
    if (w / h > ar) {
      ch = h;
      cw = h * ar;
    } else {
      cw = w;
      ch = w / ar;
    }
    const cx = center ? center.x : w / 2;
    const cy = center ? center.y : h / 2;
    return clampCrop({ x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch });
  }

  function applyRatio(id, keepCenter) {
    state.cropRatio = id;
    const cur = getCrop();
    const center = keepCenter ? { x: cur.x + cur.w / 2, y: cur.y + cur.h / 2 } : null;
    if (id === 'orig') cropDraft = fullCrop();
    else if (id === 'free') cropDraft = clampCrop(cur);
    else {
      const r = ratioOf(id);
      cropDraft = fitRatioAtCenter(r.rw, r.rh, center);
    }
    syncRatioChips();
    paintCrop();
  }

  function syncRatioChips() {
    const host = $('ratioChips');
    if (!host) return;
    [...host.children].forEach((b) => b.classList.toggle('on', b.dataset.id === state.cropRatio));
  }

  function buildRatios() {
    const host = $('ratioChips');
    host.innerHTML = '';
    RATIOS.forEach((r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (r.id === state.cropRatio ? ' on' : '');
      b.dataset.id = r.id;
      b.textContent = r.name || r.id;
      b.addEventListener('click', () => applyRatio(r.id, true));
      host.appendChild(b);
    });
  }

  function readGrid() {
    const w = clampInt($('gridW').value, 8, 200, 32);
    $('gridW').value = String(w);
    state.size = w;
    const raw = $('gridH').value;
    if (raw === '' || raw == null) {
      state.sizeH = 0;
    } else {
      const h = clampInt(raw, 8, 200, 0);
      state.sizeH = h;
      if (h) $('gridH').value = String(h);
    }
  }

  function autoHeight() {
    if (state.sizeH) return state.sizeH;
    const crop = getCrop();
    return Math.max(8, Math.min(200, Math.round(state.size * crop.h / Math.max(1, crop.w))));
  }

  function toggle(btn, key) {
    btn.addEventListener('click', () => {
      state[key] = !state[key];
      btn.classList.toggle('on', state[key]);
      btn.setAttribute('aria-pressed', state[key] ? 'true' : 'false');
      if (key === 'labels' && state.grid) paintView();
      else queue();
    });
  }

  function bind() {
    toggle($('btnDither'), 'dither');
    toggle($('btnLabels'), 'labels');
    $('btnCrop').addEventListener('click', openCrop);
    $('cropCancel').addEventListener('click', closeCrop);
    $('cropDone').addEventListener('click', commitCrop);
    ['change', 'blur'].forEach((ev) => {
      $('gridW').addEventListener(ev, () => { readGrid(); queue(); });
      $('gridH').addEventListener(ev, () => { readGrid(); queue(); });
    });
    $('gridW').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); } });
    $('gridH').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); } });
    $('contrast').addEventListener('input', () => {
      state.contrast = Number($('contrast').value) / 100;
      $('conVal').textContent = state.contrast.toFixed(2);
      queue();
    });
    $('saturate').addEventListener('input', () => {
      state.saturate = Number($('saturate').value) / 100;
      $('satVal').textContent = state.saturate.toFixed(2);
      queue();
    });
    const offBtn = $('btnOffline');
    if (offBtn) {
      offBtn.addEventListener('click', () => {
        toast('用 Safari 打开本页，点底部分享，再点「添加到主屏幕」');
      });
    }
    $('btnAlbum').addEventListener('click', () => $('fileAlbum').click());
    $('btnShot').addEventListener('click', () => $('fileShot').click());
    $('fileAlbum').addEventListener('change', onFile);
    $('fileShot').addEventListener('change', onFile);
    $('btnSave').addEventListener('click', savePng);
    $('btnShare').addEventListener('click', sharePng);
    const stage = $('stage');
    stage.addEventListener('dragover', (e) => { e.preventDefault(); });
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    bindCropPointer();
  }

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) loadFile(f);
  }

  async function loadFile(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      toast('请选图片');
      return;
    }
    $('status').textContent = '读图中…';
    try {
      let bmp;
      if (window.createImageBitmap) {
        try {
          bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (_) {
          bmp = await createImageBitmap(file);
        }
      } else {
        bmp = await blobToImage(file);
      }
      state.source = bmp;
      state.crop = { x: 0, y: 0, w: bmp.width, h: bmp.height };
      state.cropRatio = 'orig';
      cropDraft = null;
      state.sizeH = 0;
      $('gridH').value = '';
      $('stage').classList.add('has-img');
      $('btnSave').disabled = false;
      $('btnShare').disabled = false;
      await render();
    } catch (err) {
      console.error(err);
      toast('这张图打不开');
      $('status').textContent = '选一张图，变成拼豆图纸';
    }
  }

  function blobToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
      img.src = url;
    });
  }

  function queue() {
    if (!state.source) return;
    clearTimeout(timer);
    timer = setTimeout(render, 40);
  }

  function drawPrep(src, maxSide) {
    const crop = getCrop();
    const scale = Math.min(1, maxSide / Math.max(crop.w, crop.h, 1));
    const w = Math.max(1, Math.round(crop.w * scale));
    const h = Math.max(1, Math.round(crop.h * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
    return c;
  }

  function downsample(src, tw, th) {
    const sw = src.width;
    const sh = src.height;
    const ctx = src.getContext('2d', { willReadFrequently: true });
    const srcData = ctx.getImageData(0, 0, sw, sh).data;
    const out = new ImageData(tw, th);
    const dst = out.data;
    for (let y = 0; y < th; y++) {
      const y0 = Math.floor((y * sh) / th);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / th));
      for (let x = 0; x < tw; x++) {
        const x0 = Math.floor((x * sw) / tw);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / tw));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * sw + xx) * 4;
            r += srcData[i];
            g += srcData[i + 1];
            b += srcData[i + 2];
            a += srcData[i + 3];
            n += 1;
          }
        }
        const o = (y * tw + x) * 4;
        dst[o] = r / n;
        dst[o + 1] = g / n;
        dst[o + 2] = b / n;
        dst[o + 3] = a / n;
      }
    }
    return out;
  }

  function adjust(data, contrast, saturate) {
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = y + (r - y) * saturate;
      g = y + (g - y) * saturate;
      b = y + (b - y) * saturate;
      d[i] = clamp(r);
      d[i + 1] = clamp(g);
      d[i + 2] = clamp(b);
    }
  }

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v + 0.5 | 0;
  }

  function nearestIndex(r, g, b) {
    let best = 0;
    let dist = 1e15;
    const rmean = r;
    for (let i = 0; i < MARD.length; i++) {
      const p = MARD[i];
      const dr = r - p.r;
      const dg = g - p.g;
      const db = b - p.b;
      const mean = (rmean + p.r) * 0.5;
      const d = (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db;
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  }

  function mapToMard(imageData, dither) {
    const w = imageData.width;
    const h = imageData.height;
    const d = imageData.data;
    const idx = new Uint16Array(w * h);
    const buf = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) buf[i] = d[i];
    const push = (x, y, ch, err, wgt) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      buf[(y * w + x) * 4 + ch] += err * wgt;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = buf[i], g = buf[i + 1], b = buf[i + 2];
        if (d[i + 3] < 20) {
          const white = MARD.findIndex((c) => c.code === 'H1');
          idx[y * w + x] = white < 0 ? 0 : white;
          const p = MARD[idx[y * w + x]];
          d[i] = p.r; d[i + 1] = p.g; d[i + 2] = p.b; d[i + 3] = 255;
          continue;
        }
        const k = nearestIndex(r, g, b);
        const p = MARD[k];
        idx[y * w + x] = k;
        if (dither) {
          push(x + 1, y, 0, r - p.r, 7 / 16);
          push(x + 1, y, 1, g - p.g, 7 / 16);
          push(x + 1, y, 2, b - p.b, 7 / 16);
          push(x - 1, y + 1, 0, r - p.r, 3 / 16);
          push(x - 1, y + 1, 1, g - p.g, 3 / 16);
          push(x - 1, y + 1, 2, b - p.b, 3 / 16);
          push(x, y + 1, 0, r - p.r, 5 / 16);
          push(x, y + 1, 1, g - p.g, 5 / 16);
          push(x, y + 1, 2, b - p.b, 5 / 16);
          push(x + 1, y + 1, 0, r - p.r, 1 / 16);
          push(x + 1, y + 1, 1, g - p.g, 1 / 16);
          push(x + 1, y + 1, 2, b - p.b, 1 / 16);
        }
        d[i] = p.r;
        d[i + 1] = p.g;
        d[i + 2] = p.b;
        d[i + 3] = 255;
      }
    }
    return idx;
  }

  function usedCounts() {
    const counts = new Map();
    if (!state.grid) return [];
    for (let i = 0; i < state.grid.length; i++) {
      const k = state.grid[i];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ color: MARD[k], n }));
  }

  function paintLegend() {
    const host = $('legend');
    if (!host) return;
    const rows = usedCounts();
    if (!rows.length) {
      host.innerHTML = '<div class="legend-empty">生成后这里列出用到的色号和颗数</div>';
      return;
    }
    host.innerHTML = rows.map(({ color, n }) => {
      const ink = color.lum > 150 ? '#1a140c' : '#fff';
      return `<div class="bead" title="${color.code}"><span class="sw" style="background:${color.hex};color:${ink}">${color.code}</span><b>${n}</b></div>`;
    }).join('');
  }

  function drawPattern(cell, labels, withLegend) {
    const w = state.w;
    const h = state.h;
    const rows = withLegend ? usedCounts() : [];
    const legendH = withLegend ? Math.ceil(rows.length / Math.max(1, Math.floor((w * cell) / 92))) * 28 + 36 : 0;
    const c = document.createElement('canvas');
    c.width = Math.max(1, w * cell);
    c.height = Math.max(1, h * cell + legendH);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, c.width, c.height);
    const fontPx = Math.max(8, Math.floor(cell * (state.grid && MARD[0] ? 0.34 : 0.34)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontPx}px "PingFang SC","Helvetica Neue",sans-serif`;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = MARD[state.grid[y * w + x]];
        const px = x * cell;
        const py = y * cell;
        ctx.fillStyle = p.hex;
        ctx.fillRect(px, py, cell, cell);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
        if (labels && cell >= 16) {
          ctx.fillStyle = p.lum > 150 ? '#1a140c' : '#ffffff';
          ctx.fillText(p.code, px + cell / 2, py + cell / 2 + 0.5);
        }
      }
    }
    if (withLegend && rows.length) {
      ctx.fillStyle = '#171922';
      ctx.fillRect(0, h * cell, c.width, legendH);
      ctx.fillStyle = '#c9c4b8';
      ctx.font = '700 14px "PingFang SC",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`MARD 221  ·  ${w}×${h}  ·  ${rows.length} 色  ·  ${w * h} 颗`, 10, h * cell + 8);
      const colW = 92;
      const cols = Math.max(1, Math.floor(c.width / colW));
      rows.forEach((row, i) => {
        const cx = (i % cols) * colW + 10;
        const cy = h * cell + 30 + Math.floor(i / cols) * 26;
        ctx.fillStyle = row.color.hex;
        ctx.fillRect(cx, cy, 18, 18);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(cx + 0.5, cy + 0.5, 17, 17);
        ctx.fillStyle = '#f4f1ea';
        ctx.font = '600 12px "PingFang SC",sans-serif';
        ctx.fillText(`${row.color.code}  ${row.n}`, cx + 24, cy + 2);
      });
    }
    return c;
  }

  function paintView() {
    if (!state.grid) return;
    const stage = $('stage');
    const view = $('view');
    const maxW = Math.max(160, stage.clientWidth - 8);
    const fit = Math.floor(maxW / state.w);
    const cell = state.labels ? Math.max(22, Math.min(36, fit || 22)) : Math.max(4, fit || 8);
    const chart = drawPattern(cell, state.labels, false);
    view.width = chart.width;
    view.height = chart.height;
    view.getContext('2d').drawImage(chart, 0, 0);
  }

  async function render() {
    if (!state.source || state.busy) {
      if (state.source) { clearTimeout(timer); timer = setTimeout(render, 40); }
      return;
    }
    if (!MARD.length) {
      toast('色卡没加载到');
      return;
    }
    state.busy = true;
    $('status').textContent = '在对照 MARD 221…';
    await new Promise((r) => requestAnimationFrame(r));
    try {
      readGrid();
      const prep = drawPrep(state.source, 1400);
      const tw = state.size;
      const th = autoHeight();
      if (!state.sizeH) $('gridH').placeholder = String(th);
      const small = downsample(prep, tw, th);
      adjust(small, state.contrast, state.saturate);
      state.grid = mapToMard(small, state.dither);
      state.w = tw;
      state.h = th;
      paintView();
      paintLegend();
      const nColors = usedCounts().length;
      $('status').textContent = `${tw} × ${th}　MARD 221　用了 ${nColors} 色`;
    } catch (err) {
      console.error(err);
      toast('转换失败');
    }
    state.busy = false;
  }

  function exportCanvas() {
    if (!state.grid) return null;
    return drawPattern(32, true, true);
  }

  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function offerPng(blob) {
    const name = `拼豆-${state.w}x${state.h}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const share = async () => {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '拼豆图纸' });
        return true;
      }
      return false;
    };
    const download = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toast('已保存带色号的图纸');
    };
    return share().catch((err) => {
      if (err && err.name === 'AbortError') return true;
      return false;
    }).then((ok) => {
      if (ok) return;
      download();
    });
  }

  function savePng() {
    const c = exportCanvas();
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) { toast('保存失败'); return; }
      offerPng(blob);
    }, 'image/png');
  }

  async function sharePng() {
    const c = exportCanvas();
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      offerPng(blob);
    }, 'image/png');
  }

  function showLan() {
    const offline = document.documentElement.dataset.offline === '1' || location.protocol === 'file:';
    if (offline) {
      const status = $('status');
      if (status) status.textContent = '离线版 · 选一张图，按 MARD 221 出图纸';
      const btn = $('btnOffline');
      if (btn) btn.classList.add('hidden');
      return;
    }
    const host = location.hostname;
    const local = host === '127.0.0.1' || host === 'localhost';
    const banner = $('lanBanner');
    if (!local) return;
    fetch('lan.txt', { cache: 'no-store' })
      .then((r) => r.ok ? r.text() : '')
      .then((t) => {
        const ip = (t || '').trim();
        if (!ip) return;
        banner.textContent = `手机连同一 Wi-Fi，浏览器打开  http://${ip}:${location.port || '8780'}/`;
        banner.classList.remove('hidden');
      })
      .catch(() => {});
  }

  function imageLayout(rw, rh) {
    const { w, h } = srcWH();
    const s = Math.min(rw / w, rh / h);
    const dw = w * s;
    const dh = h * s;
    return { left: (rw - dw) / 2, top: (rh - dh) / 2, dw, dh, s };
  }

  function cropScreenRect(L) {
    const c = getCrop();
    return {
      x: L.left + c.x * L.s,
      y: L.top + c.y * L.s,
      w: c.w * L.s,
      h: c.h * L.s,
    };
  }

  function handlePts(r) {
    return {
      nw: [r.x, r.y],
      n: [r.x + r.w / 2, r.y],
      ne: [r.x + r.w, r.y],
      e: [r.x + r.w, r.y + r.h / 2],
      se: [r.x + r.w, r.y + r.h],
      s: [r.x + r.w / 2, r.y + r.h],
      sw: [r.x, r.y + r.h],
      w: [r.x, r.y + r.h / 2],
    };
  }

  function paintCrop() {
    if ($('cropLayer').classList.contains('hidden') || !state.source) return;
    const canvas = $('cropCanvas');
    const stage = $('cropStage');
    const src = state.source;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rw = Math.max(1, stage.clientWidth);
    const rh = Math.max(1, stage.clientHeight);
    canvas.width = Math.floor(rw * dpr);
    canvas.height = Math.floor(rh * dpr);
    canvas.style.width = `${rw}px`;
    canvas.style.height = `${rh}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0e0f14';
    ctx.fillRect(0, 0, rw, rh);
    const L = imageLayout(rw, rh);
    ctx.drawImage(src, L.left, L.top, L.dw, L.dh);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, rw, rh);
    const r = cropScreenRect(L);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(src, L.left, L.top, L.dw, L.dh);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x + r.w / 3, r.y); ctx.lineTo(r.x + r.w / 3, r.y + r.h);
    ctx.moveTo(r.x + r.w * 2 / 3, r.y); ctx.lineTo(r.x + r.w * 2 / 3, r.y + r.h);
    ctx.moveTo(r.x, r.y + r.h / 3); ctx.lineTo(r.x + r.w, r.y + r.h / 3);
    ctx.moveTo(r.x, r.y + r.h * 2 / 3); ctx.lineTo(r.x + r.w, r.y + r.h * 2 / 3);
    ctx.stroke();
    ctx.strokeStyle = '#3dff8a';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#3dff8a';
    Object.values(handlePts(r)).forEach(([x, y]) => {
      ctx.fillRect(x - 7, y - 7, 14, 14);
    });
  }

  function openCrop() {
    if (!state.source) {
      toast('先选一张图');
      return;
    }
    cropDraft = { ...getCrop() };
    $('cropLayer').classList.remove('hidden');
    syncRatioChips();
    requestAnimationFrame(paintCrop);
  }

  function closeCrop() {
    cropDraft = null;
    cropDrag = null;
    $('cropLayer').classList.add('hidden');
  }

  function commitCrop() {
    state.crop = clampCrop(getCrop());
    cropDraft = null;
    cropDrag = null;
    $('cropLayer').classList.add('hidden');
    if (!state.sizeH) $('gridH').placeholder = String(autoHeight());
    queue();
  }

  function hitCrop(sx, sy, L) {
    const r = cropScreenRect(L);
    const pts = handlePts(r);
    const hit = 18;
    let best = null;
    let bestD = hit * hit;
    Object.entries(pts).forEach(([name, [x, y]]) => {
      const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
      if (d <= bestD) { bestD = d; best = name; }
    });
    if (best) return best;
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return 'move';
    return null;
  }

  function resizeByHandle(name, imgX, imgY, start) {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;
    const r = ratioOf(state.cropRatio);
    const locked = r.rw && r.rh;
    const ar = locked ? r.rw / r.rh : 0;
    if (name === 'move') return start;
    if (name.includes('w')) left = imgX;
    if (name.includes('e')) right = imgX;
    if (name.includes('n')) top = imgY;
    if (name.includes('s')) bottom = imgY;
    if (right < left) { const t = left; left = right; right = t; }
    if (bottom < top) { const t = top; top = bottom; bottom = t; }
    if (locked) {
      const pin = {
        nw: [right, bottom], ne: [left, bottom],
        sw: [right, top], se: [left, top],
        n: [start.x + start.w / 2, bottom],
        s: [start.x + start.w / 2, top],
        w: [right, start.y + start.h / 2],
        e: [left, start.y + start.h / 2],
      }[name];
      if (name === 'e' || name === 'w') {
        const cw = right - left;
        const ch = cw / ar;
        const cy = pin[1];
        top = cy - ch / 2;
        bottom = cy + ch / 2;
      } else if (name === 'n' || name === 's') {
        const ch = bottom - top;
        const cw = ch * ar;
        const cx = pin[0];
        left = cx - cw / 2;
        right = cx + cw / 2;
      } else {
        let cw = Math.abs(imgX - pin[0]);
        let ch = cw / ar;
        if (name.includes('n')) { bottom = pin[1]; top = bottom - ch; }
        else { top = pin[1]; bottom = top + ch; }
        if (name.includes('w')) { right = pin[0]; left = right - cw; }
        else { left = pin[0]; right = left + cw; }
      }
    }
    return clampCrop({ x: left, y: top, w: right - left, h: bottom - top });
  }

  function bindCropPointer() {
    const canvas = $('cropCanvas');
    const pos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, rw: rect.width, rh: rect.height };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!state.source || $('cropLayer').classList.contains('hidden')) return;
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      const L = imageLayout(p.rw, p.rh);
      const mode = hitCrop(p.x, p.y, L);
      if (!mode) return;
      e.preventDefault();
      cropDrag = {
        mode,
        sx: p.x,
        sy: p.y,
        start: { ...getCrop() },
        ox: (p.x - L.left) / L.s - getCrop().x,
        oy: (p.y - L.top) / L.s - getCrop().y,
      };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!cropDrag) return;
      e.preventDefault();
      const p = pos(e);
      const L = imageLayout(p.rw, p.rh);
      const imgX = (p.x - L.left) / L.s;
      const imgY = (p.y - L.top) / L.s;
      if (cropDrag.mode === 'move') {
        cropDraft = clampCrop({
          x: imgX - cropDrag.ox,
          y: imgY - cropDrag.oy,
          w: cropDrag.start.w,
          h: cropDrag.start.h,
        });
        if (state.cropRatio === 'orig') state.cropRatio = 'free';
      } else {
        cropDraft = resizeByHandle(cropDrag.mode, imgX, imgY, cropDrag.start);
        if (state.cropRatio === 'orig') state.cropRatio = 'free';
      }
      syncRatioChips();
      paintCrop();
    });
    const end = () => { cropDrag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  window.addEventListener('resize', () => {
    if (state.grid) paintView();
    if (!$('cropLayer').classList.contains('hidden')) paintCrop();
  });

  buildRatios();
  bind();
  showLan();
  paintLegend();

  {
    let stamp = '';
    const watch = async () => {
      try {
        if (location.protocol === 'file:') return;
        const res = await fetch(`reload-stamp.txt?v=${Date.now()}`, { cache: 'no-store' });
        const key = await res.text();
        if (stamp && key && key !== stamp) location.reload();
        if (key) stamp = key;
      } catch (_) {}
    };
    watch();
    setInterval(watch, 500);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

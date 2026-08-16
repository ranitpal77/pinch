/**
 * ============================================================================
 * HAND FRAME — Pluggable Visual Styles Registry
 * ============================================================================
 * Contains 9 distinct, modular post-processing visual filter algorithms.
 * Each filter receives (ctx, video, quad, bounds, time) where:
 *   - ctx: 2D canvas context (already clipped to the quad)
 *   - video: HTML5 Video element containing the live webcam feed
 *   - quad: array of 4 vertices [{x, y}, {x, y}, {x, y}, {x, y}] in canvas pixel space
 *   - bounds: { minX, minY, maxX, maxY, width, height } bounding box of the quad
 *   - time: requestAnimationFrame timestamp for dynamic effects
 */

(function (window) {
  'use strict';

  // Shared reusable offscreen canvas for pixel operations (avoids GC churn)
  const offscreenCanvas = document.createElement('canvas');
  const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

  const helperCanvas = document.createElement('canvas');
  const helperCtx = helperCanvas.getContext('2d', { willReadFrequently: true });

  function ensureOffscreenSize(width, height) {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    if (offscreenCanvas.width !== w || offscreenCanvas.height !== h) {
      offscreenCanvas.width = w;
      offscreenCanvas.height = h;
    }
    if (helperCanvas.width !== w || helperCanvas.height !== h) {
      helperCanvas.width = w;
      helperCanvas.height = h;
    }
  }

  // Precomputed 256-entry Thermal Heatmap Color LUT: Black -> Purple -> Red -> Orange -> Yellow -> White
  const THERMAL_LUT = (function () {
    const lut = new Uint8Array(256 * 3);
    const stops = [
      { pos: 0.0,  r: 10,  g: 10,  b: 25 },
      { pos: 0.2,  r: 100, g: 0,   b: 150 },
      { pos: 0.45, r: 230, g: 20,  b: 40 },
      { pos: 0.7,  r: 255, g: 150, b: 0 },
      { pos: 0.9,  r: 255, g: 240, b: 60 },
      { pos: 1.0,  r: 255, g: 255, b: 255 }
    ];

    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let s0 = stops[0], s1 = stops[1];
      for (let j = 0; j < stops.length - 1; j++) {
        if (t >= stops[j].pos && t <= stops[j + 1].pos) {
          s0 = stops[j];
          s1 = stops[j + 1];
          break;
        }
      }
      const span = s1.pos - s0.pos;
      const factor = span === 0 ? 0 : (t - s0.pos) / span;
      lut[i * 3 + 0] = Math.round(s0.r + (s1.r - s0.r) * factor);
      lut[i * 3 + 1] = Math.round(s0.g + (s1.g - s0.g) * factor);
      lut[i * 3 + 2] = Math.round(s0.b + (s1.b - s0.b) * factor);
    }
    return lut;
  })();

  // Precomputed Matrix Phosphor Green LUT
  const MATRIX_GREEN_LUT = (function () {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      lut[i * 3 + 0] = Math.round(Math.pow(t, 2.2) * 40);
      lut[i * 3 + 1] = Math.round(Math.min(255, Math.pow(t, 0.8) * 265));
      lut[i * 3 + 2] = Math.round(Math.pow(t, 2.0) * 80);
    }
    return lut;
  })();

  // =========================================================================
  // 1. RED STYLE — ~70% alpha red fill composited over live video inside quad
  // =========================================================================
  function applyRed(ctx, video, quad, bounds, time) {
    ctx.fillStyle = 'rgba(255, 20, 50, 0.70)';
    ctx.fillRect(bounds.minX - 5, bounds.minY - 5, bounds.width + 10, bounds.height + 10);

    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 100, 120, 0.5)';
    ctx.stroke();
  }

  // =========================================================================
  // 2. PIXELATE STYLE — Low-resolution downscale + nearest-neighbor upscale
  // =========================================================================
  function applyPixelate(ctx, video, quad, bounds, time) {
    const bw = Math.max(16, Math.floor(bounds.width));
    const bh = Math.max(16, Math.floor(bounds.height));

    const pixelCols = 28;
    const pixelRows = Math.max(16, Math.round((bh / bw) * pixelCols));

    ensureOffscreenSize(pixelCols, pixelRows);

    offscreenCtx.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;

    offscreenCtx.drawImage(
      ctx.canvas,
      bounds.minX, bounds.minY, bw, bh,
      0, 0, pixelCols, pixelRows
    );

    ctx.drawImage(
      offscreenCanvas,
      0, 0, pixelCols, pixelRows,
      bounds.minX, bounds.minY, bw, bh
    );

    ctx.imageSmoothingEnabled = true;
  }

  // =========================================================================
  // 3. THERMAL STYLE — Grayscale -> Heat Gradient LUT (Respects Quad Clip)
  // =========================================================================
  function applyThermal(ctx, video, quad, bounds, time) {
    const bx = Math.max(0, Math.floor(bounds.minX));
    const by = Math.max(0, Math.floor(bounds.minY));
    const bw = Math.min(ctx.canvas.width - bx, Math.ceil(bounds.width));
    const bh = Math.min(ctx.canvas.height - by, Math.ceil(bounds.height));

    if (bw <= 0 || bh <= 0) return;

    ensureOffscreenSize(bw, bh);
    offscreenCtx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);

    const imgData = offscreenCtx.getImageData(0, 0, bw, bh);
    const data = imgData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const lum = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) | 0;
      const lutIdx = lum * 3;
      data[i]     = THERMAL_LUT[lutIdx];
      data[i + 1] = THERMAL_LUT[lutIdx + 1];
      data[i + 2] = THERMAL_LUT[lutIdx + 2];
    }

    offscreenCtx.putImageData(imgData, 0, 0);

    // Draw through main context so it obeys ctx.clip() perfectly
    ctx.drawImage(offscreenCanvas, 0, 0, bw, bh, bx, by, bw, bh);
  }

  // =========================================================================
  // 4. NEON OUTLINE STYLE — Sobel Edge Detection + Glowing Cyan/Magenta highlights
  // =========================================================================
  function applyNeonOutline(ctx, video, quad, bounds, time) {
    const bx = Math.max(0, Math.floor(bounds.minX));
    const by = Math.max(0, Math.floor(bounds.minY));
    const bw = Math.min(ctx.canvas.width - bx, Math.ceil(bounds.width));
    const bh = Math.min(ctx.canvas.height - by, Math.ceil(bounds.height));

    if (bw <= 2 || bh <= 2) return;

    ctx.fillStyle = 'rgba(6, 9, 18, 0.82)';
    ctx.fillRect(bx, by, bw, bh);

    const scale = 0.5;
    const sw = Math.floor(bw * scale);
    const sh = Math.floor(bh * scale);

    ensureOffscreenSize(sw, sh);
    offscreenCtx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, sw, sh);

    const srcImg = offscreenCtx.getImageData(0, 0, sw, sh);
    const src = srcImg.data;
    const destImg = offscreenCtx.createImageData(sw, sh);
    const dest = destImg.data;

    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const idx = (y * sw + x) * 4;

        const p00 = (src[((y - 1) * sw + (x - 1)) * 4] * 0.3 + src[((y - 1) * sw + (x - 1)) * 4 + 1] * 0.59 + src[((y - 1) * sw + (x - 1)) * 4 + 2] * 0.11);
        const p01 = (src[((y - 1) * sw + x) * 4] * 0.3 + src[((y - 1) * sw + x) * 4 + 1] * 0.59 + src[((y - 1) * sw + x) * 4 + 2] * 0.11);
        const p02 = (src[((y - 1) * sw + (x + 1)) * 4] * 0.3 + src[((y - 1) * sw + (x + 1)) * 4 + 1] * 0.59 + src[((y - 1) * sw + (x + 1)) * 4 + 2] * 0.11);

        const p10 = (src[(y * sw + (x - 1)) * 4] * 0.3 + src[(y * sw + (x - 1)) * 4 + 1] * 0.59 + src[(y * sw + (x - 1)) * 4 + 2] * 0.11);
        const p12 = (src[(y * sw + (x + 1)) * 4] * 0.3 + src[(y * sw + (x + 1)) * 4 + 1] * 0.59 + src[(y * sw + (x + 1)) * 4 + 2] * 0.11);

        const p20 = (src[((y + 1) * sw + (x - 1)) * 4] * 0.3 + src[((y + 1) * sw + (x - 1)) * 4 + 1] * 0.59 + src[((y + 1) * sw + (x - 1)) * 4 + 2] * 0.11);
        const p21 = (src[((y + 1) * sw + x) * 4] * 0.3 + src[((y + 1) * sw + x) * 4 + 1] * 0.59 + src[((y + 1) * sw + x) * 4 + 2] * 0.11);
        const p22 = (src[((y + 1) * sw + (x + 1)) * 4] * 0.3 + src[((y + 1) * sw + (x + 1)) * 4 + 1] * 0.59 + src[((y + 1) * sw + (x + 1)) * 4 + 2] * 0.11);

        const gx = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
        const gy = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;

        const mag = Math.sqrt(gx * gx + gy * gy);

        if (mag > 35) {
          const intensity = Math.min(255, (mag - 35) * 3.5);
          const angle = Math.atan2(gy, gx);
          const ratio = (Math.sin(angle * 2 + time * 0.003) + 1) / 2;

          dest[idx]     = Math.round(ratio * 255 + (1 - ratio) * 0);
          dest[idx + 1] = Math.round((1 - ratio) * 240 + ratio * 40);
          dest[idx + 2] = 255;
          dest[idx + 3] = intensity;
        } else {
          dest[idx + 3] = 0;
        }
      }
    }

    offscreenCtx.putImageData(destImg, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(offscreenCanvas, 0, 0, sw, sh, bx, by, bw, bh);
    ctx.restore();
  }

  // =========================================================================
  // 5. PINK GRID STYLE — Desaturated video + cyber pink neon grid
  // =========================================================================
  function applyPinkGrid(ctx, video, quad, bounds, time) {
    const bx = bounds.minX;
    const by = bounds.minY;
    const bw = bounds.width;
    const bh = bounds.height;

    // Desaturate and dim background
    ctx.fillStyle = 'rgba(16, 6, 16, 0.70)';
    ctx.fillRect(bx - 5, by - 5, bw + 10, bh + 10);

    ctx.save();
    const gridSpacing = 28;
    const tOffset = (time * 0.03) % gridSpacing;

    // Draw Pure Pink Grid Lines (vertical & horizontal)
    ctx.strokeStyle = 'rgba(255, 42, 133, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = (bx % gridSpacing) - gridSpacing; x < bx + bw + gridSpacing; x += gridSpacing) {
      ctx.moveTo(x + tOffset, by - 5);
      ctx.lineTo(x + tOffset, by + bh + 5);
    }
    for (let y = (by % gridSpacing) - gridSpacing; y < by + bh + gridSpacing; y += gridSpacing) {
      ctx.moveTo(bx - 5, y + tOffset);
      ctx.lineTo(bx + bw + 5, y + tOffset);
    }
    ctx.stroke();

    // Subtle pink radial glow
    const grad = ctx.createRadialGradient(
      bx + bw / 2, by + bh / 2, 10,
      bx + bw / 2, by + bh / 2, Math.max(bw, bh) * 0.6
    );
    grad.addColorStop(0, 'rgba(255, 42, 133, 0.22)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(bx - 5, by - 5, bw + 10, bh + 10);

    ctx.restore();
  }

  // =========================================================================
  // 6. ANIME STYLE — Cel-shaded posterization + saturation boost (Respects Quad Clip)
  // =========================================================================
  function applyAnime(ctx, video, quad, bounds, time) {
    const bx = Math.max(0, Math.floor(bounds.minX));
    const by = Math.max(0, Math.floor(bounds.minY));
    const bw = Math.min(ctx.canvas.width - bx, Math.ceil(bounds.width));
    const bh = Math.min(ctx.canvas.height - by, Math.ceil(bounds.height));

    if (bw <= 0 || bh <= 0) return;

    ensureOffscreenSize(bw, bh);
    offscreenCtx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);

    const imgData = offscreenCtx.getImageData(0, 0, bw, bh);
    const data = imgData.data;
    const len = data.length;

    const quantLevels = 4;
    const quantStep = 255 / (quantLevels - 1);

    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      const avg = (r + g + b) / 3;
      r = Math.min(255, Math.max(0, avg + (r - avg) * 1.5));
      g = Math.min(255, Math.max(0, avg + (g - avg) * 1.5));
      b = Math.min(255, Math.max(0, avg + (b - avg) * 1.5));

      data[i]     = Math.round(Math.round(r / quantStep) * quantStep);
      data[i + 1] = Math.round(Math.round(g / quantStep) * quantStep);
      data[i + 2] = Math.round(Math.round(b / quantStep) * quantStep);
    }

    offscreenCtx.putImageData(imgData, 0, 0);

    // Draw through main context so it obeys ctx.clip()
    ctx.drawImage(offscreenCanvas, 0, 0, bw, bh, bx, by, bw, bh);

    ctx.fillStyle = 'rgba(255, 230, 200, 0.08)';
    ctx.fillRect(bx, by, bw, bh);
  }

  // =========================================================================
  // 7. GREEN PIXEL STYLE — Grayscale -> Phosphor Matrix Green -> Pixelate
  // =========================================================================
  function applyGreenPixel(ctx, video, quad, bounds, time) {
    const bw = Math.max(16, Math.floor(bounds.width));
    const bh = Math.max(16, Math.floor(bounds.height));

    const pixelCols = 32;
    const pixelRows = Math.max(16, Math.round((bh / bw) * pixelCols));

    ensureOffscreenSize(pixelCols, pixelRows);

    offscreenCtx.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;

    offscreenCtx.drawImage(
      ctx.canvas,
      bounds.minX, bounds.minY, bw, bh,
      0, 0, pixelCols, pixelRows
    );

    const imgData = offscreenCtx.getImageData(0, 0, pixelCols, pixelRows);
    const data = imgData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      const lutIdx = lum * 3;
      data[i]     = MATRIX_GREEN_LUT[lutIdx];
      data[i + 1] = MATRIX_GREEN_LUT[lutIdx + 1];
      data[i + 2] = MATRIX_GREEN_LUT[lutIdx + 2];
    }
    offscreenCtx.putImageData(imgData, 0, 0);

    ctx.drawImage(
      offscreenCanvas,
      0, 0, pixelCols, pixelRows,
      bounds.minX, bounds.minY, bw, bh
    );

    ctx.fillStyle = 'rgba(0, 20, 5, 0.25)';
    for (let y = bounds.minY; y < bounds.minY + bounds.height; y += 4) {
      ctx.fillRect(bounds.minX, y, bounds.width, 1.5);
    }

    ctx.imageSmoothingEnabled = true;
  }

  // =========================================================================
  // 8. SKETCH STYLE — Pencil Sketch (Respects Quad Clip)
  // =========================================================================
  function applySketch(ctx, video, quad, bounds, time) {
    const bx = Math.max(0, Math.floor(bounds.minX));
    const by = Math.max(0, Math.floor(bounds.minY));
    const bw = Math.min(ctx.canvas.width - bx, Math.ceil(bounds.width));
    const bh = Math.min(ctx.canvas.height - by, Math.ceil(bounds.height));

    if (bw <= 0 || bh <= 0) return;

    ensureOffscreenSize(bw, bh);

    offscreenCtx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);
    const baseImg = offscreenCtx.getImageData(0, 0, bw, bh);
    const base = baseImg.data;
    const len = base.length;

    const gray = new Uint8Array(bw * bh);
    for (let i = 0, g = 0; i < len; i += 4, g++) {
      const lum = (base[i] * 0.299 + base[i + 1] * 0.587 + base[i + 2] * 0.114) | 0;
      gray[g] = lum;
      base[i] = lum;
      base[i + 1] = lum;
      base[i + 2] = lum;
    }
    offscreenCtx.putImageData(baseImg, 0, 0);

    const invBlurImg = helperCtx.createImageData(bw, bh);
    const invBlur = invBlurImg.data;
    for (let i = 0, g = 0; i < len; i += 4, g++) {
      const inv = 255 - gray[g];
      invBlur[i] = inv;
      invBlur[i + 1] = inv;
      invBlur[i + 2] = inv;
      invBlur[i + 3] = 255;
    }
    helperCtx.putImageData(invBlurImg, 0, 0);

    helperCtx.filter = 'blur(4px)';
    helperCtx.drawImage(helperCanvas, 0, 0);
    helperCtx.filter = 'none';

    const blurredImg = helperCtx.getImageData(0, 0, bw, bh);
    const blurred = blurredImg.data;

    for (let i = 0, g = 0; i < len; i += 4, g++) {
      const a = gray[g];
      const b = blurred[i];
      let val = 255;
      if (b < 255) {
        val = Math.min(255, (a * 255) / (255 - b));
      }
      val = val < 200 ? val * 0.85 : val;

      base[i] = val;
      base[i + 1] = val;
      base[i + 2] = val;
    }

    offscreenCtx.putImageData(baseImg, 0, 0);

    // Draw through main context so it obeys ctx.clip()
    ctx.drawImage(offscreenCanvas, 0, 0, bw, bh, bx, by, bw, bh);
  }

  // =========================================================================
  // 9. BLACK & WHITE STYLE — High-contrast monochrome (Respects Quad Clip)
  // =========================================================================
  function applyBlackAndWhite(ctx, video, quad, bounds, time) {
    const bx = Math.max(0, Math.floor(bounds.minX));
    const by = Math.max(0, Math.floor(bounds.minY));
    const bw = Math.min(ctx.canvas.width - bx, Math.ceil(bounds.width));
    const bh = Math.min(ctx.canvas.height - by, Math.ceil(bounds.height));

    if (bw <= 0 || bh <= 0) return;

    ensureOffscreenSize(bw, bh);
    offscreenCtx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);

    const imgData = offscreenCtx.getImageData(0, 0, bw, bh);
    const data = imgData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const normalized = lum / 255;
      const contrasted = (normalized < 0.5
        ? 2 * normalized * normalized
        : 1 - 2 * (1 - normalized) * (1 - normalized)) * 255;

      const finalVal = Math.min(255, Math.max(0, contrasted | 0));
      data[i] = finalVal;
      data[i + 1] = finalVal;
      data[i + 2] = finalVal;
    }

    offscreenCtx.putImageData(imgData, 0, 0);

    // Draw through main context so it obeys ctx.clip()
    ctx.drawImage(offscreenCanvas, 0, 0, bw, bh, bx, by, bw, bh);
  }

  // =========================================================================
  // STYLES REGISTRY (Order-Preserved, Pluggable List)
  // =========================================================================
  const STYLES_LIST = [
    {
      id: 'red',
      name: 'Red Tint',
      tag: 'RED',
      color: '#ff2032',
      apply: applyRed
    },
    {
      id: 'pixelate',
      name: 'Pixelate',
      tag: 'PIXEL',
      color: '#00f0ff',
      apply: applyPixelate
    },
    {
      id: 'thermal',
      name: 'Thermal',
      tag: 'HEAT',
      color: '#ff9900',
      apply: applyThermal
    },
    {
      id: 'neon-outline',
      name: 'Neon Outline',
      tag: 'NEON',
      color: '#ff2a85',
      apply: applyNeonOutline
    },
    {
      id: 'pink-grid',
      name: 'Pink Grid',
      tag: 'GRID',
      color: '#ff2a85',
      apply: applyPinkGrid
    },
    {
      id: 'anime',
      name: 'Anime',
      tag: 'ANIME',
      color: '#ffdd55',
      apply: applyAnime
    },
    {
      id: 'green-pixel',
      name: 'Green Pixel',
      tag: 'MATRIX',
      color: '#00ff88',
      apply: applyGreenPixel
    },
    {
      id: 'sketch',
      name: 'Sketch',
      tag: 'PENCIL',
      color: '#e2e8f0',
      apply: applySketch
    },
    {
      id: 'black-white',
      name: 'Black & White',
      tag: 'B&W',
      color: '#94a3b8',
      apply: applyBlackAndWhite
    }
  ];

  // Export to global window namespace
  window.HandFrameStyles = {
    list: STYLES_LIST,
    getById(id) {
      return STYLES_LIST.find(s => s.id === id) || STYLES_LIST[0];
    },
    getByIndex(index) {
      return STYLES_LIST[index % STYLES_LIST.length];
    }
  };

})(window);

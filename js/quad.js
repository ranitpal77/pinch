/**
 * ============================================================================
 * HAND FRAME — Quad Mathematics, Hand Sorting & Smoothing
 * ============================================================================
 * Handles:
 *  - Converting MediaPipe normalized coordinates to mirrored screen coordinates.
 *  - Identifying Left-Hand (screen-left) and Right-Hand (screen-right) based on wrist X.
 *  - Extracting 4-point frame:
 *      P0: Left index tip (landmark 8)
 *      P1: Right index tip (landmark 8)
 *      P2: Right thumb tip (landmark 4)
 *      P3: Left thumb tip (landmark 4)
 *  - Exponential smoothing (EMA / Lerp) for jitter reduction.
 *  - Drawing stylish HUD frame borders, dashed strokes, corner brackets, and crosshairs.
 */

(function (window) {
  'use strict';

  // Landmark Indices from MediaPipe Hands
  const LM_WRIST = 0;
  const LM_THUMB_TIP = 4;
  const LM_INDEX_MCP = 5;
  const LM_INDEX_TIP = 8;
  const LM_MIDDLE_MCP = 9;

  class QuadManager {
    constructor() {
      // Smoothed quad vertices in canvas pixel space
      this.smoothedQuad = null;
      // Smoothing factor (0 = frozen, 1 = raw instant, 0.4 = smooth & responsive)
      this.smoothingFactor = 0.45;
      // Line dash animation offset
      this.dashOffset = 0;
    }

    /**
     * Converts normalized MediaPipe landmark (x, y) into mirrored canvas pixel space.
     */
    toScreenCoord(lm, canvasWidth, canvasHeight) {
      return {
        x: (1.0 - lm.x) * canvasWidth,
        y: lm.y * canvasHeight,
        z: lm.z || 0
      };
    }

    /**
     * Given multiHandLandmarks (array of 1 or 2 hands), processes landmarks and returns
     * sorted hands ({ leftHand, rightHand }) and the raw 4-point quad if 2 hands exist.
     */
    processHands(multiHandLandmarks, canvasWidth, canvasHeight) {
      if (!multiHandLandmarks || multiHandLandmarks.length === 0) {
        this.smoothedQuad = null;
        return {
          handCount: 0,
          leftHand: null,
          rightHand: null,
          quad: null,
          bounds: null
        };
      }

      // Convert all hand landmarks to screen pixel coordinates
      const hands = multiHandLandmarks.map((lms) => {
        const screenLms = lms.map(pt => this.toScreenCoord(pt, canvasWidth, canvasHeight));
        const wrist = screenLms[LM_WRIST];
        const indexTip = screenLms[LM_INDEX_TIP];
        const thumbTip = screenLms[LM_THUMB_TIP];
        const middleMcp = screenLms[LM_MIDDLE_MCP];

        // Hand scale reference (distance from wrist to middle MCP)
        const handScale = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);

        // Hand center point (average of wrist and middle MCP)
        const center = {
          x: (wrist.x + middleMcp.x) * 0.5,
          y: (wrist.y + middleMcp.y) * 0.5
        };

        // Distance between thumb tip and index tip
        const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

        return {
          raw: lms,
          screen: screenLms,
          wrist,
          indexTip,
          thumbTip,
          middleMcp,
          center,
          handScale: Math.max(10, handScale),
          pinchDistance,
          // Normalized pinch ratio (< 0.35 is pinched)
          pinchRatio: pinchDistance / Math.max(10, handScale)
        };
      });

      if (hands.length === 1) {
        this.smoothedQuad = null;
        return {
          handCount: 1,
          leftHand: hands[0].wrist.x < canvasWidth * 0.5 ? hands[0] : null,
          rightHand: hands[0].wrist.x >= canvasWidth * 0.5 ? hands[0] : null,
          singleHand: hands[0],
          quad: null,
          bounds: null
        };
      }

      // Sort two hands by wrist screen X coordinate:
      // Index 0: Leftmost hand on screen (LeftHand)
      // Index 1: Rightmost hand on screen (RightHand)
      hands.sort((a, b) => a.wrist.x - b.wrist.x);
      const leftHand = hands[0];
      const rightHand = hands[1];

      // Construct 4-point Quad:
      // P0: Left Index Tip
      // P1: Right Index Tip
      // P2: Right Thumb Tip
      // P3: Left Thumb Tip
      const rawQuad = [
        { x: leftHand.indexTip.x, y: leftHand.indexTip.y },
        { x: rightHand.indexTip.x, y: rightHand.indexTip.y },
        { x: rightHand.thumbTip.x, y: rightHand.thumbTip.y },
        { x: leftHand.thumbTip.x, y: leftHand.thumbTip.y }
      ];

      // Apply Exponential Moving Average (EMA) smoothing
      if (!this.smoothedQuad) {
        this.smoothedQuad = rawQuad.map(p => ({ x: p.x, y: p.y }));
      } else {
        const factor = this.smoothingFactor;
        for (let i = 0; i < 4; i++) {
          this.smoothedQuad[i].x += (rawQuad[i].x - this.smoothedQuad[i].x) * factor;
          this.smoothedQuad[i].y += (rawQuad[i].y - this.smoothedQuad[i].y) * factor;
        }
      }

      const bounds = this.getQuadBounds(this.smoothedQuad);

      return {
        handCount: 2,
        leftHand,
        rightHand,
        quad: this.smoothedQuad,
        bounds
      };
    }

    /**
     * Computes the axis-aligned bounding box of a 4-point quad.
     */
    getQuadBounds(quad) {
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;

      for (let i = 0; i < quad.length; i++) {
        const pt = quad[i];
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }

      return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY)
      };
    }

    /**
     * Clips the canvas 2D context to the quad polygon.
     */
    clipToQuad(ctx, quad) {
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();
      ctx.clip();
    }

    /**
     * Draws the stylish AR frame overlay (dashed line, corner anchors, glowing crosshairs).
     */
    drawFrameOverlay(ctx, quad, activeStyle, time) {
      if (!quad || quad.length !== 4) return;

      this.dashOffset = (this.dashOffset - 0.75) % 32;

      ctx.save();

      // 1. Draw glowing dashed quad perimeter
      const primaryColor = (activeStyle && activeStyle.color) || '#00f0ff';
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = this.dashOffset;

      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();
      ctx.stroke();

      // Reset dash for solid corner anchors
      ctx.setLineDash([]);
      ctx.shadowBlur = 16;

      // 2. Draw Subtle Corner Anchor Dots
      for (let i = 0; i < 4; i++) {
        const pt = quad[i];

        // Outer glow circle
        ctx.fillStyle = primaryColor;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fill();

        // Inner white dot
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // Export to global window namespace
  window.QuadManager = QuadManager;

})(window);

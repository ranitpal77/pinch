/**
 * ============================================================================
 * HAND FRAME — Unified Gesture Recognition Engine
 * ============================================================================
 * Implements debounced, hysteresis-based recognition for:
 *   1) One-hand Pinch & Release (Single hand thumb+index pinch -> release)
 *   2) Two-hand Pinch (Simultaneous pinch on both hands within ~180ms window -> release)
 *   3) Hands Approaching (Hands move from far to near when unpinched)
 *
 * Guarantees:
 *   - Shared 700ms cooldown window across all gestures
 *   - Uniform random style selection from remaining styles (never picks current style)
 *   - Two-hand pinch takes strict precedence over one-hand pinches
 *   - Clear real-time status output for HUD visual meters
 */

(function (window) {
  'use strict';

  // Gesture Tuning Constants
  const PINCH_IN_THRESHOLD = 0.35;    // Pinched when thumb-index distance < 0.35 * handSize
  const PINCH_OUT_THRESHOLD = 0.52;   // Released when thumb-index distance > 0.52 * handSize
  const DUAL_PINCH_WINDOW_MS = 220;   // Max time gap between hand pinches to count as dual
  const COOLDOWN_MS = 750;            // Debounce cooldown after any style change trigger
  const APPROACH_FAR_THRESHOLD = 2.6; // Hand distance considered "far" (normalized by hand scale)
  const APPROACH_NEAR_THRESHOLD = 1.45;// Hand distance considered "near" / approached

  class GestureEngine {
    constructor(stylesList, onStyleChange) {
      this.styles = stylesList || [];
      this.currentStyleIndex = 0;
      this.onStyleChange = onStyleChange || (() => {});

      // Cooldown tracking
      this.lastTriggerTime = 0;

      // Pinch state per hand: 'idle', 'pinched'
      this.leftHandPinchState = 'idle';
      this.leftPinchTime = 0;

      this.rightHandPinchState = 'idle';
      this.rightPinchTime = 0;

      // Dual pinch state
      this.dualPinchActive = false;
      this.dualPinchSuppressSingle = false;

      // Approach state tracking
      this.approachStartedFar = false;
      this.lastNormalizedDistance = null;

      // Live metrics for HUD meters
      this.liveMetrics = {
        leftPinchRatio: 1.0,
        rightPinchRatio: 1.0,
        leftPinched: false,
        rightPinched: false,
        approachDistance: 3.0,
        approachProgress: 0,
        inCooldown: false,
        cooldownRemaining: 0
      };
    }

    /**
     * Sets current style directly (e.g. from UI selector).
     */
    setStyleByIndex(index) {
      if (index >= 0 && index < this.styles.length) {
        this.currentStyleIndex = index;
        this.onStyleChange(this.styles[this.currentStyleIndex], 'manual');
      }
    }

    /**
     * Selects a uniformly random style from all styles except the currently active one.
     */
    triggerRandomStyleChange(gestureType, gestureLabel) {
      const now = performance.now();
      if (now - this.lastTriggerTime < COOLDOWN_MS) {
        return; // Guarded by shared cooldown
      }

      const total = this.styles.length;
      if (total <= 1) return;

      // Pick a random offset between 1 and (total - 1)
      const offset = 1 + Math.floor(Math.random() * (total - 1));
      const nextIndex = (this.currentStyleIndex + offset) % total;

      this.currentStyleIndex = nextIndex;
      this.lastTriggerTime = now;

      // Reset internal gesture trigger states to prevent re-firing
      this.dualPinchSuppressSingle = true;
      this.approachStartedFar = false;

      // Dispatch callback with new style and trigger metadata
      this.onStyleChange(this.styles[this.currentStyleIndex], gestureType, gestureLabel);
    }

    /**
     * Evaluates all gesture conditions per animation frame.
     */
    update(handData) {
      const now = performance.now();
      const timeSinceLastTrigger = now - this.lastTriggerTime;
      const inCooldown = timeSinceLastTrigger < COOLDOWN_MS;

      // Update cooldown metrics
      this.liveMetrics.inCooldown = inCooldown;
      this.liveMetrics.cooldownRemaining = inCooldown ? (COOLDOWN_MS - timeSinceLastTrigger) : 0;

      // -----------------------------------------------------------------------
      // Case 0: No hands detected
      // -----------------------------------------------------------------------
      if (handData.handCount === 0) {
        this.leftHandPinchState = 'idle';
        this.rightHandPinchState = 'idle';
        this.dualPinchActive = false;
        this.dualPinchSuppressSingle = false;
        this.approachStartedFar = false;

        this.liveMetrics.leftPinchRatio = 1.0;
        this.liveMetrics.rightPinchRatio = 1.0;
        this.liveMetrics.leftPinched = false;
        this.liveMetrics.rightPinched = false;
        this.liveMetrics.approachProgress = 0;
        return this.liveMetrics;
      }

      // -----------------------------------------------------------------------
      // Case 1: Exactly 1 Hand Detected
      // -----------------------------------------------------------------------
      if (handData.handCount === 1) {
        const hand = handData.singleHand || handData.leftHand || handData.rightHand;
        const ratio = hand ? hand.pinchRatio : 1.0;

        this.liveMetrics.leftPinchRatio = ratio;
        this.liveMetrics.rightPinchRatio = 1.0;
        this.liveMetrics.leftPinched = ratio < PINCH_IN_THRESHOLD;
        this.liveMetrics.rightPinched = false;
        this.liveMetrics.approachProgress = 0;

        // One-hand pinch state machine for single hand
        if (this.leftHandPinchState === 'idle') {
          if (ratio < PINCH_IN_THRESHOLD) {
            this.leftHandPinchState = 'pinched';
            this.leftPinchTime = now;
          }
        } else if (this.leftHandPinchState === 'pinched') {
          if (ratio > PINCH_OUT_THRESHOLD) {
            // Pinched and then released!
            this.leftHandPinchState = 'idle';
            if (!inCooldown) {
              this.triggerRandomStyleChange('one-hand-pinch', 'One-Hand Pinch & Release');
            }
          }
        }

        this.rightHandPinchState = 'idle';
        this.dualPinchActive = false;
        this.approachStartedFar = false;
        return this.liveMetrics;
      }

      // -----------------------------------------------------------------------
      // Case 2: 2 Hands Detected
      // -----------------------------------------------------------------------
      const left = handData.leftHand;
      const right = handData.rightHand;

      const leftRatio = left.pinchRatio;
      const rightRatio = right.pinchRatio;

      const isLeftPinching = leftRatio < PINCH_IN_THRESHOLD;
      const isRightPinching = rightRatio < PINCH_IN_THRESHOLD;
      const isLeftReleased = leftRatio > PINCH_OUT_THRESHOLD;
      const isRightReleased = rightRatio > PINCH_OUT_THRESHOLD;

      this.liveMetrics.leftPinchRatio = leftRatio;
      this.liveMetrics.rightPinchRatio = rightRatio;
      this.liveMetrics.leftPinched = isLeftPinching;
      this.liveMetrics.rightPinched = isRightPinching;

      // -----------------------------------------------------------------------
      // Gesture 2: Dual Pinch Detection (Prioritized over single pinch)
      // -----------------------------------------------------------------------
      // Left pinch entry
      if (this.leftHandPinchState === 'idle' && isLeftPinching) {
        this.leftHandPinchState = 'pinched';
        this.leftPinchTime = now;
      }
      // Right pinch entry
      if (this.rightHandPinchState === 'idle' && isRightPinching) {
        this.rightHandPinchState = 'pinched';
        this.rightPinchTime = now;
      }

      // Check if both hands are pinched within dual window
      const bothPinched = this.leftHandPinchState === 'pinched' && this.rightHandPinchState === 'pinched';
      const timeDiff = Math.abs(this.leftPinchTime - this.rightPinchTime);

      if (bothPinched && timeDiff <= DUAL_PINCH_WINDOW_MS) {
        this.dualPinchActive = true;
        this.dualPinchSuppressSingle = true;
      }

      // Check for dual pinch release
      if (this.dualPinchActive) {
        if (isLeftReleased || isRightReleased) {
          // Dual pinch completed!
          this.dualPinchActive = false;
          this.leftHandPinchState = 'idle';
          this.rightHandPinchState = 'idle';

          if (!inCooldown) {
            this.triggerRandomStyleChange('two-hand-pinch', '⚡ Two-Hand Dual Pinch!');
          }
          return this.liveMetrics;
        }
      }

      // Single pinch release checks (if not a dual pinch event)
      if (this.leftHandPinchState === 'pinched' && isLeftReleased) {
        this.leftHandPinchState = 'idle';
        if (!this.dualPinchSuppressSingle && !inCooldown) {
          this.triggerRandomStyleChange('one-hand-pinch', 'Left Hand Pinch & Release');
        }
        if (!this.leftHandPinchState && !this.rightHandPinchState) {
          this.dualPinchSuppressSingle = false;
        }
      }

      if (this.rightHandPinchState === 'pinched' && isRightReleased) {
        this.rightHandPinchState = 'idle';
        if (!this.dualPinchSuppressSingle && !inCooldown) {
          this.triggerRandomStyleChange('one-hand-pinch', 'Right Hand Pinch & Release');
        }
        if (!this.leftHandPinchState && !this.rightHandPinchState) {
          this.dualPinchSuppressSingle = false;
        }
      }

      if (isLeftReleased && isRightReleased) {
        this.dualPinchSuppressSingle = false;
      }

      // -----------------------------------------------------------------------
      // Gesture 3: Hands Approaching (When neither hand is pinched)
      // -----------------------------------------------------------------------
      const avgHandScale = (left.handScale + right.handScale) * 0.5;
      const centerDistancePx = Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y);
      const normalizedDistance = centerDistancePx / Math.max(15, avgHandScale);

      this.liveMetrics.approachDistance = normalizedDistance;

      // Compute progress (0 = far/idle, 1 = triggered near)
      const approachRatio = Math.max(0, Math.min(1,
        (APPROACH_FAR_THRESHOLD - normalizedDistance) / (APPROACH_FAR_THRESHOLD - APPROACH_NEAR_THRESHOLD)
      ));
      this.liveMetrics.approachProgress = approachRatio;

      const neitherPinched = !isLeftPinching && !isRightPinching &&
                             this.leftHandPinchState === 'idle' && this.rightHandPinchState === 'idle';

      if (neitherPinched) {
        // Track if hands start far apart
        if (normalizedDistance >= APPROACH_FAR_THRESHOLD) {
          this.approachStartedFar = true;
        }

        // Trigger when distance drops below near threshold after starting far
        if (this.approachStartedFar && normalizedDistance <= APPROACH_NEAR_THRESHOLD) {
          this.approachStartedFar = false;
          if (!inCooldown) {
            this.triggerRandomStyleChange('hands-approaching', '👐 Hands Approached!');
          }
        }
      } else {
        // Suppress approach gesture if hands are pinched
        this.approachStartedFar = false;
      }

      this.lastNormalizedDistance = normalizedDistance;
      return this.liveMetrics;
    }
  }

  // Export to global window namespace
  window.GestureEngine = GestureEngine;

})(window);

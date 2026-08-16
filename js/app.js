/**
 * ============================================================================
 * HAND FRAME — Main Application Orchestrator
 * ============================================================================
 * Coordinates:
 *   1. Webcam video stream via getUserMedia
 *   2. Real-time dual-hand landmark tracking via MediaPipe Hands CDN
 *   3. Mirrored video rendering on HTML5 2D Canvas
 *   4. Dynamic Quad calculation & Exponential smoothing (QuadManager)
 *   5. Pluggable style rendering inside clipped quad (HandFrameStyles)
 *   6. Gesture recognition & random style switching (GestureEngine)
 *   7. HUD & real-time telemetry (UIController)
 */

(function () {
  'use strict';

  // Application State
  const videoElement = document.getElementById('webcam-video');
  const canvasElement = document.getElementById('output-canvas');
  const ctx = canvasElement.getContext('2d', { willReadFrequently: true });

  let quadManager = null;
  let gestureEngine = null;
  let uiController = null;
  let activeStyle = null;

  let mediaPipeHands = null;
  let cameraInstance = null;
  let isVideoPlaying = false;
  let latestLandmarkResults = null;
  let animationFrameId = null;

  /**
   * Initializes the application.
   */
  async function initApp() {
    // 1. Initialize UI Controller
    uiController = new window.UIController();
    uiController.canvasRef = canvasElement;

    // 2. Initialize Quad Manager
    quadManager = new window.QuadManager();

    // 3. Initialize Gesture Engine with 9 Pluggable Styles
    const styles = window.HandFrameStyles.list;
    gestureEngine = new window.GestureEngine(styles, (newStyle, triggerType, triggerLabel) => {
      activeStyle = newStyle;
      uiController.updateActiveStyle(
        activeStyle,
        gestureEngine.currentStyleIndex,
        styles.length,
        triggerLabel
      );
    });

    // Default to Thermal or first style
    activeStyle = styles[2] || styles[0];
    gestureEngine.currentStyleIndex = 2;

    // Build Style Selector Dock
    uiController.buildStyleDock(styles, (selectedIndex) => {
      gestureEngine.setStyleByIndex(selectedIndex);
    });

    uiController.updateActiveStyle(
      activeStyle,
      gestureEngine.currentStyleIndex,
      styles.length,
      null
    );

    // Setup retry handler
    uiController.onRetryCamera = () => {
      startCameraPipeline();
    };

    // Handle Window Resize
    window.addEventListener('resize', handleResize);
    handleResize();

    // 4. Start Webcam & MediaPipe Hands
    await startCameraPipeline();

    // 5. Start Render Animation Loop
    startRenderLoop();
  }

  /**
   * Adjusts canvas dimensions to match the window viewport while maintaining crisp pixels.
   */
  function handleResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasElement.width = window.innerWidth * dpr;
    canvasElement.height = window.innerHeight * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
  }

  /**
   * Initializes MediaPipe Hands and starts camera stream.
   */
  async function startCameraPipeline() {
    try {
      // Check for getUserMedia support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API (getUserMedia) is not supported by your browser or requires HTTPS / localhost.');
      }

      // Check if MediaPipe Hands is loaded from CDN
      if (typeof window.Hands === 'undefined') {
        console.warn('MediaPipe Hands CDN script still loading, waiting...');
        await new Promise(resolve => setTimeout(resolve, 600));
        if (typeof window.Hands === 'undefined') {
          throw new Error('Could not load MediaPipe Hands library. Please check your internet connection.');
        }
      }

      // Initialize MediaPipe Hands detector
      mediaPipeHands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
      });

      mediaPipeHands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      mediaPipeHands.onResults((results) => {
        latestLandmarkResults = results;
      });

      // Request Webcam stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      videoElement.srcObject = stream;
      await videoElement.play();
      isVideoPlaying = true;

      // Use MediaPipe CameraUtils if available, otherwise manual frame pumping
      if (typeof window.Camera !== 'undefined') {
        cameraInstance = new window.Camera(videoElement, {
          onFrame: async () => {
            if (mediaPipeHands && videoElement.videoWidth > 0) {
              await mediaPipeHands.send({ image: videoElement });
            }
          },
          width: 1280,
          height: 720
        });
        cameraInstance.start();
      } else {
        // Fallback frame pump
        pumphandLandmarks();
      }

    } catch (err) {
      console.error('Camera initialization error:', err);
      let message = err.message || 'Camera permission denied or camera unavailable.';
      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        message += ' Note: Webcams require a secure context (HTTPS or localhost).';
      }
      uiController.showErrorModal('Camera Initialization Failed', message);
    }
  }

  /**
   * Fallback frame pump if CameraUtils is not present.
   */
  async function pumphandLandmarks() {
    if (isVideoPlaying && mediaPipeHands && videoElement.videoWidth > 0) {
      try {
        await mediaPipeHands.send({ image: videoElement });
      } catch (e) {
        console.warn('Landmark detection cycle error:', e);
      }
    }
    requestAnimationFrame(pumphandLandmarks);
  }

  /**
   * Main Render Loop (60 FPS)
   */
  function startRenderLoop() {
    function render(time) {
      animationFrameId = requestAnimationFrame(render);

      const canvasWidth = canvasElement.width;
      const canvasHeight = canvasElement.height;

      ctx.save();
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // -----------------------------------------------------------------------
      // Step 1: Draw Mirrored Webcam Video Feed
      // -----------------------------------------------------------------------
      if (isVideoPlaying && videoElement.readyState >= 2) {
        const vWidth = videoElement.videoWidth || 1280;
        const vHeight = videoElement.videoHeight || 720;

        // Calculate aspect ratio cover
        const canvasRatio = canvasWidth / canvasHeight;
        const videoRatio = vWidth / vHeight;
        let drawWidth, drawHeight, offsetX, offsetY;

        if (canvasRatio > videoRatio) {
          drawWidth = canvasWidth;
          drawHeight = canvasWidth / videoRatio;
          offsetX = 0;
          offsetY = (canvasHeight - drawHeight) / 2;
        } else {
          drawWidth = canvasHeight * videoRatio;
          drawHeight = canvasHeight;
          offsetX = (canvasWidth - drawWidth) / 2;
          offsetY = 0;
        }

        // Draw Mirrored horizontally
        ctx.save();
        ctx.translate(canvasWidth, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoElement, -offsetX, offsetY, drawWidth, drawHeight);
        ctx.restore();
      } else {
        // Standby background pattern when video is not yet active
        ctx.fillStyle = '#05070f';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // -----------------------------------------------------------------------
      // Step 2: Process Hand Landmarks & Evaluate Gestures
      // -----------------------------------------------------------------------
      let handData = { handCount: 0, leftHand: null, rightHand: null, quad: null, bounds: null };

      if (latestLandmarkResults && latestLandmarkResults.multiHandLandmarks) {
        handData = quadManager.processHands(
          latestLandmarkResults.multiHandLandmarks,
          canvasWidth,
          canvasHeight
        );
      }

      // Update gesture recognition engine
      const gestureMetrics = gestureEngine.update(handData);

      // Update HUD telemetry
      uiController.updateHandStatus(handData.handCount, handData.leftHand, handData.rightHand);
      uiController.updateGestureMeters(gestureMetrics);

      // -----------------------------------------------------------------------
      // Step 3: When 2 Hands Present, Apply Active Visual Style Inside Quad
      // -----------------------------------------------------------------------
      if (handData.handCount === 2 && handData.quad && handData.bounds) {
        const quad = handData.quad;
        const bounds = handData.bounds;

        // Clip region to the 4-point quad
        ctx.save();
        quadManager.clipToQuad(ctx, quad);

        // Apply active visual style function
        if (activeStyle && typeof activeStyle.apply === 'function') {
          try {
            activeStyle.apply(ctx, videoElement, quad, bounds, time);
          } catch (styleErr) {
            console.error('Style rendering error:', styleErr);
          }
        }

        ctx.restore();

        // ---------------------------------------------------------------------
        // Step 4: Draw Dashed Quad Outline + Corner Anchors + Crosshairs
        // ---------------------------------------------------------------------
        quadManager.drawFrameOverlay(ctx, quad, activeStyle, time);
      }

      ctx.restore();
    }

    animationFrameId = requestAnimationFrame(render);
  }

  // Bootstrap when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();

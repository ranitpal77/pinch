# ❖ Hand Frame — AR Vision Quad Web App

A high-performance, client-side augmented reality web application. Using real-time **MediaPipe Hands** landmark detection, the app tracks both hands to form a dynamic 4-point quad (frame) between your index fingertips and thumb tips, compositing live visual filters exclusively within that frame.

Deployed as a 100% static client-side web application — zero backend required, completely private and processed locally in your browser.

---

## ✨ Features

- **Dynamic Dual-Hand AR Quad**: Live calculation of a smoothed 4-point frame ($P_0$: Left Index, $P_1$: Right Index, $P_2$: Right Thumb, $P_3$: Left Thumb).
- **9 Pluggable Visual Styles**:
  1. **Red**: ~70% alpha saturated red tint composited over the video.
  2. **Pixelate**: Downscales the quad to 28px and upscales using nearest-neighbor sampling.
  3. **Thermal**: Maps pixel luminance to an infrared heat gradient (Black $\to$ Purple $\to$ Red $\to$ Orange $\to$ Yellow $\to$ White).
  4. **Neon Outline**: Real-time Sobel convolution edge detection filter with glowing cyan & magenta contours over dimmed video.
  5. **Pink & Blue Grid**: Cyberpunk synthwave animated grid overlay with isometric radial glow.
  6. **Anime**: Posterized color quantization with boosted saturation and cel-shaded contrast.
  7. **Green Pixel**: Grayscale converted to retro Matrix phosphor green scanline grid.
  8. **Sketch**: Pencil sketch effect using grayscale, inverted blur, and color-dodge blending.
  9. **Black & White**: High-contrast monochrome with S-curve contrast mapping.
- **Unified Gesture Engine**: 3 debounced gesture triggers with hysteresis and a shared 750ms cooldown:
  - **One-Hand Pinch & Release**: Thumb tip + index tip touch and release.
  - **Two-Hand Dual Pinch**: Synchronized pinch on both hands, prioritized over single pinches.
  - **Hands Approaching**: Distance between hand centers rapidly drops from far to near (when neither hand is pinched).
- **Uniform Random Style Cycling**: Always selects a new random style, never repeating the active one.
- **Cyberpunk Glassmorphic HUD**: Real-time pinch & approach meters, hand status badges, toast notifications, fullscreen toggle, and high-res snapshot capture.

---

## 📁 Project Structure

```
pinch/
├── index.html          # HTML5 Canvas viewport, HUD layout, and MediaPipe CDN links
├── styles.css          # Cyberpunk glassmorphism design system & micro-animations
├── js/
│   ├── app.js          # Main coordinator: camera setup, render loop, MediaPipe pipeline
│   ├── quad.js         # Landmark processing, left/right hand sorting, EMA smoothing, quad drawing
│   ├── gestures.js     # Unified Gesture Engine (1-hand pinch, 2-hand pinch, approach detection)
│   ├── styles.js       # Pluggable visual style filters registry (all 9 filters)
│   └── ui.js           # HUD telemetry, gesture meters, toasts, snapshots, error modals
├── netlify.toml        # Netlify headers for camera permissions & security
└── README.md           # Documentation and quickstart guide
```

---

## 🚀 Local Development

Since the app accesses the webcam API (`getUserMedia`), it must be served over `localhost` or `https://`.

### Option 1: Python HTTP Server (Built-in)
```bash
python -m http.server 3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 2: Node `serve` or `npx http-server`
```bash
npx serve .
# or
npx http-server -p 3000
```

### Option 3: VS Code Live Server Extension
Right-click `index.html` $\to$ **Open with Live Server**.

---

## 🌐 Deploy to Netlify

### Method A: Drag & Drop (Instant)
1. Go to [Netlify Drop](https://app.netlify.com/drop).
2. Drag and drop the `pinch` folder into the upload area.
3. Your app is live instantly with automatic HTTPS!

### Method B: Git Repository
1. Push this project to GitHub / GitLab.
2. In Netlify, click **"Add new site"** $\to$ **"Import an existing project"**.
3. Select your repository.
4. Netlify will automatically detect `netlify.toml` (`publish = "."`).
5. Click **Deploy Site**.

---

## 🎮 Gesture Guide

| Gesture | Description | Trigger Moment |
|---|---|---|
| **One-Hand Pinch** | Touch thumb and index tips together on either hand | Fires on **release** (hysteresis) |
| **Two-Hand Pinch** | Pinch both hands within ~200ms of each other | Fires on **release** (suppresses single-hand pinches) |
| **Hands Approach** | Start with hands apart, then bring hands together quickly | Fires when crossing distance threshold (unpinched) |
| **Manual Select** | Click any style badge in the bottom dock | Switches immediately |

---

## 🔒 Privacy & Security

- All video frame analysis and MediaPipe hand tracking run **100% locally in client-side JavaScript / WebAssembly**.
- No camera frames, landmarks, or telemetry data are ever stored or sent over the network.

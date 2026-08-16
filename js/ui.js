/**
 * ============================================================================
 * HAND FRAME — UI & Modal Controller (Minimal Interface)
 * ============================================================================
 * Manages camera error modals and bottom-left plain white text caption.
 */

(function (window) {
  'use strict';

  class UIController {
    constructor() {
      this.errorModal = document.getElementById('error-modal');
      this.errorTitle = document.getElementById('error-modal-title');
      this.errorBody = document.getElementById('error-modal-body');
      this.btnRetry = document.getElementById('btn-retry-camera');
      this.captionStyleName = document.getElementById('caption-style-name');
      this.onRetryCamera = null;

      this.initEventListeners();
    }

    initEventListeners() {
      if (this.btnRetry) {
        this.btnRetry.addEventListener('click', () => {
          this.hideErrorModal();
          if (this.onRetryCamera) this.onRetryCamera();
        });
      }
    }

    // Updates the active style name displayed in bottom-left caption (pure white text)
    updateActiveStyle(style) {
      if (this.captionStyleName && style) {
        this.captionStyleName.textContent = style.name;
        this.captionStyleName.style.color = '#ffffff';
        this.captionStyleName.style.textShadow = '0 2px 6px rgba(0, 0, 0, 0.85), 0 1px 3px rgba(0, 0, 0, 0.95)';
      }
    }

    // No-op handlers to maintain clean compatibility with gesture engine & app loop
    buildStyleDock() {}
    updateHandStatus() {}
    updateGestureMeters() {}
    showToast() {}
    triggerFlash() {}

    /**
     * Displays the camera error/permission modal.
     */
    showErrorModal(title, message) {
      if (!this.errorModal) return;
      if (this.errorTitle) this.errorTitle.textContent = title || 'Camera Access Error';
      if (this.errorBody) this.errorBody.textContent = message || 'Please enable camera permissions in your browser settings.';
      this.errorModal.classList.remove('hidden');
    }

    hideErrorModal() {
      if (this.errorModal) this.errorModal.classList.add('hidden');
    }
  }

  // Export to global window namespace
  window.UIController = UIController;

})(window);

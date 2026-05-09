/* QR My — marketing site interactivity
   Three earned moves:
     1. Live builder calling the real public preview API
        (POST https://dashboard.qrmy.app/api/public/qrcodes/preview) — same engine
        the dashboard uses, so the four shapes (Square/Rounded/Circle/Gapped) render
        identically here, in the gallery, and in the product. Debounced 1s to respect
        the 10/min anonymous rate limit; in-flight requests are aborted on superseding input.
     2. Customization gallery — 16 codes pre-rendered by the same API at build time
        (see scripts/render-gallery.mjs); shown here as static <img> tags so the
        gallery is authentic down to the pixel and incurs no runtime API cost.
     3. Cross-fading dynamic redirect demo (motion-deliberate, reduce-aware).
*/

(function () {
  'use strict';

  const PUBLIC_PREVIEW_URL = 'https://dashboard.qrmy.app/api/public/qrcodes/preview';
  const PREVIEW_SIZE = 480; // 240×240 CSS, 2× retina
  const DEBOUNCE_MS = 1000; // ≥ the public limit of 10/min recommends 800–1000ms

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ——————————————————————————————————————————————————————
  // BUILDER (§9.2) — hits the real public preview API
  // ——————————————————————————————————————————————————————

  const builderInput   = document.getElementById('builder-url');
  const builderTarget  = document.getElementById('qr-canvas');
  const builderCaption = document.getElementById('builder-caption');
  const builderReadout = document.getElementById('builder-readout');
  const shapeButtons   = document.querySelectorAll('.shape');
  const colorButtons   = document.querySelectorAll('.swatch[data-color]');

  let currentShape = 'square';
  let currentColor = '#7C3AED';
  let debounceTimer = null;
  let inFlight = null;
  let lastObjectURL = null;

  function showError(message) {
    builderTarget.innerHTML =
      `<p class="mono-caption muted" style="text-align:center;padding:1em;line-height:1.5;">${message}</p>`;
    builderTarget.classList.remove('is-loading');
  }

  async function renderBuilder() {
    if (!builderTarget) return;

    // Abort any in-flight request — the new input supersedes it.
    if (inFlight) inFlight.abort();
    const ctrl = new AbortController();
    inFlight = ctrl;

    const data = (builderInput?.value || '').trim() || 'https://qrmy.app';

    // Update the captions/readouts now (don't wait for the network).
    if (builderCaption) {
      builderCaption.textContent = `${labelFor(currentShape)} · ${currentColor}`;
    }
    if (builderReadout) {
      builderReadout.textContent = data.length > 64 ? data.slice(0, 61) + '…' : data;
    }

    // Show the loading state immediately. The existing preview dims to ~45%
    // opacity and a small ring spinner overlays the centre. Cleared on
    // success/error; aborted requests leave it set since the superseding
    // request is now responsible for clearing it.
    builderTarget.classList.add('is-loading');

    const params = new URLSearchParams({
      format: 'png',
      size: String(PREVIEW_SIZE),
      fg_color: currentColor,
      module_style: currentShape,
    });

    let res;
    try {
      res = await fetch(`${PUBLIC_PREVIEW_URL}?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'url', payload: { url: data } }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') return; // newer input took over (it owns the spinner now)
      showError('Preview unavailable.<br/>Check your connection.');
      return;
    }

    if (ctrl.signal.aborted) return;

    if (!res.ok) {
      if (res.status === 429) {
        showError('Easy there — try again in a moment.');
      } else if (res.status === 422) {
        const problem = await res.json().catch(() => ({}));
        showError(problem.detail || 'That URL doesn\'t look right.');
      } else {
        showError(`Preview failed (${res.status}).`);
      }
      return;
    }

    const blob = await res.blob();
    if (ctrl.signal.aborted) return;

    const url = URL.createObjectURL(blob);
    if (lastObjectURL) URL.revokeObjectURL(lastObjectURL);
    lastObjectURL = url;

    builderTarget.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = `QR code preview, ${labelFor(currentShape)}, ${currentColor}`;
    img.width = 240;
    img.height = 240;
    img.decoding = 'async';
    builderTarget.appendChild(img);
    builderTarget.classList.remove('is-loading');
  }

  function labelFor(shape) {
    return ({
      'square':  'Square modules',
      'rounded': 'Rounded modules',
      'circle':  'Circle modules',
      'gapped':  'Gapped modules'
    })[shape] || shape;
  }

  function debouncedRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderBuilder, DEBOUNCE_MS);
  }

  if (builderInput) {
    builderInput.addEventListener('input', debouncedRender);
  }

  shapeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      shapeButtons.forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-checked', 'true');
      currentShape = btn.dataset.shape;
      debouncedRender();
    });
  });

  colorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      colorButtons.forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-checked', 'true');
      currentColor = btn.dataset.color;
      debouncedRender();
    });
  });

  // Initial render so the panel never shows an empty box on first load.
  // Fires immediately (not debounced) since it's a single request at startup.
  if (builderTarget) renderBuilder();

  // ——————————————————————————————————————————————————————
  // BRAND WORDMARK — cycles "QR My ___" through the seven payload types
  // from §A1 of the brief (URL, Text, vCard, WiFi, Phone, SMS, Email).
  // Reduced-motion: leaves the initial word in place. Hidden tab: pauses.
  // ——————————————————————————————————————————————————————

  const BRAND_TYPES = ['URL', 'Text', 'vCard', 'WiFi', 'Phone', 'SMS', 'Email'];
  const brandTypeEls = document.querySelectorAll('[data-cycle="qr-types"]');
  if (brandTypeEls.length) {
    const HOLD = 2200;
    const FADE = 200; // matches --motion-default
    let idx = 0;
    let timer = null;
    let fadeTimer = null;

    const swap = () => {
      idx = (idx + 1) % BRAND_TYPES.length;
      brandTypeEls.forEach((el) => el.classList.add('is-out'));
      fadeTimer = window.setTimeout(() => {
        brandTypeEls.forEach((el) => {
          el.textContent = BRAND_TYPES[idx];
          el.classList.remove('is-out');
        });
      }, FADE);
    };

    const start = () => {
      if (timer || reduceMotion.matches) return;
      timer = window.setInterval(swap, HOLD + FADE);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
      if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    };

    start();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });
    reduceMotion.addEventListener('change', (e) => {
      if (e.matches) stop(); else start();
    });
  }

  // The explainer's printed-code visual is now a static <img> in index.html
  // that reuses assets/gallery/rounded-violet.png — same renderer as the
  // gallery and live builder, no runtime QR rendering needed here.

  // Cross-fade between two redirect targets every 3.5s.
  // Disabled by reduced-motion.
  const targets = document.querySelectorAll('#redirect-demo .target');
  if (targets.length === 2) {
    if (!reduceMotion.matches) {
      let activeIdx = 0;
      const cycle = () => {
        targets.forEach((t) => t.classList.remove('is-active'));
        activeIdx = (activeIdx + 1) % targets.length;
        targets[activeIdx].classList.add('is-active');
      };
      setInterval(cycle, 3500);

      reduceMotion.addEventListener('change', (e) => {
        if (e.matches) {
          // Stop animation; show both stacked (CSS handles the layout).
          targets.forEach((t) => t.classList.add('is-active'));
        }
      });
    } else {
      targets.forEach((t) => t.classList.add('is-active'));
    }
  }

  // ——————————————————————————————————————————————————————
  // CUSTOMIZATION GALLERY (§9.7) — sixteen codes pre-rendered by the
  // real public preview API (POST /public/qrcodes/preview) at build time.
  // The build script is at scripts/render-gallery.mjs. Re-run when TILES changes.
  // The browser just shows static <img> tags — the QRs are authentic to the
  // dashboard renderer down to the pixel.
  // ——————————————————————————————————————————————————————

  const TILES = [
    // Row 1 — square modules
    { shape: 'square', color: '#7C3AED', colorName: 'violet', label: 'Square, violet',  type: 'URL',   target_type: 'url',   payload: { url: 'https://qrmy.app' } },
    { shape: 'square', color: '#2563EB', colorName: 'blue',   label: 'Square, blue',    type: 'WIFI',  target_type: 'wifi',  payload: { ssid: 'Cafe', password: 'summer2026', encryption: 'WPA' } },
    { shape: 'square', color: '#059669', colorName: 'green',  label: 'Square, green',   type: 'VCARD', target_type: 'vcard', payload: { name: 'Sam Lee', company: 'Acme' } },
    { shape: 'square', color: '#D97706', colorName: 'amber',  label: 'Square, amber',   type: 'URL',   target_type: 'url',   payload: { url: 'https://example.com/menu' } },

    // Row 2 — rounded modules
    { shape: 'rounded', color: '#E11D48', colorName: 'rose',   label: 'Rounded, rose',   type: 'URL',   target_type: 'url',   payload: { url: 'https://example.com/sale' } },
    { shape: 'rounded', color: '#0891B2', colorName: 'cyan',   label: 'Rounded, cyan',   type: 'WIFI',  target_type: 'wifi',  payload: { ssid: 'Office', password: 'guest12345', encryption: 'WPA' } },
    { shape: 'rounded', color: '#7C3AED', colorName: 'violet', label: 'Rounded, violet', type: 'PHONE', target_type: 'phone', payload: { phone: '+15555550101' } },
    { shape: 'rounded', color: '#2563EB', colorName: 'blue',   label: 'Rounded, blue',   type: 'VCARD', target_type: 'vcard', payload: { name: 'Jamie Park', company: 'Studio' } },

    // Row 3 — circle modules
    { shape: 'circle', color: '#059669', colorName: 'green', label: 'Circle, green', type: 'URL',   target_type: 'url',   payload: { url: 'https://example.com/scan' } },
    { shape: 'circle', color: '#D97706', colorName: 'amber', label: 'Circle, amber', type: 'URL',   target_type: 'url',   payload: { url: 'https://example.com/event' } },
    { shape: 'circle', color: '#E11D48', colorName: 'rose',  label: 'Circle, rose',  type: 'VCARD', target_type: 'vcard', payload: { name: 'Alex Rivera' } },
    { shape: 'circle', color: '#0891B2', colorName: 'cyan',  label: 'Circle, cyan',  type: 'URL',   target_type: 'url',   payload: { url: 'https://example.com/wifi-help' } },

    // Row 4 — gapped modules
    { shape: 'gapped', color: '#7C3AED', colorName: 'violet', label: 'Gapped, violet', type: 'URL', target_type: 'url', payload: { url: 'https://example.com/brunch' } },
    { shape: 'gapped', color: '#2563EB', colorName: 'blue',   label: 'Gapped, blue',   type: 'URL', target_type: 'url', payload: { url: 'https://example.com/promo' } },
    { shape: 'gapped', color: '#059669', colorName: 'green',  label: 'Gapped, green',  type: 'URL', target_type: 'url', payload: { url: 'https://example.com/coupon' } },
    { shape: 'gapped', color: '#E11D48', colorName: 'rose',   label: 'Gapped, rose',   type: 'URL', target_type: 'url', payload: { url: 'https://example.com/launch' } }
  ];

  const galleryGrid = document.getElementById('gallery-grid');
  if (galleryGrid) {
    TILES.forEach((tile) => {
      const slug = `${tile.shape}-${tile.colorName}`;
      const wrap = document.createElement('div');
      wrap.className = 'qr-tile';
      wrap.setAttribute('role', 'listitem');
      wrap.innerHTML = `
        <div class="qr-tile__visual">
          <img src="assets/gallery/${slug}.png" alt="${tile.label} QR code" width="280" height="280" loading="lazy" decoding="async" />
        </div>
        <div class="qr-tile__caption">
          <span class="qr-tile__label">${tile.label}</span>
          <span class="qr-tile__type">${tile.type}</span>
        </div>
      `;
      galleryGrid.appendChild(wrap);
    });
  }

  // ——————————————————————————————————————————————————————
  // SMOOTH SCROLL on in-page anchors
  // ——————————————————————————————————————————————————————

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({
        behavior: reduceMotion.matches ? 'auto' : 'smooth',
        block: 'start'
      });
      history.replaceState(null, '', '#' + id);
    });
  });

  // ——————————————————————————————————————————————————————
  // Initial render
  // ——————————————————————————————————————————————————————

  renderBuilder();

})();

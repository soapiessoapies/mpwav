// Installing Sound Studio as an app (Settings > App), and the service worker
// that makes it open offline.
//
// Chrome and Edge (Windows, Android) offer a real Install button through the
// beforeinstallprompt event. Safari on iPhone / iPad has no such event, so
// the panel explains Share > Add to Home Screen instead; other browsers get
// a pointer to their own menu.
(function (root) {
  "use strict";

  // els: { button, help, status }; say(text) announces to screen readers.
  function init(els, say) {
    let deferred = null;
    const standalone = () =>
      matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);

    function show() {
      els.button.hidden = !deferred;
      if (standalone()) {
        els.help.textContent = "Sound Studio is installed and running as an app.";
      } else if (deferred) {
        els.help.textContent = "Adds Sound Studio to your Start menu, desktop or home screen. It opens in its own window and works offline.";
      } else if (ios) {
        els.help.textContent = "On iPhone or iPad: tap Share in Safari, then Add to Home Screen. It opens full screen and works offline.";
      } else {
        els.help.textContent = "Your browser can install Sound Studio from its menu (Install app, or Add to Home screen). Chrome and Edge also show an Install button here.";
      }
    }

    root.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault(); // offer it from Settings instead of the browser's own banner
      deferred = e;
      show();
    });
    root.addEventListener("appinstalled", () => {
      deferred = null;
      show();
      say("Sound Studio installed");
    });
    els.button.addEventListener("click", async () => {
      if (!deferred) return;
      const e = deferred;
      deferred = null;
      e.prompt();
      // A prompt can be used once; if it's declined the browser may offer a new one later.
      const { outcome } = await e.userChoice;
      show();
      if (outcome !== "accepted") say("Not installed");
    });

    // The service worker: only over http(s), not from a file on disk.
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").then(
        () => navigator.serviceWorker.ready.then(() => { els.status.textContent = "Ready to work offline."; }),
        () => { els.status.textContent = "Offline use isn't available in this browser."; },
      );
    } else {
      els.status.textContent = "Offline use needs the web address (it isn't available from a file on disk).";
    }
    show();
  }

  root.Install = { init };
})(window);

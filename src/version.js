// Sound Studio's version, shown in Settings > Credits. Keep it the same as
// package.json's "version" (a test checks).
(function (root) {
  const VERSION = "0.3.0";
  if (typeof module !== "undefined" && module.exports) module.exports = { VERSION };
  else root.STUDIO_VERSION = VERSION;
})(typeof window !== "undefined" ? window : globalThis);

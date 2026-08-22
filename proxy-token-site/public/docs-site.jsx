// Compatibility loader. The canonical document source lives under /docs/.
(() => {
  const canonicalSrc = "/docs/docs-site.jsx?v=public-docs-v2";
  if (document.querySelector(`script[src="${canonicalSrc}"]`)) return;

  const script = document.createElement("script");
  script.type = "text/babel";
  script.src = canonicalSrc;
  document.head.appendChild(script);
})();

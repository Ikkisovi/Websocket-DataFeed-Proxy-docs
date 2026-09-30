import React from "react";

function exampleText(children) {
  return React.Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (React.isValidElement(child)) return child.type === "br" ? "\n" : exampleText(child.props.children);
    return "";
  }).join("");
}

function exampleLanguage(text) {
  const content = text.replace(/^\s*(?:\/\/|#)[^\n]*\n/gm, "").trimStart();
  if (/^(?:curl|wscat)\b/.test(content)) return "Shell";
  if (/^[\[{]/.test(content)) return "JSON";
  if (/\b(?:import requests|from \w+ import|def \w+\(|requests\.(?:get|post))/.test(text)) return "Python";
  if (/\b(?:const |let |new WebSocket|async function|console\.log)/.test(text)) return "JavaScript";
  if (/^(?:HTTP\/|(?:GET|POST|Authorization|X-Cache)[: ])/m.test(content)) return "HTTP";
  return "Example";
}

// Highlight text, never HTML. The underlying bytes remain unchanged for copying.
function HighlightedCode({ text }) {
  const tokens = text.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|#[^\n]*|\b(?:true|false|null|None|True|False|const|let|import|from|def|return|async|await)\b|\b\d+(?:\.\d+)?\b)/g);
  return tokens.map((token, index) => {
    const kind = /^["']/.test(token) ? "s" : /^(?:\/\/|#)/.test(token) ? "c"
      : /^\d/.test(token) ? "n" : /^(?:true|false|null|None|True|False|const|let|import|from|def|return|async|await)$/.test(token) ? "k" : null;
    return kind ? <span className={kind} key={index}>{token}</span> : token;
  });
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Clipboard permission can be denied even on HTTPS. Try a selected textarea.
  }
  const previousFocus = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand?.("copy")) throw new Error("Clipboard unavailable");
  } finally {
    field.remove();
    previousFocus?.focus?.({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}

export function CodeBlock({ children, style, language }) {
  const [lang, setLang] = React.useState(() => {
    try { return localStorage.getItem("leandata.language") || "zh"; } catch { return "zh"; }
  });
  const [wrap, setWrap] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState("idle");
  const resetTimer = React.useRef(null);
  const mounted = React.useRef(true);
  const codeId = React.useId();
  const text = React.useMemo(() => exampleText(children), [children]);
  const label = language || exampleLanguage(text);
  const long = text.split("\n").length > 18;
  const isZh = lang === "zh";

  React.useEffect(() => {
    mounted.current = true;
    const onLanguage = event => setLang(event.detail?.language || "zh");
    window.addEventListener("leandata:languagechange", onLanguage);
    return () => {
      mounted.current = false;
      clearTimeout(resetTimer.current);
      window.removeEventListener("leandata:languagechange", onLanguage);
    };
  }, []);

  const copy = async () => {
    let status = "copied";
    try { await copyText(text); } catch { status = "failed"; }
    if (!mounted.current) return;
    setCopyStatus(status);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyStatus("idle"), 2500);
  };

  return (
    <div className="code-example" style={style} data-no-i18n>
      <div className="code-toolbar">
        <span className="code-language">{label}</span>
        <div className="code-actions">
          <button type="button" className="code-action" aria-controls={codeId} aria-pressed={wrap} onClick={() => setWrap(value => !value)}>
            {isZh ? "换行" : "Wrap"}
          </button>
          <button type="button" className="code-action code-copy" onClick={copy} aria-label={isZh ? "复制完整代码" : "Copy full code"}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
            </svg>
            {copyStatus === "copied" ? (isZh ? "已复制" : "Copied") : copyStatus === "failed" ? (isZh ? "请手动复制" : "Select to copy") : (isZh ? "复制" : "Copy")}
          </button>
          <span className="code-status" role="status" aria-live="polite">{copyStatus === "copied" ? (isZh ? "完整代码已复制" : "Full code copied") : copyStatus === "failed" ? (isZh ? "复制失败，请选择代码后手动复制" : "Copy failed. Select the code and copy manually.") : ""}</span>
        </div>
      </div>
      <pre id={codeId} className={`code${wrap ? " is-wrapped" : ""}${long && !expanded ? " is-collapsed" : ""}`} tabIndex={0} role="region" aria-label={isZh ? `${label} 示例代码` : `${label} code example`}><code><HighlightedCode text={text} /></code></pre>
      {long && <button type="button" className="code-expand" aria-controls={codeId} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? (isZh ? "收起示例" : "Collapse example") : (isZh ? `展开完整示例 · ${text.split("\n").length} 行` : `Expand full example · ${text.split("\n").length} lines`)}
      </button>}
    </div>
  );
}

import React from "react";
import { DOC_ARTICLES, DOC_PAGE_CONFIG, NAV_GROUPS, SECTION_ZH_LABELS } from "./doc-navigation.mjs";

const articleIds = new Set(Object.values(DOC_ARTICLES).map(article => article.id));

function flatChildren(children) {
  return React.Children.toArray(children).flatMap(child =>
    React.isValidElement(child) && child.type === React.Fragment ? flatChildren(child.props.children) : [child]);
}

function nodeId(node) {
  return React.isValidElement(node) ? node.props.id || node.props.endpoint?.id : null;
}

function hasId(node, predicate) {
  if (!React.isValidElement(node)) return false;
  return predicate(nodeId(node)) || flatChildren(node.props.children).some(child => hasId(child, predicate));
}

// A heading owns the following siblings until the next documented entry.
// Nested endpoint containers are sliced recursively, before React mounts them.
function articleChildren(children, id) {
  let selected = false;
  return flatChildren(children).flatMap(child => {
    if (!React.isValidElement(child)) return selected ? [child] : [];
    if (child.props.articleId === id) {
      selected = false;
      return [child];
    }
    const ownId = nodeId(child);
    if (articleIds.has(ownId)) {
      selected = ownId === id;
      return selected ? [child] : [];
    }
    if (hasId(child, candidate => candidate === id)) {
      selected = false;
      return [React.cloneElement(child, {}, articleChildren(child.props.children, id))];
    }
    if (hasId(child, candidate => articleIds.has(candidate))) {
      selected = false;
      return [];
    }
    return selected ? [child] : [];
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* Try the browser's local fallback. */ }
  }
  const field = document.createElement("textarea");
  const active = document.activeElement;
  field.value = text;
  field.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand?.("copy");
  field.remove();
  active?.focus();
  if (!copied) throw new Error("Clipboard unavailable");
}

function CopyButton({ text, label = "Copy code" }) {
  const [state, setState] = React.useState("idle");
  const timer = React.useRef();
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try { await copyText(text); setState("copied"); } catch { setState("failed"); }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2200);
  };
  return <button type="button" className="doc-copy" aria-label={label} onClick={copy}>
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" /><path d="M12 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3" />
    </svg>
    <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
  </button>;
}

function textOf(children) {
  return React.Children.toArray(children).map(child => React.isValidElement(child) ? textOf(child.props.children) : String(child)).join("");
}

function codeLanguage(code) {
  if (/^\s*curl\b/m.test(code)) return "cURL";
  if (/^\s*(?:const |let |var |fetch\(|new WebSocket|import\s*[{*]|import .* from ["'])/m.test(code)) return "JavaScript";
  if (/^\s*(?:import |from |def |pip )/m.test(code)) return "Python";
  if (/^\s*(?:\/\/[^\n]*\n\s*)*[{[]/.test(code)) return "JSON";
  return "Example";
}

function CopyCode({ children, ...props }) {
  const text = textOf(children);
  return <div className="doc-code-block">
    <div className="doc-code-toolbar"><span>{codeLanguage(text)}</span><CopyButton text={text} /></div>
    <pre {...props}>{children}</pre>
  </div>;
}

function withCopyButtons(children) {
  return flatChildren(children).map(child => {
    if (!React.isValidElement(child)) return child;
    if (child.type === "pre" && child.props.className?.split(" ").includes("code")) {
      return <CopyCode key={child.key} {...child.props} />;
    }
    return child.props.children ? React.cloneElement(child, {}, withCopyButtons(child.props.children)) : child;
  });
}

function DocContent({ articleId, focus, defaultSection, boundaries = [], children, ...props }) {
  let selected = children;
  if (articleId) selected = articleChildren(children, articleId);
  else if (focus) {
    let section = defaultSection;
    selected = flatChildren(children).filter(child => {
      const boundary = boundaries.find(([id]) => hasId(child, candidate => candidate === id));
      if (boundary) section = boundary[1];
      return section === focus || child.props?.docAlwaysVisible;
    });
  }
  return <div {...props} className="doc-content">{withCopyButtons(selected)}</div>;
}

function DocsSearch({ isZh = true }) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const shortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); ref.current?.focus(); setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const results = Object.values(DOC_ARTICLES).filter(article =>
    `${article.label} ${SECTION_ZH_LABELS[article.label] || ""} ${article.group} ${article.path}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
  return <div className="docs-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label><span aria-hidden="true">⌕</span><input ref={ref} type="search" aria-label="Search documentation / 搜索文档"
          placeholder={isZh ? "搜索文档" : "Search docs"} value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} /><kbd>⌘ K</kbd></label>
    {open && <div className="docs-search-results" role="region" aria-label="Documentation search results">
      {results.map(article => <a key={article.path} href={article.path}><strong>{isZh ? SECTION_ZH_LABELS[article.label] || article.label : article.label}</strong><small>{article.group} · {article.label}</small></a>)}
      {!results.length && <p>没有匹配的文档 / No results</p>}
    </div>}
  </div>;
}

function TopicLinks({ page, children }) {
  // Sidebar shows only the contextual section tree on every page. Cross-topic
  // shortcuts live in the top category bar and the docs-home cards, so they
  // are intentionally not rendered here. `children` is the SideNav tree for
  // the current page, anchored here to preserve sidebar placement.
  void page;
  return <div className="doc-topics">{children}</div>;
}

function HighlightedCode({ code }) {
  const tokens = code.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|#[^\n]*|\b(?:const|let|var|import|from|def|return|await|async|new|true|false|null|None|True|False)\b|\b\d+(?:\.\d+)?\b)/g);
  return tokens.map((token, index) => {
    if (index % 2 === 0) return token;
    const kind = /^(?:\/\/|#)/.test(token) ? "comment" : /^["']/.test(token) ? "string" : /^\d/.test(token) ? "number" : "keyword";
    return <span key={index} className={`doc-token-${kind}`}>{token}</span>;
  });
}

function CodeRail({ page, articleId, mainRef }) {
  const [examples, setExamples] = React.useState([]);
  const [active, setActive] = React.useState(0);
  const [headings, setHeadings] = React.useState([]);
  React.useEffect(() => {
    const update = () => {
      const root = mainRef.current;
      if (!root) return;
      const codes = Array.from(root.querySelectorAll("pre.code")).filter(element => !element.closest("[hidden]"));
      setExamples(codes.map((element, index) => ({ code: element.textContent, language: codeLanguage(element.textContent), index })));
      setHeadings(Array.from(root.querySelectorAll("h2[id], h3[id]")).filter(element => !element.closest("[hidden]")).slice(0, 12)
        .map(element => ({ id: element.id, text: element.textContent })));
    };
    update();
    setActive(0);
    window.addEventListener("leandata:languagechange", update);
    const observer = new MutationObserver(update);
    observer.observe(mainRef.current, { childList: true, subtree: true, characterData: true });
    return () => { window.removeEventListener("leandata:languagechange", update); observer.disconnect(); };
  }, [page, articleId, mainRef]);
  const example = examples[active] || examples[0];
  return <aside className="doc-code-rail" aria-label="Code examples / 代码示例">
    <div className="doc-rail-title">代码示例 <span>Code examples</span></div>
    {example ? <div className="doc-code-card">
      <div className="doc-code-toolbar">
        <select aria-label="Select code example" value={active} onChange={event => setActive(Number(event.target.value))}>
          {examples.map(item => <option key={item.index} value={item.index}>{item.language}{examples.filter(other => other.language === item.language).length > 1 ? ` · ${item.index + 1}` : ""}</option>)}
        </select>
        <CopyButton text={example.code} label="Copy selected code example" />
      </div>
      <pre className="doc-rail-code"><code><HighlightedCode code={example.code} /></code></pre>
    </div> : <p className="doc-rail-empty">本页没有代码示例。<br />No code examples on this page.</p>}
    {headings.length > 0 && <nav className="doc-outline" aria-label="On this page">
      <div>本页内容 <span>On this page</span></div>
      {headings.map(heading => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}
    </nav>}
    <a className="doc-token-link" href="/">获取 API Token <span>Get your API token ↗</span></a>
  </aside>;
}

export { DocContent, CodeRail, DocsSearch, TopicLinks, CopyButton, CopyCode, textOf };

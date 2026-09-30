import React from "react";

const EmbeddedDocsContext = React.createContext(null);

export function currentHash() {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
}

export function EmbeddedDocsProvider({ enabled, children }) {
  const [hash, setHash] = React.useState(currentHash);
  const [catalog, setCatalog] = React.useState({ pages: [], active: "" });
  const [language, setLanguage] = React.useState(() => window.LeandataI18n?.getLanguage() || "zh");
  React.useEffect(() => {
    const locationChanged = () => setHash(currentHash());
    const languageChanged = event => setLanguage(event.detail?.language || "zh");
    window.addEventListener("hashchange", locationChanged);
    window.addEventListener("popstate", locationChanged);
    window.addEventListener("leandata:languagechange", languageChanged);
    return () => {
      window.removeEventListener("hashchange", locationChanged);
      window.removeEventListener("popstate", locationChanged);
      window.removeEventListener("leandata:languagechange", languageChanged);
    };
  }, []);
  const register = React.useCallback((pages, active) => {
    setCatalog(previous => {
      const next = { pages, active };
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
  }, []);
  const value = React.useMemo(() => enabled ? { hash, register, ...catalog, language } : null,
    [enabled, hash, register, catalog, language]);
  return <EmbeddedDocsContext.Provider value={value}>{children}</EmbeddedDocsContext.Provider>;
}

export function useEmbeddedDocs() {
  return React.useContext(EmbeddedDocsContext);
}

// Project the existing reference source into sibling pages without reparenting
// React-owned nodes or changing any parameter/example bytes. The caller resets
// the category-level visibility before every projection, including language changes.
export function projectEmbeddedPages(root, embedded, alwaysVisibleIds = []) {
  if (!embedded) return;
  const eligible = Array.from(root.children).filter(child => !child.hidden);
  const targets = [];
  const ids = new Set();
  for (const child of eligible) {
    for (const node of [child, ...child.querySelectorAll("h2[id], h3[id], section[id], div[id]")]) {
      if (!node.id || ids.has(node.id) || alwaysVisibleIds.includes(node.id) || (node.matches("h3") && node.id.endsWith("-python-example"))) continue;
      const heading = node.matches("h2, h3") ? node : node.querySelector(":scope > h2, :scope > h3");
      if (!heading || node.matches(".code, .code-example")) continue;
      ids.add(node.id);
      targets.push({ node, heading, id: node.id });
    }
  }
  if (!targets.length) { embedded.register([], ""); return; }
  const byNode = new Map(targets.map(target => [target.node, target.id]));
  const ownership = new Map();
  const pages = targets.map(({ id, heading }) => ({
    id,
    title: heading.textContent.trim().replace(/\s+/g, " "),
  }));
  const allIds = new Set(pages.map(page => page.id));

  function walk(container, inherited) {
    let owner = byNode.get(container) || inherited;
    const members = new Set();
    for (const child of Array.from(container.children)) {
      if (container === root && !eligible.includes(child)) continue;
      const inside = targets.filter(target => child.contains(target.node));
      const direct = byNode.get(child);
      if (direct) owner = direct;
      if (!owner && inside.length) owner = inside[0].id;
      let childMembers;
      if (inside.some(target => target.node !== child)) {
        const result = walk(child, owner);
        childMembers = result.members;
        owner = result.last || owner;
      } else {
        childMembers = new Set(owner ? [owner] : [targets[0].id]);
      }
      const shared = alwaysVisibleIds.some(id => child.id === id || child.querySelector(`[id="${id}"]`));
      if (shared) childMembers = new Set(allIds);
      ownership.set(child, childMembers);
      childMembers.forEach(id => members.add(id));
    }
    return { members, last: owner };
  }
  walk(root, targets[0].id);

  let active = ids.has(embedded.hash) ? embedded.hash : "";
  if (!active && embedded.hash) {
    const target = document.getElementById(embedded.hash);
    if (target && root.contains(target)) {
      const owners = ownership.get(target) || Array.from(ownership).filter(([node]) => node.contains(target)).sort((a, b) => a[1].size - b[1].size)[0]?.[1];
      active = owners ? Array.from(owners).find(id => ids.has(id)) || "" : "";
    }
  }
  for (const [node, owners] of ownership) node.hidden = !active || !owners.has(active);
  embedded.register(pages, active);
}

export function backToIndex(event) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.history.pushState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new Event("hashchange"));
}

export function EmbeddedPagesNavigation() {
  const embedded = useEmbeddedDocs();
  const [query, setQuery] = React.useState("");
  if (!embedded || !embedded.pages.length) return null;
  const isZh = embedded.language === "zh";
  const active = embedded.pages.find(page => page.id === embedded.active);
  if (active) return (
    <nav className="reference-breadcrumb" aria-label={isZh ? "文档子页导航" : "Documentation subpage navigation"}>
      <a href={window.location.pathname + window.location.search} onClick={backToIndex}>{isZh ? "← 返回接口与主题" : "← All endpoints & topics"}</a>
      <span aria-hidden="true">/</span><span>{active.title}</span>
    </nav>
  );
  const filtered = embedded.pages.filter(page => `${page.title} ${page.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <section className="reference-index" aria-label={isZh ? "接口与主题子页" : "Endpoint and topic subpages"}>
      <div className="eyebrow">{isZh ? "文档目录" : "Reference index"} · {embedded.pages.length}</div>
      <h2>{isZh ? "选择接口或主题" : "Choose an endpoint or topic"}</h2>
      <p>{isZh ? "每个接口独立阅读，参数与示例只显示在对应子页中。" : "Read each endpoint separately, with its own parameters and examples."}</p>
      {embedded.hash && <p className="reference-missing" role="status">{isZh ? "当前链接不属于这个栏目，请选择下方子页。" : "This link is not part of this category. Choose a subpage below."}</p>}
      <label className="reference-search">{isZh ? "查找接口或主题" : "Find an endpoint or topic"}<input className="input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={isZh ? "输入接口、名称或关键词…" : "Search endpoints, names or keywords…"} /></label>
      <div className="reference-page-grid">
        {filtered.map(page => <a className="reference-page-card" href={`#${encodeURIComponent(page.id)}`} data-reference-page={page.id} key={page.id}><span>{page.title}</span><span aria-hidden="true">→</span></a>)}
      </div>
      {!filtered.length && <p role="status">{isZh ? "没有匹配的子页。" : "No matching subpages."}</p>}
    </section>
  );
}

export function EmbeddedPagesFooter() {
  const embedded = useEmbeddedDocs();
  if (!embedded?.active) return null;
  const index = embedded.pages.findIndex(page => page.id === embedded.active);
  const previous = embedded.pages[index - 1], next = embedded.pages[index + 1];
  const isZh = embedded.language === "zh";
  return <nav className="reference-pagination" aria-label={isZh ? "上一篇与下一篇" : "Previous and next topic"}>
    {previous ? <a href={`#${encodeURIComponent(previous.id)}`}><small>{isZh ? "← 上一篇" : "← Previous"}</small><span>{previous.title}</span></a> : <span />}
    {next && <a href={`#${encodeURIComponent(next.id)}`}><small>{isZh ? "下一篇 →" : "Next →"}</small><span>{next.title}</span></a>}
  </nav>;
}

export function EmbeddedPageContents() {
  const embedded = useEmbeddedDocs();
  const [headings, setHeadings] = React.useState([]);
  React.useEffect(() => {
    const nodes = Array.from(document.querySelectorAll("main h2[id], main h3[id]"));
    const visible = nodes.filter(node => !node.closest("[hidden]"));
    const active = embedded?.pages.find(page => page.id === embedded.active);
    const items = visible.map(node => ({ id: node.id, title: node.textContent.trim() }));
    if (active && !items.some(item => item.id === active.id)) items.unshift({ id: active.id, title: active.title });
    setHeadings(items);
  }, [embedded?.active, embedded?.language, embedded?.pages]);
  if (!embedded) return null;
  const isZh = embedded.language === "zh";
  return <div className="reference-local-contents">
    <div className="eyebrow">{isZh ? "当前子页" : "On this subpage"}</div>
    {embedded.active ? <ul>{headings.map(heading => <li key={heading.id}><a href={`#${encodeURIComponent(heading.id)}`}>{heading.title}</a></li>)}</ul>
      : <p>{isZh ? "选择一个接口或主题开始阅读。" : "Choose an endpoint or topic to start reading."}</p>}
  </div>;
}

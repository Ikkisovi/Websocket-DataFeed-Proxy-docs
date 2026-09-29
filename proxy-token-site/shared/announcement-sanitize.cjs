const sanitizeHtml = require('sanitize-html');

const options = {
  allowedTags: ['p', 'div', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a'],
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    h1: 'h2',
    a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' })
  }
};

function cleanAnnouncementHtml(value) {
  return sanitizeHtml(String(value || ''), options).trim();
}

function announcementText(html) {
  return sanitizeHtml(html.replace(/<\/(?:p|div|h2|h3|li|blockquote|pre)>|<br\s*\/?>/gi, '\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, entity => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#39;': "'"
    })[entity]).trim();
}

function escapeAnnouncementText(text) {
  return String(text || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function announcementParagraph(text) {
  return `<p>${escapeAnnouncementText(text).replace(/\n/g, '<br>')}</p>`;
}

// Email clients commonly discard stylesheets. Add trusted inline styles only
// after removing all author-supplied styles, attributes, and unsafe URLs.
function announcementEmailHtml(html) {
  const styles = {
    p: 'margin:0 0 16px;line-height:1.7',
    div: 'margin:0 0 16px;line-height:1.7',
    h2: 'margin:28px 0 12px;font-size:22px;line-height:1.4;font-weight:700;color:#176b72',
    h3: 'margin:24px 0 10px;font-size:18px;line-height:1.5;font-weight:700;color:#25211d',
    strong: 'font-weight:700', b: 'font-weight:700',
    em: 'font-style:italic', i: 'font-style:italic',
    u: 'text-decoration:underline', s: 'text-decoration:line-through',
    ul: 'margin:0 0 20px;padding-left:24px;list-style-type:disc',
    ol: 'margin:0 0 20px;padding-left:24px;list-style-type:decimal',
    li: 'margin:0 0 10px;line-height:1.7',
    blockquote: 'margin:20px 0;padding:8px 16px;border-left:3px solid #176b72;color:#555555',
    pre: 'margin:16px 0;padding:12px;background:#f5f5f5;white-space:pre-wrap;word-break:break-word',
    code: 'font-family:Consolas,monospace;font-size:14px',
    a: 'color:#176b72;text-decoration:underline;word-break:break-word'
  };
  return sanitizeHtml(cleanAnnouncementHtml(html), {
    ...options,
    allowedAttributes: { '*': ['style'], a: ['href', 'rel', 'style'] },
    transformTags: {
      '*': (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, ...(styles[tagName] ? { style: styles[tagName] } : {}) }
      })
    }
  });
}

module.exports = { cleanAnnouncementHtml, announcementText, announcementParagraph, escapeAnnouncementText, announcementEmailHtml };

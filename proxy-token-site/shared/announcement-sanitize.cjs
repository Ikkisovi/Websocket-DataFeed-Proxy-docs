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

function announcementParagraph(text) {
  return `<p>${String(text || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]).replace(/\n/g, '<br>')}</p>`;
}

module.exports = { cleanAnnouncementHtml, announcementText, announcementParagraph };

/**
 * 간단한 마크다운 렌더러 (외부 라이브러리 없이 정책 문서 수준 렌더)
 * 지원: # ## ### 헤딩, 단락, - / * 글머리, 1. 번호 리스트, **bold**, `code`,
 *       | 표 |, > 인용, --- 구분선, [text](url) 링크
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return out;
}

function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const flushTable = (startIdx: number, endIdx: number) => {
    const rows = lines.slice(startIdx, endIdx).map((l) =>
      l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    );
    if (rows.length < 2) return;
    const [header, , ...body] = rows;
    out.push('<table>');
    out.push('<thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>');
    out.push('<tbody>' + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>');
    out.push('</table>');
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // 헤딩
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++; continue;
    }

    // 구분선
    if (/^---+$/.test(trimmed)) { out.push('<hr/>'); i++; continue; }

    // 인용
    if (trimmed.startsWith('>')) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        block.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + block.map(inline).join('<br/>') + '</blockquote>');
      continue;
    }

    // 표
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const start = i;
      while (i < lines.length && lines[i].trim().startsWith('|')) i++;
      flushTable(start, i);
      continue;
    }

    // 글머리 리스트
    if (/^[-*]\s+/.test(trimmed)) {
      out.push('<ul>');
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        out.push('<li>' + inline(lines[i].trim().replace(/^[-*]\s+/, '')) + '</li>');
        i++;
      }
      out.push('</ul>');
      continue;
    }

    // 번호 리스트
    if (/^\d+\.\s+/.test(trimmed)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        out.push('<li>' + inline(lines[i].trim().replace(/^\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('</ol>');
      continue;
    }

    // 단락 (빈 줄까지)
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|---+$|[-*]\s|\d+\.\s|>|\|)/.test(lines[i].trim())) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push('<p>' + para.map(inline).join('<br/>') + '</p>');
  }

  return out.join('\n');
}

const ALLOWED_DOCS: Record<string, string> = {
  privacy: '/legal/privacy.md',
  terms: '/legal/terms.md',
};

async function init() {
  const params = new URLSearchParams(location.search);
  const doc = params.get('doc') || 'terms';
  const path = ALLOWED_DOCS[doc];
  const content = document.getElementById('content')!;

  // 상단 탭 활성화
  document.querySelectorAll<HTMLAnchorElement>('.legal-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.doc === doc);
  });

  if (!path) {
    content.innerHTML = '<p style="color:#dc2626;">잘못된 문서 요청입니다.</p>';
    return;
  }

  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    content.innerHTML = renderMarkdown(md);
    document.title = `예진이 — ${doc === 'privacy' ? '개인정보처리방침' : '이용약관'}`;
  } catch (e) {
    content.innerHTML = `<p style="color:#dc2626;">문서를 불러오지 못했습니다: ${e instanceof Error ? e.message : ''}</p>`;
  }
}

init();

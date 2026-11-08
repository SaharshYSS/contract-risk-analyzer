// Owner: Varun — splits contract text into clauses and guesses each clause's type.

export type ClauseType =
  | 'liability' | 'indemnity' | 'termination' | 'payment' | 'confidentiality'
  | 'non_compete' | 'renewal' | 'governing_law' | 'intellectual_property'
  | 'warranty' | 'dispute_resolution' | 'general';

export type SplitClause = { clause_no: number; clause_type: ClauseType; content: string };

// Lines like "1.", "2)", "3. Payment", "Clause 4", "Section 5:", "Article 6 -"
const HEADING = /^\s*(?:(?:clause|section|article)\s+)?(\d{1,3})(?:[.)]|\s*[:\-–]|\s+(?=[A-Z]))\s*/i;

const TYPE_KEYWORDS: [ClauseType, RegExp][] = [
  ['indemnity', /indemnif|hold harmless/i],
  ['liability', /liabilit|liable|damages|ceiling|cap on/i],
  ['termination', /terminat|cancel|end this agreement/i],
  ['renewal', /renew/i],
  ['non_compete', /non-?compet|solicit|compete/i],
  ['confidentiality', /confidential|non-disclosure|disclose/i],
  ['intellectual_property', /intellectual property|copyright|patent|trademark|\bip\b|work product/i],
  ['payment', /payment|fees?\b|invoice|price|charges|refund|interest/i],
  ['warranty', /warrant|as is/i],
  ['dispute_resolution', /arbitrat|dispute|jury|class action|mediation/i],
  ['governing_law', /governing law|jurisdiction|governed by/i],
];

export function classifyClause(text: string): ClauseType {
  for (const [type, re] of TYPE_KEYWORDS) if (re.test(text)) return type;
  return 'general';
}

export function splitIntoClauses(rawText: string): SplitClause[] {
  const text = rawText.replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n');

  // Pass 1: split on top-level numbered headings (1., 2., Clause 3 ...).
  // Text before the first heading (title, parties) is the preamble and is skipped.
  const blocks: { no: number; text: string }[] = [];
  let current: { no: number; lines: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(HEADING);
    const isSubClause = /^\s*\d+\.\d+/.test(line); // keep 1.1, 1.2 inside clause 1
    if (m && !isSubClause) {
      if (current) blocks.push({ no: current.no, text: current.lines.join('\n') });
      current = { no: Number(m[1]), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ no: current.no, text: current.lines.join('\n') });

  const clean = (p: string) => p.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();

  if (blocks.length >= 2) {
    const kept = blocks.map((b) => ({ ...b, text: clean(b.text) })).filter((b) => b.text.length >= 30);
    // Use the contract's own numbering when it is unique, otherwise renumber 1..n
    const unique = new Set(kept.map((b) => b.no)).size === kept.length && kept.every((b) => b.no > 0);
    return kept.map((b, i) => ({
      clause_no: unique ? b.no : i + 1,
      clause_type: classifyClause(b.text),
      content: b.text,
    }));
  }

  // Pass 2 (fallback): no numbering found -> split on blank lines (paragraphs)
  return text
    .split(/\n\s*\n/)
    .map(clean)
    .filter((p) => p.length >= 30) // drop titles / signature lines
    .map((content, i) => ({ clause_no: i + 1, clause_type: classifyClause(content), content }));
}

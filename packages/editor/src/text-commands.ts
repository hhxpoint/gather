export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
}

export function toggleWrap(
  text: string,
  from: number,
  to: number,
  before: string,
  after: string,
): TextEdit {
  const selected = text.slice(from, to);
  const outerBefore = text.slice(Math.max(0, from - before.length), from);
  const outerAfter = text.slice(to, to + after.length);
  if (outerBefore === before && outerAfter === after) {
    return {
      from: from - before.length,
      to: to + after.length,
      insert: selected,
      selectionFrom: from - before.length,
      selectionTo: to - before.length,
    };
  }
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { from, to, insert: inner, selectionFrom: from, selectionTo: from + inner.length };
  }
  const insert = `${before}${selected}${after}`;
  const selectionFrom = selected ? from + before.length : from + before.length;
  const selectionTo = selected ? to + before.length : selectionFrom;
  return { from, to, insert, selectionFrom, selectionTo };
}

export function toggleLinePrefix(
  text: string,
  from: number,
  to: number,
  prefix: string,
): TextEdit {
  const lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const lineEnd = text.indexOf('\n', to);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const block = text.slice(lineStart, end);
  const lines = block.split('\n');
  const allPrefixed = lines.every(line => line.startsWith(prefix));
  const next = lines.map(line => allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`).join('\n');
  return {
    from: lineStart,
    to: end,
    insert: next,
    selectionFrom: lineStart,
    selectionTo: lineStart + next.length,
  };
}

export function insertAroundSelection(
  text: string,
  from: number,
  to: number,
  left: string,
  right = '',
): TextEdit {
  return {
    from,
    to,
    insert: `${left}${text.slice(from, to)}${right}`,
    selectionFrom: from + left.length,
    selectionTo: to + left.length,
  };
}

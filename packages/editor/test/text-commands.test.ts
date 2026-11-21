import { describe, expect, it } from 'vitest';
import { insertAroundSelection, toggleLinePrefix, toggleWrap } from '../src/text-commands';

describe('toggleWrap', () => {
  it('wraps the current selection', () => {
    const edit = toggleWrap('hello world', 6, 11, '**', '**');
    expect(edit.insert).toBe('**world**');
    expect(edit.selectionFrom).toBe(8);
    expect(edit.selectionTo).toBe(13);
  });

  it('removes markers immediately outside the selection', () => {
    const edit = toggleWrap('**hello**', 2, 7, '**', '**');
    expect(edit.insert).toBe('hello');
    expect(edit.from).toBe(0);
    expect(edit.to).toBe(9);
  });

  it('handles empty selections by inserting a pair', () => {
    const edit = toggleWrap('abc', 1, 1, '*', '*');
    expect(edit.insert).toBe('**');
    expect(edit.selectionFrom).toBe(2);
  });
});

describe('toggleLinePrefix', () => {
  it('prefixes all selected lines', () => {
    const edit = toggleLinePrefix('a\nb\nc', 0, 5, '> ');
    expect(edit.insert).toBe('> a\n> b\n> c');
  });

  it('removes the prefix when every line already has it', () => {
    const edit = toggleLinePrefix('> a\n> b', 0, 6, '> ');
    expect(edit.insert).toBe('a\nb');
  });
});

describe('insertAroundSelection', () => {
  it('keeps the selection after the inserted opening text', () => {
    const edit = insertAroundSelection('hello', 0, 5, '[', '](url)');
    expect(edit.insert).toBe('[hello](url)');
    expect(edit.selectionFrom).toBe(1);
    expect(edit.selectionTo).toBe(6);
  });
});

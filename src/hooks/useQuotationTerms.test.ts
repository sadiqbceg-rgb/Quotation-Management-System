import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  isLocalTerm,
  resolveTerms,
  useQuotationTerms,
  type EditorTerm,
} from './useQuotationTerms';
import type { TermTemplate } from '@/services/terms/terms-service';
import { emptyTokenContext } from '@shared/term-tokens';
import { QUOTATION_LIMITS } from '@shared/validation-rules';

function template(id: string, title: string, body = `${title} body.`): TermTemplate {
  return {
    id,
    title,
    bodyTemplate: body,
    category: 'General',
    sortOrder: 10,
    active: true,
  };
}

const A = template('a', 'TEST_ONLY A');
const B = template('b', 'TEST_ONLY B');
const C = template('c', 'TEST_ONLY C');

function titles(terms: readonly EditorTerm[]): string[] {
  return terms.map((term) => term.title);
}

/* -------------------------------------------------------------------------- */

describe('selection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useQuotationTerms());
    expect(result.current.terms).toEqual([]);
  });

  it('toggles a term on and off', () => {
    const { result } = renderHook(() => useQuotationTerms());

    act(() => {
      result.current.toggle(A);
    });
    expect(result.current.isSelected('a')).toBe(true);

    act(() => {
      result.current.toggle(A);
    });
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('keeps the library text so a revert has something to restore', () => {
    const { result } = renderHook(() => useQuotationTerms());

    act(() => {
      result.current.toggle(A);
    });

    expect(result.current.terms[0]).toMatchObject({
      source: 'library',
      libraryTitle: 'TEST_ONLY A',
      libraryBody: 'TEST_ONLY A body.',
    });
  });

  it('refuses to exceed the per-quotation ceiling', () => {
    const { result } = renderHook(() => useQuotationTerms());

    act(() => {
      for (let index = 0; index < QUOTATION_LIMITS.maxTerms + 5; index++) {
        result.current.toggle(template(`t${String(index)}`, `TEST_ONLY ${String(index)}`));
      }
    });

    expect(result.current.terms).toHaveLength(QUOTATION_LIMITS.maxTerms);
    expect(result.current.atTermLimit).toBe(true);
  });
});

describe('ordering', () => {
  function selectThree() {
    const hook = renderHook(() => useQuotationTerms());
    act(() => {
      hook.result.current.toggle(A);
      hook.result.current.toggle(B);
      hook.result.current.toggle(C);
    });
    return hook;
  }

  it('keeps selection order', () => {
    const { result } = selectThree();
    expect(titles(result.current.terms)).toEqual(['TEST_ONLY A', 'TEST_ONLY B', 'TEST_ONLY C']);
  });

  it('moves a term down', () => {
    const { result } = selectThree();

    act(() => {
      result.current.move('a', 1);
    });

    expect(titles(result.current.terms)).toEqual(['TEST_ONLY B', 'TEST_ONLY A', 'TEST_ONLY C']);
  });

  it('will not move past either end', () => {
    const { result } = selectThree();

    act(() => {
      result.current.move('a', -1);
      result.current.move('c', 1);
    });

    expect(titles(result.current.terms)).toEqual(['TEST_ONLY A', 'TEST_ONLY B', 'TEST_ONLY C']);
  });

  it('ignores a move for a term that is not selected', () => {
    const { result } = selectThree();

    act(() => {
      result.current.move('missing', 1);
    });

    expect(result.current.terms).toHaveLength(3);
  });

  it('renumbers positionally after a middle removal', () => {
    const { result } = selectThree();

    act(() => {
      result.current.remove('b');
    });

    const resolved = resolveTerms(result.current.terms, emptyTokenContext());
    expect(resolved.map((term) => [term.position, term.title])).toEqual([
      [1, 'TEST_ONLY A'],
      [2, 'TEST_ONLY C'],
    ]);
  });
});

describe('quotation-local edits (PRD §22)', () => {
  it('marks a changed library term as overridden', () => {
    const { result } = renderHook(() => useQuotationTerms());

    act(() => {
      result.current.toggle(A);
    });
    act(() => {
      result.current.edit('a', { bodyTemplate: 'TEST_ONLY changed body.' });
    });

    expect(result.current.terms[0]?.source).toBe('library-overridden');
  });

  it('does not mark an edit that restores the original text', () => {
    const { result } = renderHook(() => useQuotationTerms());

    act(() => {
      result.current.toggle(A);
    });
    act(() => {
      result.current.edit('a', { bodyTemplate: 'TEST_ONLY changed body.' });
    });
    act(() => {
      result.current.edit('a', { bodyTemplate: 'TEST_ONLY A body.' });
    });

    expect(result.current.terms[0]?.source).toBe('library');
  });

  it('reverts to the library text', () => {
    const { result } = renderHook(() => useQuotationTerms());

    act(() => {
      result.current.toggle(A);
    });
    act(() => {
      result.current.edit('a', { title: 'TEST_ONLY Renamed', bodyTemplate: 'TEST_ONLY other.' });
    });
    act(() => {
      result.current.revert('a');
    });

    expect(result.current.terms[0]).toMatchObject({
      title: 'TEST_ONLY A',
      bodyTemplate: 'TEST_ONLY A body.',
      source: 'library',
    });
  });

  it('leaves a quotation-local term local however it is edited', () => {
    const { result } = renderHook(() => useQuotationTerms());
    let id = '';

    act(() => {
      id = result.current.addLocal({
        title: 'TEST_ONLY Local',
        bodyTemplate: 'TEST_ONLY local body.',
      }).id;
    });
    act(() => {
      result.current.edit(id, { bodyTemplate: 'TEST_ONLY edited local body.' });
    });

    expect(result.current.terms[0]?.source).toBe('quotation-local');
  });

  it('reverting a quotation-local term is a no-op — there is nothing to revert to', () => {
    const { result } = renderHook(() => useQuotationTerms());
    let id = '';

    act(() => {
      id = result.current.addLocal({
        title: 'TEST_ONLY Local',
        bodyTemplate: 'TEST_ONLY local body.',
      }).id;
    });
    act(() => {
      result.current.revert(id);
    });

    expect(result.current.terms[0]?.bodyTemplate).toBe('TEST_ONLY local body.');
  });
});

describe('quotation-local creation', () => {
  it('marks the id so it is never mistaken for a library row', () => {
    const { result } = renderHook(() => useQuotationTerms());

    act(() => {
      result.current.addLocal({ title: 'TEST_ONLY Local', bodyTemplate: 'TEST_ONLY body.' });
    });

    const id = result.current.terms[0]?.id ?? '';
    expect(isLocalTerm(id)).toBe(true);
    expect(isLocalTerm('a')).toBe(false);
  });

  it('adopts the library id once the term is promoted', () => {
    const { result } = renderHook(() => useQuotationTerms());
    let id = '';

    act(() => {
      id = result.current.addLocal({
        title: 'TEST_ONLY B',
        bodyTemplate: 'TEST_ONLY B body.',
      }).id;
    });
    act(() => {
      result.current.adoptLibraryId(id, B);
    });

    expect(result.current.terms[0]).toMatchObject({
      id: 'b',
      source: 'library',
      libraryBody: 'TEST_ONLY B body.',
    });
    expect(result.current.isSelected('b')).toBe(true);
  });
});

describe('resolveTerms', () => {
  it('reports the tokens it could not fill in', () => {
    const terms: EditorTerm[] = [
      {
        id: 'a',
        title: 'TEST_ONLY A',
        bodyTemplate: '{{company.name}} charges {{rate}}.',
        source: 'library',
        libraryTitle: null,
        libraryBody: null,
      },
    ];

    const resolved = resolveTerms(terms, { ...emptyTokenContext(), companyName: 'TEST_ONLY Co.' });

    expect(resolved[0]?.body).toBe('TEST_ONLY Co. charges {{rate}}.');
    expect(resolved[0]?.unresolvedTokens).toEqual(['rate']);
  });
});

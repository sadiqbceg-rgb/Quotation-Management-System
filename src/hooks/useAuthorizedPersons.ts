import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { messageOf } from '@/services/api/errors';
import {
  fetchSignature,
  listPersons,
  type AuthorizedPerson,
} from '@/services/signatories/signatory-service';
import type { Base64Png } from '@shared/signature';
import type { AuthorizedPersonSnapshot } from '@shared/types';

export const PERSONS_QUERY_KEY = ['persons'] as const;

/**
 * The snapshot a quotation stores.
 *
 * Distinct from `AuthorizedPerson` on purpose (§6.3): the record is live and
 * changes when an Admin edits it; the snapshot is frozen at the moment the
 * quotation was saved. Keeping them as separate types is what stops a live
 * record being persisted where a snapshot belongs.
 */
export type PersonSnapshot = Omit<AuthorizedPersonSnapshot, 'signatureFileId'>;

export function toSnapshot(person: AuthorizedPerson): PersonSnapshot {
  return {
    id: person.id,
    name: person.name,
    designation: person.designation,
    companyName: person.companyName,
    country: person.country,
    email: person.email,
    phone: person.phone,
  };
}

export type SignatureState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; image: Base64Png }
  | { status: 'error'; message: string };

export interface UseAuthorizedPersonsResult {
  persons: AuthorizedPerson[];
  /** Active AND with a signature — the only people offered on a quotation. */
  selectable: AuthorizedPerson[];
  isLoading: boolean;
  loadError: string | null;
  refetch: () => void;

  selected: AuthorizedPerson | null;
  /** The frozen copy the quotation carries. Null until someone is selected. */
  snapshot: PersonSnapshot | null;
  select: (id: string) => void;
  clear: () => void;

  signature: SignatureState;
  /**
   * True when the quotation cannot be finalized because the signature is not
   * available. A document must never be produced with a missing signature.
   */
  blocksDocument: boolean;
}

/**
 * Authorized-person state for the quotation editor.
 *
 * Signature images are held in a ref-backed memory cache for the lifetime of
 * the page and nowhere else — never `localStorage`, never a service worker
 * cache, never a disk write (§11.2).
 */
export function useAuthorizedPersons(): UseAuthorizedPersonsResult {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signature, setSignature] = useState<SignatureState>({ status: 'idle' });

  /** In-memory only, cleared when the tab closes. */
  const cache = useRef(new Map<string, Base64Png>());

  const query = useQuery({
    queryKey: PERSONS_QUERY_KEY,
    queryFn: () => listPersons(token ?? ''),
    enabled: token !== null,
  });

  const persons = useMemo<AuthorizedPerson[]>(() => query.data ?? [], [query.data]);

  const selectable = useMemo(
    () => persons.filter((person) => person.selectable),
    [persons],
  );

  const selected = useMemo(
    () => persons.find((person) => person.id === selectedId) ?? null,
    [persons, selectedId],
  );

  const loadSignature = useCallback(
    (id: string) => {
      const cached = cache.current.get(id);
      if (cached !== undefined) {
        setSignature({ status: 'ready', image: cached });
        return;
      }

      if (token === null) return;
      setSignature({ status: 'loading' });

      fetchSignature(id, token)
        .then((image) => {
          cache.current.set(id, image);
          setSignature({ status: 'ready', image });
        })
        .catch((error: unknown) => {
          // Reported, never swallowed: a document with a silently missing
          // signature is worse than one that refuses to generate.
          setSignature({ status: 'error', message: messageOf(error) });
        });
    },
    [token],
  );

  const select = useCallback(
    (id: string) => {
      if (id.length === 0) {
        setSelectedId(null);
        setSignature({ status: 'idle' });
        return;
      }

      setSelectedId(id);
      loadSignature(id);
    },
    [loadSignature],
  );

  const clear = useCallback(() => {
    setSelectedId(null);
    setSignature({ status: 'idle' });
  }, []);

  return {
    persons,
    selectable,
    isLoading: query.isPending && token !== null,
    loadError: query.isError ? messageOf(query.error) : null,
    refetch: () => {
      void query.refetch();
    },

    selected,
    snapshot: selected === null ? null : toSnapshot(selected),
    select,
    clear,

    signature,
    blocksDocument: selected === null || signature.status !== 'ready',
  };
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { Table, type TableColumn } from '@/components/common/Table';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { AppError, messageOf } from '@/services/api/errors';
import {
  createItem,
  listItems,
  setItemActive,
  type CatalogItem,
} from '@/services/items/item-service';
import { unitsForCategory } from '@/config/units';
import { ITEM_CATEGORIES, type ItemCategory } from '@shared/types';

/**
 * Items / Services library (PRD §40).
 *
 * Starts empty. The example names in PRD §40 are illustrative, not seed data —
 * creating them would put invented items in front of staff and violate PRD §34.
 */
export default function ItemsPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;

  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<ItemCategory>('Manpower');
  const [name, setName] = useState('');
  const [defaultUnit, setDefaultUnit] = useState<string>(unitsForCategory('Manpower')[0] ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const items = useQuery({
    queryKey: ['items'],
    queryFn: () => listItems(token ?? '', true),
    enabled: token !== null,
  });

  const createMutation = useMutation({
    mutationFn: () => createItem({ category, name, defaultUnit }, token ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      show({ variant: 'success', message: 'Item added to the library.' });
      setCreating(false);
      setName('');
      setFieldError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof AppError && error.fields?.['name'] !== undefined) {
        setFieldError(error.fields['name']);
        return;
      }
      show({ variant: 'error', message: messageOf(error) });
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setItemActive(id, active, token ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error: unknown) => {
      show({ variant: 'error', message: messageOf(error) });
    },
  });

  const columns: Array<TableColumn<CatalogItem>> = [
    { key: 'category', header: 'Category', render: (row) => row.category },
    { key: 'name', header: 'Name', render: (row) => row.name },
    { key: 'unit', header: 'Default Unit', render: (row) => row.defaultUnit },
    {
      key: 'active',
      header: 'Status',
      render: (row) => (row.active ? 'Active' : 'Inactive'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            activeMutation.mutate({ id: row.id, active: !row.active });
          }}
        >
          {row.active ? 'Deactivate' : 'Reactivate'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Items / Services"
        description="Reusable manpower, equipment and material entries."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            Add item
          </Button>
        }
      />

      <Card bodyClassName="p-0" title="Library">
        {items.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading items" />
          </div>
        ) : items.isError ? (
          <div className="px-5 py-6">
            <p className="text-brand-red text-sm">{messageOf(items.error)}</p>
          </div>
        ) : (items.data ?? []).length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title="The item library is empty"
              description="Add the manpower designations, equipment and materials your company quotes. Selecting one later prefills a row's description and unit — quantity and price are always entered per quotation."
              action={
                <Button
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  Add the first item
                </Button>
              }
            />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={items.data ?? []}
            rowKey={(row) => row.id}
            caption="Item library"
          />
        )}
      </Card>

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Add an item"
        description="Quantity and price are entered per quotation, not stored here."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={createMutation.isPending}
              onClick={() => {
                createMutation.mutate();
              }}
            >
              Add item
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Category" required>
            {({ id }) => (
              <Select
                id={id}
                value={category}
                options={ITEM_CATEGORIES.map((entry) => ({ value: entry, label: entry }))}
                onChange={(event) => {
                  const next = event.target.value as ItemCategory;
                  setCategory(next);
                  setDefaultUnit(unitsForCategory(next)[0] ?? '');
                }}
              />
            )}
          </Field>

          <Field label="Name" required {...(fieldError === null ? {} : { error: fieldError })}>
            {({ id, invalid }) => (
              <Input
                id={id}
                value={name}
                invalid={invalid}
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldError(null);
                }}
              />
            )}
          </Field>

          <Field label="Default Unit" required>
            {({ id }) => (
              <Select
                id={id}
                value={defaultUnit}
                options={unitsForCategory(category).map((unit) => ({ value: unit, label: unit }))}
                onChange={(event) => {
                  setDefaultUnit(event.target.value);
                }}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}

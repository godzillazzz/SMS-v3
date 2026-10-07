// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { responseForCurrentQuery, type PageResponseBinding } from './operation-response';

afterEach(cleanup);

function Total({ page, keyValue, binding }: {
  page: string;
  keyValue: string;
  binding?: PageResponseBinding<{ total: number }>;
}) {
  const response = responseForCurrentQuery(binding, page, keyValue);
  return <output>{response ? response.total : '—'}</output>;
}

describe('page-bound operation responses', () => {
  it('does not show page A totals during the first render of page B', () => {
    const pageA: PageResponseBinding<{ total: number }> = {
      page: 'audit',
      key: 'audit:page-2',
      response: { total: 47 }
    };
    const { rerender } = render(<Total page="audit" keyValue="audit:page-2" binding={pageA} />);
    expect(screen.getByText('47')).toBeTruthy();

    rerender(<Total page="dataQuality" keyValue="quality:page-1" binding={pageA} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('47')).toBeNull();
  });

  it('hides a response when the active page keeps the same name but its query changes', () => {
    const binding: PageResponseBinding<{ total: number }> = {
      page: 'dataQuality',
      key: 'quality:module-license',
      response: { total: 12 }
    };
    const { rerender } = render(<Total page="dataQuality" keyValue="quality:module-license" binding={binding} />);
    expect(screen.getByText('12')).toBeTruthy();

    rerender(<Total page="dataQuality" keyValue="quality:module-leave" binding={binding} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('12')).toBeNull();
  });
});

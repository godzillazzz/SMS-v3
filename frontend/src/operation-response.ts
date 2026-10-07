export type PageResponseBinding<T> = {
  page: string;
  key: string;
  response: T;
};

/** Return a response only while its page and query still match the visible view. */
export function responseForCurrentQuery<T>(
  binding: PageResponseBinding<T> | undefined,
  page: string,
  key: string
): T | undefined {
  if (!binding || binding.page !== page || binding.key !== key) return undefined;
  return binding.response;
}

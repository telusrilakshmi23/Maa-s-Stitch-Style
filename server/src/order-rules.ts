export type OrderableProduct = { active: boolean; sizes: string[]; stock: number; kind: 'READY_MADE' | 'MADE_TO_ORDER' };

/** Deterministic request checks shared by the API and its unit tests. Stock is reserved atomically in the database after this check. */
export function orderAvailabilityError(product: OrderableProduct, size: string, quantity: number): string | null {
  if (!product.active) return 'This item is currently unavailable.';
  if (!product.sizes.includes(size)) return 'Please choose an available size.';
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return 'Choose a quantity from 1 to 10.';
  if (product.kind === 'READY_MADE' && quantity > product.stock) return 'Availability changed. Please refresh and choose another size or quantity.';
  return null;
}

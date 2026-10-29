import { describe, expect, it } from 'vitest';
import { orderAvailabilityError } from '../src/order-rules.js';

const availableProduct={active:true,sizes:['S','M'],stock:3,kind:'READY_MADE' as const};

describe('ready-made order validation', () => {
  it('accepts a listed size when stock is available', () => expect(orderAvailabilityError(availableProduct,'M',2)).toBeNull());
  it('rejects a size that is not offered', () => expect(orderAvailabilityError(availableProduct,'XL',1)).toMatch(/available size/));
  it('rejects a quantity beyond stock', () => expect(orderAvailabilityError(availableProduct,'M',4)).toMatch(/Availability changed/));
  it('rejects unavailable products', () => expect(orderAvailabilityError({...availableProduct,active:false},'M',1)).toMatch(/unavailable/));
  it('rejects invalid quantities', () => expect(orderAvailabilityError(availableProduct,'M',0)).toMatch(/quantity/));
  it('allows made-to-order quantities without ready-made inventory', () => expect(orderAvailabilityError({...availableProduct,kind:'MADE_TO_ORDER',stock:0},'M',2)).toBeNull());
});

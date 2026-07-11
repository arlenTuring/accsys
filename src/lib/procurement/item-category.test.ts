import { describe, expect, it } from 'vitest';
import { classifyItemCategory } from './item-category';

describe('classifyItemCategory', () => {
  it('classifies as 設備 when untaxed amount >= 80000 and not sold with vehicle', () => {
    expect(classifyItemCategory({ untaxedAmount: 80000, soldWithVehicle: false })).toBe('設備');
    expect(classifyItemCategory({ untaxedAmount: 200000, soldWithVehicle: false })).toBe('設備');
  });

  it('classifies as 材料 when untaxed amount is below 80000', () => {
    expect(classifyItemCategory({ untaxedAmount: 79999, soldWithVehicle: false })).toBe('材料');
  });

  it('classifies as 材料 when sold with vehicle regardless of amount', () => {
    expect(classifyItemCategory({ untaxedAmount: 200000, soldWithVehicle: true })).toBe('材料');
  });
});

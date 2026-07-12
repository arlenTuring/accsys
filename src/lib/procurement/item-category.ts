const EQUIPMENT_THRESHOLD = 80000;

export function classifyItemCategory(input: {
  untaxedAmount: number;
  soldWithVehicle: boolean;
}): '設備' | '材料' {
  if (input.untaxedAmount >= EQUIPMENT_THRESHOLD && !input.soldWithVehicle) {
    return '設備';
  }
  return '材料';
}

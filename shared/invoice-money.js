import Decimal from 'decimal.js';

// Draft fields can be temporarily blank or incomplete while someone types.
function decimal(value) {
  try {
    const result = new Decimal(value || 0);
    return result.isFinite() ? result : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

export const roundMoney = value => decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
export const sumMoney = values => roundMoney(values.reduce((sum, value) => sum.plus(decimal(value)), new Decimal(0)));

// Both the browser preview and server persistence use this calculation.
// Input validation and supported-rate checks remain the server's responsibility.
export function lineValues(item) {
  const taxable = roundMoney(decimal(item.quantity).times(decimal(item.unitPrice)));
  const rate = item.rate === 'Exempt' ? 0 : String(item.rate || '0').replace('%', '');
  const tax = roundMoney(decimal(taxable).times(decimal(rate)).div(100));
  const total = roundMoney(decimal(taxable).plus(tax).plus(decimal(item.extraTax))
    .plus(decimal(item.furtherTax)).plus(decimal(item.fedPayable)).minus(decimal(item.discount)));
  return { taxable, tax, total };
}

const small = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function integerWords(value) {
  if (!value) return 'Zero';
  if (value < 20) return small[value];
  if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${small[value % 10]}` : ''}`;
  for (const [size, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']]) {
    if (value >= size) return `${integerWords(Math.floor(value / size))} ${label}${value % size ? ` ${integerWords(value % size)}` : ''}`;
  }
}

export function numberWords(value) {
  const rounded = decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const [rupees, paisa] = rounded.abs().toFixed(2).split('.').map(Number);
  return `${rounded.isNegative() && !rounded.isZero() ? 'Minus ' : ''}${integerWords(rupees)} ${rupees === 1 ? 'Rupee' : 'Rupees'}${paisa ? ` and ${integerWords(paisa)} Paisa` : ''} Only.`;
}

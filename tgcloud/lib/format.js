export function formatMoney(amount) {
  const rounded = Math.round(amount * 10) / 10;
  const isInt = Number.isInteger(rounded);
  const formatted = isInt
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${formatted} ming`;
}

export function formatAmount(amount) {
  const isInt = Number.isInteger(amount);
  return isInt
    ? amount.toLocaleString('en-US')
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

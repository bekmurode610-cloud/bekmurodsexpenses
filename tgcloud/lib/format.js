export function formatMoney(amount, currency = 'UZS') {
  const cur = (currency || 'UZS').toUpperCase();
  const rounded = Math.round(amount * 10) / 10;
  const isInt = Number.isInteger(rounded);
  const formatted = isInt
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  if (cur === 'UZS') {
    return `${formatted} ming`;
  }
  return `${formatted} ${cur}`;
}

export function formatAmount(amount, currency = 'UZS') {
  return formatMoney(amount, currency);
}

/**
 * Parses a natural expense string like:
 * - "40 ming nonga" -> { amount: 40, currency: "UZS", description: "nonga" }
 * - "2 ta non 10 ming" -> { amount: 10, currency: "UZS", description: "2 ta non" }
 * - "1.5 mln kvartira" -> { amount: 1500, currency: "UZS", description: "kvartira" }
 * - "40000 nonga" -> { amount: 40, currency: "UZS", description: "nonga" }
 * - "1500 bozorlik" -> { amount: 1500, currency: "UZS", description: "bozorlik" }
 * - "20 usd taxi" -> { amount: 20, currency: "USD", description: "taxi" }
 */
export function parseExpenseInput(rawText) {
  if (!rawText) return null;

  let text = rawText.trim();

  // Detect currency first
  let currency = 'UZS';
  const currMatch = text.match(/\b(UZS|USD|EUR|RUB)\b|\$/i);
  if (currMatch) {
    const rawCur = currMatch[0].toUpperCase();
    currency = rawCur === '$' ? 'USD' : rawCur;
  }

  // 1. Prefer a number directly followed by a unit keyword (ming, k, min, mln, million, so'm, som, uzs, usd, eur, rub, $)
  const unitRegex = /(\d+(?:[.,]\d+)?)\s*(ming|k|min|mln|million|so['’`]?m|som|uzs|usd|eur|rub|\$)\b/i;
  const unitMatch = text.match(unitRegex);

  let amount = 0;
  let unit = '';
  let description = '';

  if (unitMatch) {
    amount = parseFloat(unitMatch[1].replace(',', '.'));
    unit = unitMatch[2].toLowerCase();
    description = (text.slice(0, unitMatch.index) + ' ' + text.slice(unitMatch.index + unitMatch[0].length)).trim();
  } else {
    // 2. Fallback: find the first number in the text
    const numMatch = text.match(/(\d+(?:[.,]\d+)?)/);
    if (!numMatch) return null;
    amount = parseFloat(numMatch[1].replace(',', '.'));
    description = (text.slice(0, numMatch.index) + ' ' + text.slice(numMatch.index + numMatch[0].length)).trim();

    // Check if a standalone unit word exists elsewhere in description
    if (/\b(?:mln|million)\b/i.test(description)) {
      unit = 'mln';
      description = description.replace(/\b(?:mln|million)\b/i, '').trim();
    } else if (/\b(?:ming|k|min)\b/i.test(description)) {
      unit = 'ming';
      description = description.replace(/\b(?:ming|k|min)\b/i, '').trim();
    }
  }

  if (isNaN(amount) || amount <= 0) return null;

  // Remove leftover currency tokens from description
  description = description
    .replace(/\b(UZS|USD|EUR|RUB|so['’`]?m|som)\b|\$/gi, '')
    .replace(/^[-_\s,:;]+|[-_\s,:;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!description) {
    description = 'Expense';
  }

  // Normalize UZS amount into "ming" (thousands)
  if (currency === 'UZS') {
    if (unit === 'mln' || unit === 'million') {
      amount = amount * 1000;
    } else if (unit === 'ming' || unit === 'k' || unit === 'min') {
      if (amount >= 10000) {
        amount = amount / 1000.0;
      }
    } else {
      // No explicit unit: in Uzbekistan, raw numbers >= 10,000 (e.g. 40000) are full UZS -> convert to ming
      // Numbers < 10,000 (e.g. 40, 150, 1500) are already in ming
      if (amount >= 10000) {
        amount = amount / 1000.0;
      }
    }
  }

  return {
    amount,
    currency,
    description,
  };
}

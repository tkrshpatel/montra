"""Deterministic money allocation; legacy expenses default to paid by self."""
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP


def allocations(expense):
    precision = Decimal('1') if expense.get('currency') == 'JPY' else Decimal('0.01')
    amount = Decimal(str(expense['amount'])).quantize(precision, rounding=ROUND_HALF_UP)
    shares = expense.get('shares') or [{'participant_id': p, 'share': 1} for p in
                                      ['self', *dict.fromkeys(expense.get('split_with') or [])]]
    weights = [(s['participant_id'], Decimal(str(s['share']))) for s in shares]
    total = sum(w for _, w in weights)
    exact = [(p, amount * w / total) for p, w in weights]
    result = {p: a.quantize(precision, rounding=ROUND_DOWN) for p, a in exact}
    remainder = int((amount - sum(result.values())) / precision)
    for p, _ in sorted(exact, key=lambda row: (-(row[1] - result[row[0]]), row[0]))[:remainder]:
        result[p] += precision
    return result


def friend_effect(expense, friend_id):
    """Signed amount owed to self by this friend, in the expense currency."""
    parts = allocations(expense)
    payer = expense.get('paid_by', 'self')
    if payer == 'self':
        return float(parts.get(friend_id, 0))
    if payer == friend_id:
        return -float(parts.get('self', 0))
    return 0.0


def settlement_effect(settlement):
    return float(settlement['amount']) * (-1 if settlement.get('direction', 'received') == 'received' else 1)

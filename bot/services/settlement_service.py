from typing import List, Tuple, Dict

def calculate_settlements(balances: Dict[int, float]) -> List[Tuple[int, int, float]]:
    """
    Given a dict of {member_id: balance}, returns a list of settlements to make everyone 0.
    Returns: [(debtor_id, creditor_id, amount), ...]
    """
    debtors = []
    creditors = []

    for member_id, balance in balances.items():
        if balance < -0.01:
            debtors.append([member_id, -balance])
        elif balance > 0.01:
            creditors.append([member_id, balance])

    # Sort to optimize (largest debts to largest credits)
    debtors.sort(key=lambda x: x[1], reverse=True)
    creditors.sort(key=lambda x: x[1], reverse=True)

    settlements = []

    i, j = 0, 0
    while i < len(debtors) and j < len(creditors):
        debtor_id, debt = debtors[i]
        creditor_id, credit = creditors[j]

        settled_amount = min(debt, credit)
        settlements.append((debtor_id, creditor_id, settled_amount))

        debtors[i][1] -= settled_amount
        creditors[j][1] -= settled_amount

        if debtors[i][1] < 0.01:
            i += 1
        if creditors[j][1] < 0.01:
            j += 1

    return settlements

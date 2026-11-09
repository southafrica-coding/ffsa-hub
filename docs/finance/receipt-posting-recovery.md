# Stalled receipt posts

A confirmed receipt claims one `budget_xero_spends` row before it calls Xero. The write sends header `Idempotency-Key: ffsa-expense-<expenseId>`. Xero's Accounting OpenAPI describes that header as a way to retry a write without duplicate processing, at most 128 characters. It does not say how long the key is kept, and it does not offer a read by that header. A local row plus a key is not proof the spend exists.

## What finance can call

`POST /api/finance/outreach/receipts/xero/reconcile`

```json
{ "draftId": "<receipt draft uuid>" }
```

The caller must be signed in and allowed to edit finance projects (`canEditFinanceProjects`: admin, `finance_admin`, or `finance.edit`). A claimant or a budget viewer cannot call it. A bank transaction id in the body is ignored. The route does not POST a spend. Preview deployments refuse it.

The log update runs as that signed-in person, so the existing budget audit trigger records them. The Xero read uses the server's ZA connection.

## Answers

| HTTP | `status` | Meaning |
| --- | --- | --- |
| 200 | `reconciled` | One ZA `GET BankTransactions?References="ffsa-expense-<expenseId>"` row agreed: `SPEND`, `AUTHORISED`, same date, `CurrencyCode` ZAR, `Total` equal to the claim cents, `Reference` exact. The log now stores that `BankTransactionID`. |
| 200 | `already_recorded` | The log already had a bank transaction id. Nothing was read in order to invent a new one. |
| 200 | `blocked` | `reason` is `not_found`, `ambiguous`, `mismatch`, or `unproven`. The claim stays without a bank id. It was not posted again and was not marked failed. |
| 409 | `not_stalled` | There is no `posting` or `blocked` claim, or the budget is not the active South Africa organisation. |
| 403 | | No permission, or preview writes are disabled. |
| 404 | | This person cannot see that draft. |
| 500 | `blocked` / `persistence_failed` | The proof was not saved. Do not treat the spend as recorded. |

`blocked.message` says which of those it was. A missing currency, a different total, a different date, a non-spend, two rows with the same reference, a cut-off page, a timeout, or an empty read all stay blocked.

## What to do

1. Call the reconcile endpoint once for the stalled draft.
2. If the answer is `reconciled` or `already_recorded`, the log has the Xero id. Stop.
3. If the answer is `blocked`, leave the row. In the FFSA NPC (ZAR) Xero organisation, search bank spends for the reference `ffsa-expense-<expenseId>` and compare the date, the rand total, and the bank transaction id yourself. This Hub call will not reset the row and will not send the spend again.
4. Do not confirm the receipt again to force a second post while the claim is `posting` or `blocked`. A second confirm does not call Xero.

A Xero response of "not connected" happens before any request is sent. That claim is `failed`, and a later confirm may post. Any other Xero error, including a timeout, leaves the claim `blocked`.

## Limits

The read is the documented `References` filter on `GET /BankTransactions`, then the field checks above. It is not a lookup by `Idempotency-Key`. Official docs used:

- [Bank transactions](https://developer.xero.com/documentation/api/accounting/banktransactions) and the Accounting OpenAPI `getBankTransactions` (`where`, `References`) and `BankTransaction.Reference`
- Idempotency parameter text in that OpenAPI: retry a write without duplicate processing, 128 character maximum

The live Xero tenant was not called. A mock of the read is not Xero's guarantee.

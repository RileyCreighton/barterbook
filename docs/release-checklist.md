# Release checklist

## Judging delivery

- [x] Independently verify the real browser basket and three-way match against both Devnet providers.
- [x] Archive original finalized bytes, signatures, token metadata and exact deltas.
- [x] Make browser proof and the no-wallet recorded walkthrough easy to find.
- [x] Document judge-controlled two-/three-wallet tests and token acquisition.
- [x] Preserve Devnet/test-token disclosure and document current operating limits.
- [x] Prepare submission descriptions within the form's length limits.
- [ ] Owner supplies final team/track attestations and submits the entry.
- [ ] Optional: owner records and links a pitch video of at most three minutes.

## Every deployment

Run the regression suite, typecheck/build, secret scan and relevant browser checks. Record the current Worker version and D1 bookmark, apply additive migrations, deploy the reviewed source and verify the served bundle. Exercise new financial/setup routes with disposable Devnet keys and preserve original signed requests before broadcast. Never restore an older D1 database over unresolved attempts.

Test and deployment reports under `evidence/local/` and `evidence/hosted/` record actual outcomes rather than treating this checklist as proof.

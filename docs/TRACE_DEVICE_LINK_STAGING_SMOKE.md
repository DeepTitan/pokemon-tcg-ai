# Staging device-link verification

On September 29, 2026, the operator ran
`scripts/aws/smoke-trace-device-link-staging.py` against the isolated
`trace-memberships-capture-staging` and `trace-memberships-staging` stacks in
AWS account `108241940679`, `us-east-1`. Execution session `91365` exited **0**.
The final private event was `completed` with `cleanupRequired: false`, and the
operator acknowledged it before the private channel closed.

The live run passed all of these checks:

- Exact staging APIs, stack parameters and physical table ownership.
- A newly registered synthetic installation received the exact Free capabilities.
- Explicit approval in the signed-in staging browser linked that installation
  to the expected Supporters account. The device API returned active Supporters,
  its full capabilities and `admin: false`.
- Unlinking immediately restored the exact Free capabilities and removed the
  account association.
- Conditional cleanup removed the disposable installation and its known
  link/code/rate records, with absence verified afterward.

Browser evidence is retained in the sibling website checkout at
`artifacts/supporter-app-linked-browser-20260929.png`. The operator reported the
live results above; the script's **11 offline guard tests** also passed in an
independent review.

The test launched no native app or game, recorded no match, sent no email and
created no purchase. Registration credentials stayed in memory; the short link
code and staging URL used private FIFOs. Existing account and billing records
were not deleted. This verifies paid membership propagation to an installation,
not production deployment or native post-match decklist enforcement.

## Repeating the test

Use the script's documented `--execute`, `--control-dir` and
`--expected-subject` arguments only after reviewing its fixed staging guards.
It reuses the private `Channel` helper from the sibling website release
checkout. Without `--execute`, it makes no provider requests or files.

If a link-start response is lost, its unknown short-lived code may remain until
TTL cleanup; deleting the owned synthetic installation prevents later approval.
If registration credentials are lost, the script refuses to guess ownership
and hands the operator private cleanup inventory instead of deleting blindly.

# sdk-web

## Public repository privacy gate

This repository is public. Every pull request title and body, issue, comment,
review, commit message, branch name, changelog, release note, screenshot, log,
fixture, test output, and published artifact must be safe for anyone on the
internet to read.

- Never publish customer or prospect names, organization names, contact names,
  email addresses, account or session identifiers, private support details,
  private tracker keys, or links to private repositories and internal tools.
- Describe reports generically, for example "a browser report" or "an
  integrator", and keep the identifiable source only in the private tracker.
- Before posting, pushing, or publishing, review the full text and every
  attached or generated artifact. If any detail might identify a customer,
  person, account, private system, or build machine, stop and sanitize it.
- Public GitHub content is permanent disclosure even when later edited. Treat
  this as a hard pre-publication gate, not a cleanup task.

## Engineering rules

- Read the relevant source and tests before editing.
- Run lint, tests, and the package build before opening a pull request.
- Never commit directly to the default branch.

# Contributing to Noteleaf

Thank you for helping improve Noteleaf.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install dependencies with `npm ci`.
3. Make the smallest coherent change and include tests for behavior changes.
4. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run license:audit`, and `npm run build`.
5. Open a pull request that explains the user impact, verification performed, and any platform-specific behavior.

UI changes should be checked on both Windows and macOS when possible. Changes to packaging must keep both Electron Builder targets valid. Dependency updates must pass the license audit and must regenerate `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_LICENSES.txt` with `npm run license:notices`.

## Contribution license

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in Noteleaf is provided under Apache License 2.0, consistent with section 5 of the license. Do not contribute material you do not have the right to submit.

## Conduct

Be respectful, specific, and constructive. Harassment, discrimination, threats, and disclosure of another person's private information are not acceptable in project spaces. Maintainers may remove abusive material or restrict participation to protect the community.

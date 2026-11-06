# Contributing

Changes are welcome: bug fixes, features, docs.

1. Open an issue first for anything bigger than a fix, so we agree on the direction.
2. Run `npx tsc --noEmit -p .` and `npx vitest run`; add a test for new logic.
3. Describe a change you can see in the matching page of `docs/features/` and add a check to `TESTING.md`.
4. Sign off each commit (`git commit -s`), which says you wrote it or may submit it.

## License of contributions

WorkDesk is under the [PolyForm Shield License 1.0.0](LICENSE). By sending a change you agree that:

- it is licensed under the same terms, and
- the maintainer may also license it under other terms later (for example in a differently licensed edition).

If you cannot agree to the second point, say so in the pull request before it is merged.

## Forks

A fork is fine for your own use, and for work. Providing a product that competes with WorkDesk is not (see the license). A fork that is shared must use another name than *WorkDesk* and keep the `Required Notice:` line of `LICENSE`.

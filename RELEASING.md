# Releasing

## One-time first npm publish

The first publish creates the npm package page. After that, configure Trusted
Publishing on npm and let GitHub Actions publish future releases without an npm
token.

1. Make sure the package metadata and tarball are correct:

   ```sh
   npm ci
   npm test
   npm pack --dry-run
   ```

2. Sign in to npm with an account allowed to create `agent-readable-ts`:

   ```sh
   npm login
   npm whoami
   ```

3. Publish `0.1.0` manually:

   ```sh
   npm publish
   ```

4. Push the release tag and create the first GitHub release:

   ```sh
   git tag v0.1.0
   git push origin main --tags
   ```

   Create a GitHub release for `v0.1.0` from the GitHub UI. The publish
   workflow checks npm first and skips `npm publish` if `0.1.0` is already
   published.

## Configure npm Trusted Publishing

On npmjs.com, open the `agent-readable-ts` package settings and add a Trusted
Publisher with these values:

- Publisher: `GitHub Actions`
- Organization or user: `zydo`
- Repository: `agent-readable-ts`
- Workflow filename: `publish.yml`
- Environment name: leave blank unless the workflow is later moved behind a
  GitHub deployment environment
- Allowed actions: `npm publish`

The workflow file must remain at `.github/workflows/publish.yml`, because npm
matches the configured workflow filename exactly.

## Future releases

1. Bump the version:

   ```sh
   npm version patch
   ```

   Use `minor` or `major` instead of `patch` when appropriate.

2. Push the commit and tag:

   ```sh
   git push origin main --follow-tags
   ```

3. Create a GitHub release for the new tag. Publishing the release triggers
   `.github/workflows/publish.yml`, which runs tests, verifies the npm tarball,
   and publishes with Trusted Publishing.

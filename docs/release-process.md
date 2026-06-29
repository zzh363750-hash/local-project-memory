# Project CTO Release Process

Project CTO uses `.github/workflows/release.yml` to build and publish one
Apple Silicon DMG for every semantic version tag.

## Publish a release

Commit and push the source changes first. Then create and push a new tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow will:

1. derive version `0.1.1` from the tag;
2. install the locked frontend and Rust dependencies;
3. run `pnpm build` and `cargo test`;
4. build `Project CTO_0.1.1_aarch64.dmg`;
5. verify the disk image;
6. create the `v0.1.1` GitHub Release and upload the DMG.

If the workflow is retried for an existing tag, it removes an existing asset
with the same exact or GitHub-normalized filename before uploading the new DMG.
The concurrency lock prevents two jobs for the same tag from publishing at the
same time.

## Rules

- Use a new semantic version tag for every release, such as `v0.1.2`.
- Do not reuse a published tag for unrelated source changes.
- Do not commit DMG files to Git; GitHub Release stores the generated asset.
- The workflow temporarily sets the Tauri version from the tag only inside CI.

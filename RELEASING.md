# Releasing Streamo

## Windows — signed release (SignPath Foundation)

Windows builds are signed by [SignPath.io](https://signpath.io) with a certificate issued to **SignPath Foundation** (free for open-source projects).

### One-time setup (done by the owner: X5Coder)

1. **Apply** at <https://signpath.org/> to the Open Source Code Signing program. Requirements used here:
   - OSI-approved license — this repo is MIT (`LICENSE`).
   - Public repository, already released, documented on its download page (website + README).
   - Automated build from the repository (GitHub Actions — required for OSS signings to be verifiable).
   - Code signing policy on the project/download pages — done at
     <https://x5coder.github.io/Streamo/code-signing-policy.html>
     (contains the required text and team roles: owner `X5Coder`).
   - Team members use MFA (SignPath requires multi-factor authentication).
2. In the SignPath dashboard, create/confirm:
   - **Organization** — note the *Organization ID*.
   - **Project** — e.g. slug `streamo`, linked to the GitHub.com Trusted Build System and this repository.
   - **Artifact configuration** — a single file artifact (the portable `.exe`); the release workflow uploads the exe without an archive (`archive: false`, `skip-decompress: true`). Enable the `version` user-defined parameter if you want it enforced (`parameters.version`).
   - **Signing policy** — e.g. slug `release-signing`, with *manual approval* per request.
   - Install the [SignPath GitHub App](https://github.com/apps/signpath) for audit-log/build-policy verification.
3. Create a **CI user** with *submitter* permissions on the project/signing policy, generate an API token.
4. On GitHub (repo → **Settings → Secrets and variables → Actions**):
   - **Secret** `SIGNPATH_API_TOKEN` — the CI token.
   - **Variables** `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`.

### Cut a Windows release (e.g. 2.0.1)

1. Bump `version` in `windows/package.json` (and rebuild via `npm run dist` is not needed locally — CI builds it).
2. Run the workflow **Build & Sign Windows Release** (Actions → workflow dispatch) with `version: 2.0.1`.
3. GitHub Actions builds the exe, submits a signing request to SignPath.
4. **Approve the request** in the SignPath dashboard (you get notified).
5. The workflow downloads the signed exe, deletes any old `Streamo-v<version>-portable.exe` / `Streamo-v<version>-windows.exe` assets, uploads the signed `Streamo.exe`, and sets the release title to `Streamo v<version> — Windows`.

Download links in README/website point to `Streamo.exe`.

## Android

Android releases are signed with the project keystore (kept out of the repo, see `android/.gitignore`).
Keep the asset name `Streamo.apk` (plain name, no version) and the release title `Streamo v<version> — Android`.

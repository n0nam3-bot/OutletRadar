# Outlet Radar — GitHub ZIP updater

This one-time GitHub Actions workflow lets you upload a project ZIP to the **root** of your repository. GitHub Actions will safely extract it, place the app files in the correct repository folders, remove stale app files, delete the uploaded ZIP, and commit the update.

## One-time setup

1. Open your Outlet Radar repository on `github.com`.
2. Select **Add file → Create new file**.
3. Enter this exact filename in the filename field:

   `.github/workflows/apply-update-zip.yml`

   GitHub creates the `.github/workflows` folders when you enter the full path; you do not need to create them separately.
4. Copy the complete contents of `apply-update-zip.yml` into the editor.
5. Commit the new file to your default branch (normally `main`).
6. Open the repository's **Actions** tab and confirm **Apply uploaded project ZIP** appears.

## Every future app update

1. Download the new Outlet Radar project ZIP.
2. Open your repository on `github.com`.
3. Select **Add file → Upload files**.
4. Upload the ZIP directly into the repository's top level (do not put it inside a folder).
5. Commit the upload to the same branch that contains the workflow.
6. Open **Actions**. The workflow will extract the ZIP, copy the project into the correct folders, remove the ZIP, and commit the resulting update automatically.
7. Vercel should detect the resulting commit and start a deployment.

Only upload **one ZIP at a time**. The ZIP may contain a wrapper folder named `nike-clearance-finder`; the workflow automatically strips that wrapper so `package.json`, `app/`, `db/`, and the other project files land at the repository root.

## What the workflow preserves

- `.github/` (including this workflow)
- `.env` and local environment files
- `node_modules/`, `.next/`, and `.vercel/`
- root-level `*-migration*.sql` files
- the uploaded ZIP is deleted after successful extraction

The ZIP is mirrored into the repository, so obsolete application files that are not in the new ZIP are removed. Do not use this workflow for unrelated ZIP files.

## If the workflow cannot push

In GitHub, open **Settings → Actions → General → Workflow permissions** and enable **Read and write permissions**, then rerun the failed workflow. The workflow itself requests only `contents: write` so it can commit the extracted files.

## Database migrations

This workflow handles project ZIPs only. If an update comes with a separate Neon `.sql` migration file, run that SQL in Neon SQL Editor as instructed for that release. It does not execute SQL against your database.

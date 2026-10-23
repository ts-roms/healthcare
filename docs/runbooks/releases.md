# Releases and rollback

How a version of the platform is cut, deployed and, if it goes wrong, rolled back. Deployment itself is in `docs/deployment/railway.md`.

## Model

| Ref                 | What it is                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `main`              | Integration branch. Everything merged through pull requests with passing CI.                |
| `release/vX.Y.Z`    | Cut from `main` when a version is ready. Only fixes for that version go in (cherry-picked). |
| tag `vX.Y.Z`        | An immutable point on the release branch. This is the thing that is deployed and restored.  |
| branch `production` | What Railway deploys. Moved only to a tag; never committed to.                              |

Version numbers follow `MAJOR.MINOR.PATCH`: a patch is a fix only, a minor adds behaviour without breaking an API or screen in use, a major changes a contract (API shape, permission meaning, a migration that cannot run beside the old code).

## Cutting a release

1. Make sure `main` is green (`ci.yml`) and contains what the release should.
2. Branch and tag:

```bash
git switch main && git pull
git switch -c release/v1.0.0
git tag -a v1.0.0 -m "v1.0.0"
git push origin release/v1.0.0 v1.0.0
```

3. Pushing the tag runs `.github/workflows/release.yml`, which creates the GitHub Release with generated notes (the pull requests since the previous tag). Read them, and add the migration numbers the release contains.
4. Deploy: point `production` at the tag.

```bash
git push origin v1.0.0:refs/heads/production
```

Railway services (`api`, `integration-worker`, `notification-worker`, `staff`, `portal`) deploy from the `production` branch. Set that once per service under Settings → Source → Branch.

Order within a release that has a migration: the API runs `pnpm db:migrate` in its pre-deploy step, so deploy `api` first, then the workers, then `staff` and `portal`.

## A fix after release

1. Fix on `main` through a pull request as usual.
2. Cherry-pick onto the release branch, tag the patch and deploy it:

```bash
git switch release/v1.0.0 && git pull
git cherry-pick <commit>
git tag -a v1.0.1 -m "v1.0.1"
git push origin release/v1.0.0 v1.0.1
git push origin v1.0.1:refs/heads/production --force-with-lease
```

`production` is moved with `--force-with-lease` because it is a pointer, not a history.

## Rolling back

There are two levels. Use the smaller one that works.

**1. Redeploy the previous deployment (fastest, minutes).** In Railway, open the service → Deployments → the last good deployment → Redeploy. This reruns the exact earlier build. It does not touch the database.

**2. Move `production` back to the previous tag.**

```bash
git push origin v1.0.0:refs/heads/production --force-with-lease
```

Railway builds that tag again. Use this when the earlier deployment is no longer listed.

### The database does not roll back

Migrations in `database/migrations/` are forward-only and are never edited once applied. Rolling the code back leaves the newer schema in place, so a release is only safely reversible when the **previous version still works on the new schema**. To keep that true:

- Add before you remove: a new column or table first, code that uses it next, the removal of the old one in a later release.
- A migration that drops, renames or tightens something the previous version reads belongs in a major version, deployed with a planned maintenance window, with a backup taken first (`docs/runbooks/backup-and-restore.md`).
- Before any release that contains a migration, take a database backup and note its time in the release notes.

If a release must be undone and its migration is not compatible with the old code, restore the backup taken before the release, then roll the code back. That loses everything written since the backup; treat it as a last resort and decide who signs it off before the release, not during the incident.

## Checklist for each release

- [ ] `main` green; no open pull request that belongs in this version.
- [ ] Migration numbers in this release listed in the release notes; each is additive, or the version is a major.
- [ ] Backup taken before deploying if there is a migration.
- [ ] Tag pushed; GitHub Release notes read.
- [ ] `production` moved to the tag; `api` deployed first and `GET /api/v1/health/ready` answers `ok`.
- [ ] Staff and MyHealth sign-in and one real screen checked after deploy.
- [ ] The previous tag recorded as the rollback target.

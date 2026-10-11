# Backup and restore runbook

Status: procedure written and tested on one machine on 2026-10-11 (see `RESTORE_DRILL_LOG.md`). The Phase 0 exit gate also needs a restore on a **separate machine** and a scheduled backup on the real host. Neither is done yet.

## 1. What is backed up

Each backup is one archive, `nitex-<timestamp>.tar.gz`, containing:

| Item | How it is copied | Why |
|---|---|---|
| The SQLite database | `VACUUM INTO` a fresh file (a consistent snapshot, safe while the app is running) | All records, accounts, grades, audit log |
| The uploads folder | Copied as is | Materials, submissions, application documents, photos |
| `manifest.json` | Written by the script | SHA-256 of the database, file count, user count, time of backup |

The backup script re-opens the copy and runs `PRAGMA integrity_check` before it reports success. A failed check fails the run.

**Not in the archive** (keep these in the host's secret store or configuration, and record them separately):
- `.env` (the `JWT_SECRET`, provider keys, SMTP password). Without `JWT_SECRET`, restored sessions are invalid, which is safe but means everyone signs in again.
- The `*.pre-guardian-*.bak` files the app writes during a schema migration. They are copies of an older schema and are not needed after the migration is confirmed.
- Server logs.

## 2. Schedule and retention

| Setting | Default | Notes |
|---|---|---|
| Frequency | Daily (not yet scheduled on a host) | Use cron or the host's scheduler: `cd /app/server && node scripts/backup.js` |
| Folder | `server/backups/` or `BACKUP_DIR` | Put `BACKUP_DIR` on a different disk than the database, ideally a different host |
| Local retention | 14 archives (`BACKUP_KEEP`) | Older archives are removed by the script |
| Off-site copy | **Not set up.** Choose a target (object storage in the host's region) and copy each archive there. | Phase 9 moves this to object storage with versioning |

**Recovery point (RPO):** with a daily backup, up to 24 hours of data can be lost in a disaster. Use a shorter interval when a pilot asks for it. Point-in-time recovery is a Phase 9 item.

**Recovery time (RTO):** measured in the drill. The restore itself took under a second for the drill database. A real restore also covers starting the server, checking health, and a spot-check of data, which the checklist in section 4 covers.

Set a `UPLOADS_DIR` on the host so uploads live outside the code folder. Backup and restore both read the same setting.

**With the Docker compose file:** the database is on the `nitex-data` volume (`/data`) and uploads are on `nitex-uploads`. Keep backups on the data volume so they survive a container rebuild, then copy them off the host:

```bash
docker compose exec -e BACKUP_DIR=/data/backups app node server/scripts/backup.js
```

## 3. Restore procedure

Use this when the database is lost or damaged, or when restoring into a new environment.

1. **Stop the app** so nothing writes during the restore.
2. **Pick the archive.** Use the newest that passed the integrity check. Note its timestamp.
3. **Restore into the target paths.** Pass the database path and the uploads folder:

   ```bash
   cd server
   node scripts/restore.js /path/to/nitex-<timestamp>.tar.gz \
     --db /data/nitex.db --uploads /data/uploads
   ```

   The script:
   - refuses to overwrite an existing database unless `--force` is passed (use `--force` only after you have set the damaged copy aside);
   - checks the database SHA-256 against the manifest;
   - runs the integrity check before writing anything;
   - removes stale `-wal` and `-shm` files next to the target.
4. **Set the environment** on the new host: `DB_PATH=/data/nitex.db`, `UPLOADS_DIR=/data/uploads`, and the same `JWT_SECRET` as before if you have it.
5. **Start the app** and check `GET /api/health` returns `{"ok":true,"db":true}`.
6. **Run the checklist** in section 4.
7. **Record the restore** in `RESTORE_DRILL_LOG.md` (date, archive used, who ran it, result, time taken).

To restore one school only (Phase 7, database per school), restore that school's archive into its own database path. The other schools are not touched.

## 4. Checklist after a restore

- [ ] `/api/health` returns 200 with `db: true`.
- [ ] An admin can sign in. A student can sign in.
- [ ] Record counts look right: the user count matches the manifest (`manifest.json` → `database.counts.users`).
- [ ] A recent record (created the day of the backup) is present.
- [ ] One uploaded file opens for the right person (a student for their own material, a teacher for their class).
- [ ] The audit log has entries from before the backup time.
- [ ] Parent alerts: check `message_outbox` for rows stuck in `sending`. The worker puts a send back in the queue after five minutes (see `PHASE2_STATUS.md`, known limit 2), so a restored system should not hold such rows for longer.

## 5. What a drill must prove

A drill is not complete until all of these are true, and the result is written down:

1. The restore runs on a **different machine** from the one that made the backup.
2. The restored system signs in with a real account.
3. The data in the restored system matches the source at the backup time.
4. The time from "start restore" to "signed in" is recorded.
5. The drill is repeated at least every 90 days (roadmap, Phase 0 acceptance).

## 6. Common problems

| Symptom | Cause | Fix |
|---|---|---|
| `database hash does not match the manifest` | Archive damaged in transit or storage | Use an older archive, then copy again from the source |
| `target database already exists` | Restore target not empty | Move the old file aside, or pass `--force` deliberately |
| Users are signed out after a restore | `JWT_SECRET` differs from the original host | Expected if the secret was lost. Users sign in again. |
| Uploads return 404 after a restore | `UPLOADS_DIR` on the new host points somewhere else | Set `UPLOADS_DIR` to the restored folder, then restart |
| `integrity check failed` | The source database was already corrupt when backed up | Restore an older archive. Investigate the disk. |

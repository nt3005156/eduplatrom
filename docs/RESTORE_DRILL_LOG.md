# Restore drill log

Procedure: `docs/RESTORE_RUNBOOK.md`. Scripts: `server/scripts/backup.js`, `server/scripts/restore.js`.

## Drill 1: 2026-10-11, one sandbox (partial)

**Result: the procedure works end to end on one machine. The Phase 0 requirement, a restore on a separate machine, is NOT met.**

| Step | What was done | Result |
|---|---|---|
| Source | Server started on a fresh database (`/tmp/drill/source/nitex.db`) with the demo seed. A marker admin account and a marker upload were added while the server was running. | 4 users, 1 uploaded file |
| Backup, live | `node scripts/backup.js` run while the source server was still up (`VACUUM INTO`, WAL mode). | Archive written, integrity check `ok`, manifest: 4 users, 1 upload |
| Stop the source | Source server stopped, to stand in for losing the original host. | Stopped |
| Restore | `node scripts/restore.js <archive> --db /tmp/drill/newmachine/nitex.db --uploads /tmp/drill/newmachine/uploads`. A separate directory and a separate process, standing in for a new machine. | Hash matched the manifest; integrity `ok`; 4 users restored; uploads restored |
| Refuse overwrite | Same restore run again without `--force`. | Refused with a clear message; exit code 1 |
| Start on restored data | Server started on the restored database and uploads folder (`DB_PATH`, `UPLOADS_DIR`), port 4101. | `/api/health` → `{"ok":true,"db":true}` |
| Sign-in | The marker account, which exists only in the backup, signed in (HTTP 200). The seeded admin also signed in. | 200 and 200 |
| Upload | A file in the restored uploads folder was served through `/uploads/public/...`. | Served, contents correct |
| Timing | Backup about 0.4 s and restore about 0.3 s (includes Node start-up). Not a measure of a real restore, which includes copying the archive from off-site storage. | Recorded for reference |

**What this drill proves**
- The backup is a consistent copy taken while the app runs.
- The archive is checked by hash and integrity before it is trusted.
- A restore writes to a new location, refuses to overwrite by accident, and the restored app runs and signs in.
- The uploads folder can be placed outside the code folder (`UPLOADS_DIR`, added in this drill's follow-up work).

**What this drill does NOT prove**
- A different machine. The "new machine" was a directory on the same host. The gate needs a second host.
- An off-site copy. The archive never left the host.
- A schedule. The daily backup is not yet running on any host.
- Disk failure, power loss, or a corrupted live database. Only a clean copy was restored.
- Restore time for a real school database (size, network copy). The drill database is about 0.5 MB.

## Gate status

| Requirement (roadmap, Phase 0) | Status |
|---|---|
| Automated backups | Script built and tested. **Not scheduled on a host.** |
| One restore drill completed and recorded (restore to a new machine, sign in, see the data) | **Partly.** Done on one machine. A separate machine is still needed. |
| Drill repeated every 90 days | Not started. The date of the next drill depends on the first real host. |

## Next drill (to do on a real host)

1. Pick a second host (a different VM or machine, not the one running the app).
2. Copy the newest archive there from the off-site store.
3. Run the runbook (section 3) with `UPLOADS_DIR` set on the new host.
4. Complete the checklist (section 4) and record the time to sign-in.
5. Add a row to this log, with the host name, the archive name, and the result.

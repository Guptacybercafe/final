# Keep the free Render site awake

Render's free plan puts the site to sleep after 15 minutes with no visitors. The first visitor
then waits about 30 seconds. Three things keep it awake, all free:

1. **Server self-check (built in).** While awake, the server calls its own `/healthz` every 10 minutes.
2. **GitHub Action** (`.github/workflows/keep-awake.yml`). Pings `/healthz` every 5 minutes, but GitHub
   often runs it only every few hours, so do not rely on it alone.
3. **Free uptime monitor (do this once, about 2 minutes).** This is the most reliable one.
   - Go to uptimerobot.com (or cron-job.org) and make a free account.
   - Add a monitor: type HTTP(s), URL `https://gupta-cyber-cafe.onrender.com/healthz`, interval 5 minutes.
   - It also emails you if the site goes down.

Free plan limits to know:
- 750 free hours per month is enough for one service running all month.
- The free disk is wiped on every redeploy and restart. `job-posts.json` is safe because it lives in the
  repo, but print jobs, settings and the visitor count saved on the server are lost. Set `STORAGE_DIR`
  to a persistent disk only on a paid plan.

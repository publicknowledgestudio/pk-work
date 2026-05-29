# Oracle VM — Webhook Receiver

Files to deploy on the Oracle VM for the OpenClaw webhook receiver.

## Deploy steps

1. Copy files to VM:
   ```bash
   scp vm/webhook-receiver.js <oracle-vm>:~/clawd/webhook-receiver.js
   scp vm/openclaw-webhook.service <oracle-vm>:/tmp/openclaw-webhook.service
   ```

2. On the VM — install Express (if not already):
   ```bash
   cd ~/clawd && npm init -y && npm install express
   ```

3. Edit the service file with real values:
   ```bash
   sudo cp /tmp/openclaw-webhook.service /etc/systemd/system/openclaw-webhook.service
   sudo nano /etc/systemd/system/openclaw-webhook.service
   ```
   Replace:
   - `REPLACE_WITH_YOUR_SECRET` → same value as `OPENCLAW_WEBHOOK_SECRET` Firebase secret
   - `REPLACE_WITH_BOT_TOKEN_FROM_OPENCLAW_JSON` → `botToken` from `~/.openclaw/openclaw.json`
   - `REPLACE_WITH_CHANNEL_ID` → Slack channel ID of `#tell-asty` (right-click channel → View details → scroll down)

4. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable openclaw-webhook
   sudo systemctl start openclaw-webhook
   sudo systemctl status openclaw-webhook
   ```

5. Open port 3001 (iptables):
   ```bash
   sudo iptables -A INPUT -p tcp --dport 3001 -j ACCEPT
   sudo iptables-save | sudo tee /etc/iptables/rules.v4
   ```

6. Open port 3001 in OCI Console:
   - Networking → VCN → Security Lists → Default Security List
   - Add Ingress Rule: TCP, port 3001, source 0.0.0.0/0

7. Test from your Mac:
   ```bash
   curl -X POST http://<VM_PUBLIC_IP>:3001/webhook \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <your-secret>" \
     -d '{"event":"task_assigned","action":"created","task":{"id":"test","title":"Hello from Cloud","status":"todo","priority":"low"}}'
   # Expected: {"ok":true}  and #tell-asty shows the Slack message
   ```

### #tell-asty Channel — Task Inbox

`#tell-asty` is your task inbox. When someone assigns you a task in PK Work, a notification lands here automatically.

**When you see a task assignment in #tell-asty:**
1. Look up the task using `pkwork_status` with scope `asty` (or `pkwork_search`)
2. Update the task status to `in_progress` via `pkwork_task_set` so the team knows you're on it
3. If the task is clear — work on it, then post back to #tell-asty when done and mark it `done`
4. If you need clarification before you can start — post a question in #tell-asty and wait before changing the status

**When you need clarification, post something like:**
- "For *[task title]* — quick one: [your question]"
- "Before I start on *[task title]*, just want to check: [question]"
- "On *[task title]* — [your question]. Let me know and I'll get going!"

**When you finish, post something like:**
- "Done with *[task title]* ✅ [one line on what you did]"
- "Wrapped up *[task title]* ✅ Here's what I did: [brief summary]"
- "Just finished *[task title]* ✅ [outcome]"

Then immediately call `pkwork_task_set` with `status: "done"`.

**Status discipline:**
- Starting work → `in_progress`
- Blocked / waiting for answer → stay `in_progress`, post the question in #tell-asty
- Finished → `done` (always update this — the team tracks work on the board)

**Don't go silent.** If a task is taking time, post a quick update in #tell-asty so the team knows you're still on it.

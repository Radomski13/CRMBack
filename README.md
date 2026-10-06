# Fly Visuals Shop Tool

Job board, install calendar, quote calculator and materials tracking for Shop Fly Visuals. Won deals in GoHighLevel show up on the job board automatically.

## What's in it

- **Job Board** – drag jobs between stages (New → Design → Approval → Print/Cut → Install Scheduled → Installing → QC/Pickup → Done). Click a job to edit it, assign it, post notes for the team, and log materials used.
- **Install Calendar** – week view by bay. Drag a job from "Not scheduled" onto a day and bay to book it.
- **Quote** – wrap, tint and sign pricing. "Create job" turns a quote into a job.
- **Materials** – vinyl, laminate, film and sign stock. Material logged on a job is subtracted from stock and shows on the job as cost and margin. Rows turn red at the reorder level.
- **Settings** – team names, bays, board stages, pricing, and a log of the last 25 GHL webhook hits.

Everyone signs in with one shared shop password and their name. Their name shows on notes and changes.

**Prices are placeholders.** Set your real numbers in Settings → Pricing before using quotes.

## Run it on your computer (to try it)

1. Install Node.js 20 or newer from nodejs.org.
2. In this folder run:
   ```
   npm install
   APP_PASSWORD=pick-a-password WEBHOOK_KEY=pick-a-long-random-key npm start
   ```
   (On Windows PowerShell: `$env:APP_PASSWORD="..."; $env:WEBHOOK_KEY="..."; npm start`)
3. Open http://localhost:3000

## Put it online

Any host that runs Node and keeps files on a disk works. Two easy ones:

**Railway** (simplest)
1. Push this folder to a private GitHub repo.
2. In Railway: New Project → Deploy from GitHub → pick the repo.
3. Add a **Volume** mounted at `/data`.
4. Add variables (see table below), including `DATA_DIR=/data`.
5. Under Networking, generate a domain (or point `shop.flyvisualsfl.com` at it).

**Render**
1. New → Web Service → connect the repo. Build: `npm install`. Start: `npm start`.
2. Add a **Disk** mounted at `/data` (needs a paid instance; free instances wipe data).
3. Add the variables below.

| Variable | What it is |
|---|---|
| `APP_PASSWORD` | Shop password your team signs in with |
| `SESSION_SECRET` | Any long random string (keeps logins secure) |
| `WEBHOOK_KEY` | Long random string GHL uses to send jobs in |
| `DATA_DIR` | Where the database lives. Use `/data` with a volume/disk |
| `NODE_ENV` | `production` |

Back up `shop.db` in the data folder now and then. That file is all your jobs and stock.

## Connect GoHighLevel

1. In GHL go to **Automation → Workflows → Create Workflow**.
2. Trigger: **Opportunity Status Changed** (status = Won) or **Pipeline Stage Changed** (stage = your "Sold"/"Booked" stage).
3. Add action **Custom Webhook**:
   - Method: `POST`
   - URL: `https://YOUR-APP-ADDRESS/api/ghl/webhook?key=YOUR_WEBHOOK_KEY`
   - Content type: JSON. Build the body with the merge-field picker, like this:
   ```json
   {
     "opportunity_id": "{{ opportunity id }}",
     "contact_id": "{{ contact id }}",
     "first_name": "{{ contact first name }}",
     "last_name": "{{ contact last name }}",
     "phone": "{{ contact phone }}",
     "email": "{{ contact email }}",
     "title": "{{ opportunity name }}",
     "value": "{{ opportunity value }}",
     "service": "{{ your service custom field }}",
     "vehicle": "{{ your vehicle custom field }}"
   }
   ```
   Use GHL's merge-field picker to insert each value — the names above just show which field goes where.
4. Save, publish, and mark a test opportunity Won.
5. In the shop tool, open **Settings**. The webhook log shows exactly what GHL sent and whether a job was created.

How it behaves:
- A new `opportunity_id` creates a job in the first stage (tagged **GHL**).
- The same `opportunity_id` again updates the contact info and value, but never moves the job's stage or install date.
- If you leave out `opportunity_id`, every hit makes a new job, so include it.
- The tool also accepts GHL's default payload names (`full_name`, `contact_id`, `customData`, etc.), so a plain webhook with no custom body will still create a job with the name, phone and email.

## Notes

- Drag-and-drop needs a mouse. On phones, open a job and change **Stage** or **Install date** instead.
- The board refreshes every 30 seconds so everyone sees each other's changes.
- Changes in this tool do not flow back into GHL (one-way: GHL → shop). Two-way sync can be added later with a GHL API key.

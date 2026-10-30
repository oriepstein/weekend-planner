# Weekend Planner

A small website a group of friends can use together to plan a weekend away:

- **Which days work?** Everyone picks their name from the group's list, then taps days on a calendar: ✓ can make it, ✗ can't, ? not sure. **Everyone's answers** shows how many said what on each day, and tapping a day shows who. The site highlights the weekend (Saturday and Sunday) that suits the most people, and anyone can tap **Lock it in**.
- **Who's coming?** Once a weekend is locked in, everyone says *Coming*, *Maybe* or *Can't make it*.
- **Who's bringing what?** A shared list. Anyone can add things, and people tap **I'll bring it** to claim them.

Anyone with a plan's link can see and change it. Friends don't need an account. The list of names is at the top of `app.js` (`FRIENDS`); add or remove a line there to change the group. Each plan gets its own link, so you can run several trips at once.

## What's in this folder

| File | What it does |
| --- | --- |
| `index.html` | The page itself: headings, forms and empty boxes the app fills in |
| `style.css` | Colours and layout (works on phones, and in dark mode) |
| `app.js` | Everything the page does: working out the best weekend, saving answers, etc. |
| `firebase-config.js` | Your Firebase settings. **This is the only file you need to edit.** |
| `database.rules.json` | Rules you paste into Firebase (step 1, item 4) |

## Trying it on your Mac first

If `firebase-config.js` is still empty, the site runs in **practice mode**: everything works, but answers stay in your own browser only.

The page has to be opened through a small local web server (opening `index.html` by double-clicking won't work). In Terminal:

```bash
cd ~/Downloads/WeekendPlanner
```

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Press `Ctrl + C` in Terminal to stop it.

## Step 1: Set up the free Firebase database (one time, about 10 minutes)

Firebase is a free Google service that stores the group's answers so everyone sees the same plan.

1. Go to <https://console.firebase.google.com>, sign in with a Google account, and click **Create a project**. Call it something like `weekend-planner`. You can turn Google Analytics off.
2. In the left menu choose **Build → Realtime Database**, then **Create database**. Pick the location closest to you and choose **Start in locked mode**.
3. Still in Realtime Database, open the **Rules** tab.
4. Replace everything in the box with the contents of `database.rules.json` from this folder, then click **Publish**. These rules let anyone with a plan's link use that plan, but stop people from listing everyone's plans.
5. Click the gear icon next to **Project Overview → Project settings**. Under **Your apps**, click the **`</>`** (web) icon, give it a nickname, and click **Register app** (you don't need Firebase Hosting).
6. Firebase shows a block of code with `const firebaseConfig = { ... }`. Copy the values (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`) into the matching lines of `firebase-config.js`.
   If `databaseURL` is missing from that block, copy it from the top of the Realtime Database page (it looks like `https://weekend-planner-xxxx-default-rtdb.firebaseio.com`).

Reload the site: the yellow "Practice mode" note should be gone. Plans you made in practice mode don't carry over, so start a fresh one.

> Is it OK that these settings end up on GitHub? Yes. They only tell the site which database to talk to. What people can do is controlled by the rules from step 1, item 4.

## Step 2: Put it on GitHub Pages

GitHub Pages turns a GitHub repository (a folder of code stored on GitHub) into a free website.

1. Sign in at <https://github.com> and click **New repository** (the **+** at the top right).
2. Name it `weekend-planner`, choose **Public** (needed for free GitHub Pages), and **don't** tick "Add a README". Click **Create repository**.
3. GitHub then shows a web address ending in `.git`. In Terminal, run these one at a time, putting your GitHub username in place of `YOUR-USERNAME`:

```bash
cd ~/Downloads/WeekendPlanner
```

```bash
git remote add origin https://github.com/YOUR-USERNAME/weekend-planner.git
```

```bash
git push -u origin main
```

4. On the repository's GitHub page, go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the branch **main** and folder **/ (root)**, and click **Save**.
5. After a minute or two the page shows your site's address, something like `https://YOUR-USERNAME.github.io/weekend-planner/`.

## Step 3: Use it with your friends

1. Open your site and fill in **Start planning**.
2. Click **Copy link for friends** and send that link to the group chat.
3. Each friend opens it, taps their name once (the browser remembers them), and marks their days on the calendar.

## Changing it later

Edit the files, try them locally, then in Terminal:

```bash
git add -A && git commit -m "Describe your change here" && git push
```

GitHub Pages updates the site a minute or two later.

Hi Jack, a heads-up on the vehicles side of the Hub.

I've been running FFSA's vehicle inspections in an app I built with Claude (FFSA Fleet): weekly and monthly checks with a step-by-step checklist, km readings with service and bumper-to-bumper warnings (every 10 000 / 5 000 km), trips, rentals and workshop visits with clash checks, in-car guides, a time tracker, a handover tutorial, and a chat where you can ask or record things by typing or speaking. A 7am reminder goes out every day.

I want it to live inside the Hub so the vehicle co-ordinator works in one place, without it getting any harder to use (their inspections and booking admin must stay under 4–5 hours a week).

I've put it in the Hub repo on a branch called `vehicles-module`. It runs as it is (`npm run seed`, `npm start`), with our real data, a full spec (`docs/SPEC.md`), tests, and notes for Claude Code (`CLAUDE.md`). I'll use Claude Code to bring it in one step at a time; every step comes to you as a pull request, and nothing gets merged without you.

What I'll need from you:
1. A look at Claude Code's plan for fitting it into the Hub (`vehicles-module/HUB-PLAN.md`) before it changes anything.
2. A Vehicle Co-ordinator role, if there isn't one yet.
3. Reviewing and merging the pull requests, and running the data import on the live Hub when we're ready.
4. Later: the Hub's Slack app for the 7am reminder, and an Anthropic API key on the server if we switch on the chat.

The repo has to stay private: the data has our vehicle registrations, VINs, insurer details and workshop reports.

Thanks!

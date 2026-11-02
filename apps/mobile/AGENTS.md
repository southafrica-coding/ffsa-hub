This is the FFSA Hub phone app: an Expo (React Native) app that lives in `apps/mobile` of the FFSA Hub web repo. Read `README.md` here first; the repo-root `CLAUDE.md` covers the web app and the brand rules (one yellow "needs you" band per screen, no shadows, Roboto / Roboto Condensed / Roboto Mono).

## Expo has changed: do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that touches an Expo, EAS or React Native API:

1. Read the major version of `expo` in `package.json` (SDK 58 at the time of writing).
2. Read the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`, or the types/README in `node_modules`.
3. For anything else, start at https://docs.expo.dev/llms.txt.

## Rules for this folder

- Install packages with `npx expo install <package>` **inside `apps/mobile`**. Never run `npm install` at the repo root for mobile work: the root is the website's package.
- Routes live in `app/` (expo-router). Non-route code lives in `src/` (`@/…` alias).
- Style with the tokens in `src/theme/tokens.ts`, via the component kit (`src/components`) or NativeWind classes. Don't hardcode colours.
- The app holds only the public Supabase URL + anon key. No secrets, ever.
- `src/types/database.ts` is a generated copy: run `npm run types:sync`, never edit it.
- `ios/` and `android/` are generated (Continuous Native Generation). Configure native behaviour in `app.config.ts` and config plugins.
- EAS builds, submissions and updates are run by Jack, not by agents. Don't run `eas` / `eas-cli`.

## Before declaring a task done

```bash
npm run types:check && npm run typecheck && npm run lint && npm test
npx expo-doctor
```

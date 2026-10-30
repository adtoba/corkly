# Shared boards (Firebase)

Corkly boards are private and live on your computer. When you **share** a board, that one board is stored
in your Firebase project, so the people you invite can pin things on it from their own Corkly.

## How it works for people

1. Open a board → click the **share** button (person with a +) in the top bar, or the board name → **Share this board…**
2. Sign in (or create an account) — email + password.
3. **Start sharing this board**, pick **Pin only** or **Can edit**, and **Create invite code**.
4. Send the code (the **Copy invite message** button writes a friendly message for WhatsApp/email).
5. Your friend opens Corkly → board name → **Join a shared board…** → types the code.
   (`corkly://join/CODE` links also work and open Corkly directly.)

| Role | Can do |
| --- | --- |
| **Owner** | everything; invite people, remove people, turn invites off, stop sharing |
| **Can edit** | move, change and remove anything; rename the board; change the surface |
| **Pin only** | add notes, photos, lists, links and yarn; change or remove only their own pins |

New pins from other people get a red **NEW** sticker, a "— Name" signature and a desktop notification.
If someone is removed (or the owner stops sharing), they keep a private copy of the board.

## One-time Firebase setup (about 10 minutes)

1. Go to https://console.firebase.google.com → **Add project** → name it `corkly` (Analytics is optional).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database** → start in **production mode** →
   pick a location (e.g. `europe-west` regions are closest to Lagos). The location can't be changed later.
   (No Cloud Storage or paid plan needed — photos are shrunk to small JPEGs and stored in Firestore.)
4. **Project settings (gear) → General → Your apps → Web `</>`** → register an app called
   `Corkly desktop` (no hosting needed) → copy the `firebaseConfig` values into **`src/firebase-config.json`**:

   ```json
   {
     "apiKey": "AIza...",
     "authDomain": "corkly-xxxx.firebaseapp.com",
     "projectId": "corkly-xxxx",
     "storageBucket": "corkly-xxxx.firebasestorage.app",
     "messagingSenderId": "1234567890",
     "appId": "1:1234567890:web:abcdef"
   }
   ```

   These values are **not secret** — they identify your project; the security rules below are what protect
   the data. It's fine to commit this file so your GitHub builds include sharing.

5. **Publish the security rules** (they enforce the roles above on Google's servers). From this folder:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project YOUR_PROJECT_ID
   ```

   (Or paste `firebase/firestore.rules` into **Firestore → Rules** in the console and click Publish.)

6. Run `npm install` (builds the Firebase bundle) and `npm start`.

## Trying it with two people

Corkly only runs once per computer, so test with a second computer (or a friend): install the build from
your GitHub release there, create a second account, and join with your code.

There's also an automated two-person test that uses a fake in-memory cloud (no Firebase needed):

```bash
npm i -D playwright && npx playwright install chromium
node test/sync-test.js
```

## Where things live

| | |
| --- | --- |
| `src/cloud/index.js` | All Firebase calls (auth, sharing, invites, live sync). Bundled into `src/renderer/cloud.js` by `npm run build:cloud` (runs automatically on `npm install` / `npm start`). |
| `src/renderer/app.js` | "Shared boards" section — pushing your changes, applying everyone else's, the Share / Join / Account panels. |
| `firebase/firestore.rules` | Server-side permissions. |

### Data model

```
boards/{boardId}                 name, bg, ownerId, ownerName
boards/{boardId}/members/{uid}   role (owner | edit | pin), name, email
boards/{boardId}/items/{itemId}  one doc per pin (+ authorId, authorName, createdAt)
boards/{boardId}/strings/{id}    one doc per yarn string
boards/{boardId}/images/{id}     a shared photo: JPEG bytes shrunk to < 700 KB (Firestore's limit is 1 MB)
invites/{CODE}                   boardId, role, expiresAt (14 days), active
users/{uid}/boards/{boardId}     the boards someone has joined (so they appear on every computer)
```

Photos: when a photo is pinned on a shared board, Corkly shrinks it (max ~1400px, JPEG) and uploads it
once; everyone else downloads it once and keeps a copy on their computer, so boards open instantly
afterwards. Photos on your private boards stay full-size and never leave your computer. Firestore's free tier
holds about 1 GB, which is thousands of shared photos.

Each pin is its own document, so two people editing different pins never overwrite each other; if two people
edit the *same* pin at once, the last change wins. Positions are saved when you drop a pin, not while
dragging. Undo only covers your own changes since the last update from someone else.

# Privacy Policy — Sticky Notes Sync

_Last updated: 2026-10-27_

Sticky Notes Sync is a browser extension for writing quick formatted notes. This policy explains what data the extension handles and where it goes.

## Summary

- Your notes are stored **in your browser** and, if you sign in, **in a Google Sheet in your own Google Drive**.
- The developer runs **no servers** and receives **none** of your data. There is no analytics, advertising or tracking.
- The extension can only access Google Drive files **it created itself**.

## Data the extension handles

| Data | Where it is stored | Why |
| --- | --- | --- |
| Your folders and notes (text and formatting) | Your browser's extension storage; your own Google Sheet when signed in | To show and sync your notes |
| Your Google account email address | Your browser's extension storage | To show which account is signed in and to warn before syncing into a different account |
| A temporary Google access token (about 1 hour) | Your browser's session storage, cleared when the browser closes | To read and write your Google Sheet |

## Google permissions

When you choose **Sign in with Google**, the extension asks for:

- `openid` and `email` — to learn your email address.
- `https://www.googleapis.com/auth/drive.file` — to create the "Sticky Notes Sync" spreadsheet and read and write **only files this extension created**. It cannot see any other file in your Drive.

Data travels directly between your browser and Google's APIs over HTTPS. It is never sent to the developer or to any third party.

## Google API Services User Data Policy

Sticky Notes Sync's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data from Google APIs is used only to provide the note sync feature you see in the extension. It is not transferred to others, not used for advertising, and not read by humans.

## Your choices

- **Use without an account:** notes then stay only in your browser.
- **Sign out:** in the extension, open Account → Sign out. You can keep or remove the notes on that device.
- **Delete your data:** remove notes in the extension, delete the "Sticky Notes Sync" spreadsheet from Google Drive, and uninstall the extension.
- **Revoke access:** visit [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and remove Sticky Notes Sync.

## Changes

If this policy changes, the new version will be published at the same address with a new "Last updated" date.

## Contact

Questions: [lhduy.dev@gmail.com](mailto:lhduy.dev@gmail.com)

_Sticky Notes Sync is not affiliated with Google. Google, Google Drive and Google Sheets are trademarks of Google LLC._

# Direct cloud backup setup

Noteleaf supports direct backups without requiring Google Drive for desktop or the OneDrive sync client. Each provider is restricted to a dedicated application folder. Every new archive is encrypted locally before upload; note text, attachments, and the database are never sent as readable data.

## Backup encryption

- A user-chosen backup password is processed locally with scrypt. The password itself is never stored or transmitted.
- Archives use a unique salt and nonce plus AES-256-GCM authenticated encryption, so tampering is detected before any restore is applied.
- The derived local key is protected by Electron `safeStorage` (Keychain on macOS and DPAPI on Windows). A copied archive can be restored on another computer using its original password.
- Changing the password protects future backups with the new password. Existing archives still require the password that created them.
- Google and Microsoft can still observe normal file metadata such as the archive filename, size, and upload time. They cannot read the encrypted archive contents through Noteleaf.
- Noteleaf cannot recover a forgotten backup password. Users should keep it in a trusted password manager.

## Google Drive

1. Create a project in Google Cloud Console and enable the Google Drive API.
2. Configure the OAuth consent screen for an external application named **Noteleaf**.
3. Add only the non-sensitive `https://www.googleapis.com/auth/drive.file` scope.
4. Create an OAuth client with application type **Desktop app**.
5. Put its public client ID in `package.json` at `noteleafOAuth.googleClientId`.

Noteleaf uses the installed-app authorization-code flow with PKCE and a temporary loopback callback. It creates **Noteleaf Backups** in My Drive. The `drive.file` scope lets Noteleaf manage only files and folders it creates; it cannot browse the rest of the user's Drive.

## OneDrive

1. Register **Noteleaf** in Microsoft Entra ID.
2. Allow both personal Microsoft accounts and organizational accounts if both should be supported.
3. Add the **Mobile and desktop applications** platform and register `http://localhost/oauth/callback` as a redirect URI. Microsoft ignores the ephemeral port when matching a localhost redirect.
4. Enable public client flows.
5. Add the delegated Microsoft Graph permission `Files.ReadWrite.AppFolder`.
6. Put the application (client) ID in `package.json` at `noteleafOAuth.microsoftClientId`.

OneDrive creates the dedicated folder under **Apps/Noteleaf**. The app-folder permission does not grant access to other OneDrive files.

## Development overrides

Client IDs can be tested without editing `package.json`:

```sh
NOTELEAF_GOOGLE_CLIENT_ID="…apps.googleusercontent.com" npm run dev
NOTELEAF_MICROSOFT_CLIENT_ID="…" npm run dev
```

OAuth client IDs for installed applications are public identifiers, not secrets. Do not add a client secret to this desktop application. OAuth refresh tokens and the locally derived backup key are stored in separate files encrypted using Electron `safeStorage`, backed by Keychain on macOS and DPAPI on Windows, and are never exposed to the renderer. The backup password is never stored.

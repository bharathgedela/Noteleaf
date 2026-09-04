---
layout: default
title: Noteleaf Privacy Policy
---

# Noteleaf Privacy Policy

Last updated: September 4, 2026

Noteleaf is a local-first desktop application. This policy explains what information Noteleaf accesses and how optional integrations use it.

## Local notes and tasks

Your notes, tasks, settings, drafts, and managed attachments are stored locally on your computer. Noteleaf does not operate a server that receives or stores this content.

## Google Drive backups

Google Drive access is optional and begins only after you select **Connect Google Drive** and approve Google's consent screen. Noteleaf requests `https://www.googleapis.com/auth/drive.file`, which permits it to create and manage only the Drive files and folders created by Noteleaf or explicitly opened with it.

Noteleaf uses this access solely to:

- create its dedicated **Noteleaf Backups** folder;
- upload encrypted `.notesbackup` files;
- list Noteleaf-created backups for display and retention;
- download a selected backup for restoration; and
- delete older Noteleaf-created backups according to the retention setting you choose.

Noteleaf does not use Google Drive access to browse unrelated files, build advertising profiles, sell data, or transfer Google user data to data brokers. Google Drive data is not used to train AI models.

Backup contents are encrypted on your computer with a password-derived key before upload. Google receives the encrypted archive and ordinary file metadata such as its name, size, and timestamps. Noteleaf never sends your backup password to Google. The OAuth refresh token is encrypted locally using the operating system's protected credential storage and is not included in backups.

Noteleaf's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Microsoft OneDrive backups

If enabled in a future configured build, OneDrive access is similarly limited to Noteleaf's application folder. Noteleaf uses it only to upload, list, download, and apply retention to encrypted Noteleaf backups.

## AI access

AI access is optional and disabled until you enable it. Local AI clients can request selected Noteleaf content through the documented local interface. Content returned to an AI provider is then governed by that provider's terms and privacy policy. Protected text is redacted from AI responses, and write access is separately controlled.

## Retention and deletion

Backup retention is controlled by your Noteleaf settings. Disconnecting Google Drive removes Noteleaf's locally stored OAuth credentials but does not automatically delete backups already stored in Drive. You can delete those files in Google Drive or reconnect Noteleaf and let its retention controls manage them. You can revoke Noteleaf's Google access at any time from your Google Account's third-party connections page.

## Sharing and disclosure

Noteleaf does not sell personal information. The project has no application-operated analytics or advertising service. Data may be processed by Google, Microsoft, or an AI provider only when you explicitly enable the corresponding integration, under that provider's terms.

## Security

New backups use authenticated encryption designed to detect incorrect passwords and tampering before restoration. No software can eliminate every risk. Keep your operating system secure and store your backup password safely because Noteleaf cannot recover a forgotten password.

## Changes and contact

Material changes will be published on this page and reflected by its updated date. Questions or requests can be sent to [bharathkumaretl@gmail.com](mailto:bharathkumaretl@gmail.com) or filed in the [Noteleaf repository](https://github.com/bharathgedela/Noteleaf/issues).

[Return to Noteleaf](./)

# Private encrypted pages

Noteleaf can encrypt internal pages with one local vault password. Right-click a regular sidebar page and choose **Encrypt page…**. The first encrypted page creates the vault; later pages use the same password.

## What is protected

- The page title, rich-editor HTML, and Markdown are encrypted with AES-256-GCM using a fresh random nonce for each save.
- The vault key is derived with scrypt and is held only in memory. Noteleaf stores a salt and password verifier, never the password or derived key.
- Inline child pages are encrypted recursively with their parent.
- Locked pages show only **Locked page** in the sidebar and are excluded from Favorites, Recents, full-text search, and every MCP/AI listing, search, read, or write operation.
- Database free space is compacted after encryption to reduce recoverable plaintext remnants. New backups contain the encrypted database values.

## Unlocking and locking

Click a locked page and select **Unlock private pages**, or right-click it and choose **Unlock private pages…**. Unlocking applies to all private pages for the current Noteleaf session. Right-click an unlocked private page and choose **Lock private pages now** to clear the in-memory key immediately. Noteleaf also clears it when the application closes.

Choose **Remove encryption…** only when you intentionally want that page and its child pages stored as ordinary Noteleaf content again.

## Important limitations

- There is no password recovery. Keep the vault password in a trusted password manager.
- Existing backup archives created before a page was encrypted may still contain its former plaintext.
- Embedded images are not yet supported in encrypted pages. Noteleaf refuses to encrypt a page containing embedded images and refuses new image attachments on encrypted pages, preventing a false sense of protection.
- Notebook and section names are not encrypted. Linked external Markdown files cannot be encrypted because their source files remain outside Noteleaf.
- Encryption protects data at rest. Content is necessarily present in application memory while the vault is unlocked and visible on screen.

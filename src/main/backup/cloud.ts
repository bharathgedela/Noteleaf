import { app, safeStorage, shell } from 'electron';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupInfo, CloudBackupConnection, CloudBackupProvider } from '../../shared/types.js';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MICROSOFT_SCOPE = 'offline_access Files.ReadWrite.AppFolder';
const BACKUP_MIME = 'application/vnd.noteleaf.backup';
const BACKUP_PATTERN = /^(?:Noteleaf|Notes)-backup-.*\.notesbackup$/;

interface OAuthConfig { googleClientId: string; microsoftClientId: string }
interface StoredAccount { accessToken: string; refreshToken: string; expiresAt: number; folderId?: string }
type StoredAccounts = Partial<Record<CloudBackupProvider, StoredAccount>>;

function asMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function base64Url(value: Buffer): string { return value.toString('base64url'); }
function challenge(verifier: string): string { return base64Url(createHash('sha256').update(verifier).digest()); }

async function responseJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw new Error(`${context} failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return response.json() as Promise<T>;
}

async function loadConfig(): Promise<OAuthConfig> {
  let packaged: Partial<OAuthConfig> = {};
  try {
    const manifest = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8')) as { noteleafOAuth?: Partial<OAuthConfig> };
    packaged = manifest.noteleafOAuth || {};
  } catch { /* Environment variables remain available for development. */ }
  return {
    googleClientId: process.env.NOTELEAF_GOOGLE_CLIENT_ID || packaged.googleClientId || '',
    microsoftClientId: process.env.NOTELEAF_MICROSOFT_CLIENT_ID || packaged.microsoftClientId || '',
  };
}

async function receiveAuthorization(provider: CloudBackupProvider, authorize: (redirectUri: string, state: string) => string): Promise<{ code: string; redirectUri: string }> {
  const state = base64Url(randomBytes(24));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((request, response) => {
      const host = request.headers.host || '127.0.0.1';
      const url = new URL(request.url || '/', `http://${host}`);
      if (url.pathname !== '/oauth/callback') { response.writeHead(404).end(); return; }
      const finish = (error?: Error, code?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        response.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(`<html><body style="font:16px system-ui;padding:40px"><h2>${error ? 'Connection failed' : 'Noteleaf is connected'}</h2><p>${error ? 'Return to Noteleaf and try again.' : 'You can close this window and return to Noteleaf.'}</p></body></html>`);
        server.close();
        if (error) reject(error); else resolve({ code: code!, redirectUri: redirectUri! });
      };
      if (url.searchParams.get('state') !== state) { finish(new Error('The cloud sign-in response could not be verified.')); return; }
      const oauthError = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (oauthError || !code) { finish(new Error(oauthError || 'Cloud sign-in was cancelled.')); return; }
      finish(undefined, code);
    });
    let redirectUri = '';
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error('Cloud sign-in timed out. Please try again.'));
    }, 5 * 60 * 1000);
    server.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not start the secure sign-in callback.')); return; }
      const redirectHost = provider === 'onedrive' ? 'localhost' : '127.0.0.1';
      redirectUri = `http://${redirectHost}:${address.port}/oauth/callback`;
      try { await shell.openExternal(authorize(redirectUri, state)); }
      catch (error) { clearTimeout(timeout); server.close(); reject(error); }
    });
  });
}

export class CloudBackupStore {
  private readonly vaultPath: string;

  constructor(dataDirectory: string) { this.vaultPath = join(dataDirectory, 'cloud-backup-credentials.bin'); }

  private async accounts(): Promise<StoredAccounts> {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.');
      const encrypted = await readFile(this.vaultPath);
      return JSON.parse(safeStorage.decryptString(encrypted)) as StoredAccounts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async save(accounts: StoredAccounts): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.');
    await writeFile(this.vaultPath, safeStorage.encryptString(JSON.stringify(accounts)), { mode: 0o600 });
  }

  async connections(): Promise<CloudBackupConnection[]> {
    const [config, accounts] = await Promise.all([loadConfig(), this.accounts()]);
    return [
      { provider: 'google-drive', configured: Boolean(config.googleClientId), connected: Boolean(accounts['google-drive']?.refreshToken), detail: config.googleClientId ? null : 'Google OAuth client ID is not configured in this build.' },
      { provider: 'onedrive', configured: Boolean(config.microsoftClientId), connected: Boolean(accounts.onedrive?.refreshToken), detail: config.microsoftClientId ? null : 'Microsoft OAuth client ID is not configured in this build.' },
    ];
  }

  async connect(provider: CloudBackupProvider): Promise<void> {
    if (provider !== 'google-drive' && provider !== 'onedrive') throw new Error('Unsupported cloud backup provider.');
    const config = await loadConfig();
    const clientId = provider === 'google-drive' ? config.googleClientId : config.microsoftClientId;
    if (!clientId) throw new Error(`${provider === 'google-drive' ? 'Google' : 'Microsoft'} cloud backup is not configured in this build.`);
    const verifier = base64Url(randomBytes(48));
    const result = await receiveAuthorization(provider, (redirectUri, state) => {
      const url = new URL(provider === 'google-drive' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', provider === 'google-drive' ? GOOGLE_SCOPE : MICROSOFT_SCOPE);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', challenge(verifier));
      url.searchParams.set('code_challenge_method', 'S256');
      if (provider === 'google-drive') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); }
      return url.toString();
    });
    const form = new URLSearchParams({ client_id: clientId, code: result.code, redirect_uri: result.redirectUri, grant_type: 'authorization_code', code_verifier: verifier });
    const tokenUrl = provider === 'google-drive' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    if (provider === 'onedrive') form.set('scope', MICROSOFT_SCOPE);
    const token = await responseJson<{ access_token: string; refresh_token?: string; expires_in: number }>(await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), 'Cloud authorization');
    if (!token.refresh_token) throw new Error('The cloud provider did not return long-term access. Remove Noteleaf from connected apps and try again.');
    const accounts = await this.accounts();
    accounts[provider] = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 };
    await this.save(accounts);
    if (provider === 'google-drive') await this.googleFolder(await this.accessToken(provider));
    else await this.graph('/me/drive/special/approot', { method: 'GET' });
  }

  async disconnect(provider: CloudBackupProvider): Promise<void> {
    const accounts = await this.accounts();
    delete accounts[provider];
    if (Object.keys(accounts).length) await this.save(accounts); else await rm(this.vaultPath, { force: true });
  }

  private async accessToken(provider: CloudBackupProvider): Promise<string> {
    const accounts = await this.accounts();
    const account = accounts[provider];
    if (!account?.refreshToken) throw new Error(`${provider === 'google-drive' ? 'Google Drive' : 'OneDrive'} is not connected.`);
    if (account.accessToken && account.expiresAt > Date.now() + 60_000) return account.accessToken;
    const config = await loadConfig();
    const clientId = provider === 'google-drive' ? config.googleClientId : config.microsoftClientId;
    if (!clientId) throw new Error('Cloud backup is not configured in this build.');
    const scope = provider === 'google-drive' ? undefined : MICROSOFT_SCOPE;
    const form = new URLSearchParams({ client_id: clientId, refresh_token: account.refreshToken, grant_type: 'refresh_token' });
    if (scope) form.set('scope', scope);
    const tokenUrl = provider === 'google-drive' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const token = await responseJson<{ access_token: string; refresh_token?: string; expires_in: number }>(await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), 'Refreshing cloud access');
    accounts[provider] = { ...account, accessToken: token.access_token, refreshToken: token.refresh_token || account.refreshToken, expiresAt: Date.now() + token.expires_in * 1000 };
    await this.save(accounts);
    return token.access_token;
  }

  private async googleFolder(token: string): Promise<string> {
    const accounts = await this.accounts();
    const existing = accounts['google-drive']?.folderId;
    if (existing) return existing;
    const query = encodeURIComponent("trashed = false and appProperties has { key='noteleaf' and value='backup-folder' }");
    const listed = await responseJson<{ files: Array<{ id: string }> }>(await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } }), 'Finding the Noteleaf backup folder');
    let folderId = listed.files[0]?.id;
    if (!folderId) {
      const created = await responseJson<{ id: string }>(await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Noteleaf Backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { noteleaf: 'backup-folder' } }) }), 'Creating the Noteleaf backup folder');
      folderId = created.id;
    }
    const refreshed = await this.accounts();
    if (refreshed['google-drive']) { refreshed['google-drive'].folderId = folderId; await this.save(refreshed); }
    return folderId;
  }

  private async graph(path: string, init: RequestInit): Promise<Response> {
    const token = await this.accessToken('onedrive');
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    if (!response.ok) { const detail = (await response.text().catch(() => '')).slice(0, 500); throw new Error(`OneDrive request failed (${response.status})${detail ? `: ${detail}` : ''}`); }
    return response;
  }

  async list(provider: CloudBackupProvider): Promise<BackupInfo[]> {
    if (provider === 'google-drive') {
      const token = await this.accessToken(provider);
      const folder = await this.googleFolder(token);
      const q = encodeURIComponent(`'${folder}' in parents and trashed = false and appProperties has { key='noteleaf' and value='backup' }`);
      const result = await responseJson<{ files: Array<{ id: string; name: string; createdTime: string; size?: string }> }>(await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=createdTime%20desc&pageSize=100&fields=files(id,name,createdTime,size)`, { headers: { Authorization: `Bearer ${token}` } }), 'Listing Google Drive backups');
      return result.files.filter((file) => BACKUP_PATTERN.test(file.name)).map((file) => ({ path: `google-drive:${file.id}`, filename: file.name, createdAt: file.createdTime, size: Number(file.size) || 0 }));
    }
    const result = await responseJson<{ value: Array<{ id: string; name: string; size: number; createdDateTime: string; file?: unknown }> }>(await this.graph('/me/drive/special/approot/children?$select=id,name,size,createdDateTime,file&$top=100', { method: 'GET' }), 'Listing OneDrive backups');
    return result.value.filter((file) => file.file && BACKUP_PATTERN.test(file.name)).map((file) => ({ path: `onedrive:${file.id}`, filename: file.name, createdAt: file.createdDateTime, size: file.size }));
  }

  async upload(provider: CloudBackupProvider, source: string, filename: string): Promise<BackupInfo> {
    const metadata = await stat(source);
    if (provider === 'google-drive') {
      const token = await this.accessToken(provider);
      const folder = await this.googleFolder(token);
      const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,createdTime,size', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': BACKUP_MIME, 'X-Upload-Content-Length': String(metadata.size) }, body: JSON.stringify({ name: filename, parents: [folder], mimeType: BACKUP_MIME, appProperties: { noteleaf: 'backup' } }) });
      if (!start.ok || !start.headers.get('location')) throw new Error(`Starting Google Drive upload failed (${start.status}).`);
      const uploaded = await this.uploadChunks(start.headers.get('location')!, source, metadata.size, 8 * 1024 * 1024, token);
      const file = JSON.parse(uploaded) as { id: string; name?: string; createdTime?: string; size?: string };
      return { path: `google-drive:${file.id}`, filename: file.name || filename, createdAt: file.createdTime || new Date().toISOString(), size: Number(file.size) || metadata.size };
    }
    const session = await responseJson<{ uploadUrl: string }>(await this.graph(`/me/drive/special/approot:/${encodeURIComponent(filename)}:/createUploadSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name: filename } }) }), 'Starting OneDrive upload');
    const uploaded = await this.uploadChunks(session.uploadUrl, source, metadata.size, 10 * 1024 * 1024);
    const file = JSON.parse(uploaded) as { id: string; name?: string; createdDateTime?: string; size?: number };
    return { path: `onedrive:${file.id}`, filename: file.name || filename, createdAt: file.createdDateTime || new Date().toISOString(), size: file.size || metadata.size };
  }

  private async uploadChunks(url: string, source: string, size: number, chunkSize: number, bearer?: string): Promise<string> {
    const handle = await open(source, 'r');
    try {
      let offset = 0;
      let final = '';
      while (offset < size) {
        const length = Math.min(chunkSize, size - offset);
        const data = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(data, 0, length, offset);
        if (!bytesRead) throw new Error('Backup upload ended unexpectedly.');
        const end = offset + bytesRead - 1;
        const response = await fetch(url, { method: 'PUT', headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Length': String(bytesRead), 'Content-Range': `bytes ${offset}-${end}/${size}` }, body: data.subarray(0, bytesRead) });
        if (!(response.ok || response.status === 308)) throw new Error(`Uploading backup failed (${response.status}): ${(await response.text().catch(() => '')).slice(0, 300)}`);
        final = await response.text();
        offset = end + 1;
      }
      return final;
    } finally { await handle.close(); }
  }

  async download(reference: string, destination: string): Promise<void> {
    const separator = reference.indexOf(':');
    const provider = reference.slice(0, separator) as CloudBackupProvider;
    const id = reference.slice(separator + 1);
    if (!id || (provider !== 'google-drive' && provider !== 'onedrive')) throw new Error('Invalid cloud backup reference.');
    const response = provider === 'google-drive'
      ? await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${await this.accessToken(provider)}` } })
      : await this.graph(`/me/drive/items/${encodeURIComponent(id)}/content`, { method: 'GET', redirect: 'follow' });
    if (!response.ok) throw new Error(`Downloading cloud backup failed (${response.status}).`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  }

  async remove(reference: string): Promise<void> {
    const separator = reference.indexOf(':');
    const provider = reference.slice(0, separator) as CloudBackupProvider;
    const id = reference.slice(separator + 1);
    if (!id || (provider !== 'google-drive' && provider !== 'onedrive')) return;
    if (provider === 'google-drive') {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await this.accessToken(provider)}` } });
      if (!response.ok && response.status !== 404) throw new Error(`Removing old Google Drive backup failed (${response.status}).`);
    } else await this.graph(`/me/drive/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

export function cloudError(error: unknown): string { return asMessage(error); }

# Prizgram Production Deployment Runbook（LXC / SQLite）

Production の canonical deployment は、Tailscale 経由で LXC へ release を配置し、Next.js standalone server をユーザー systemd で起動する方式です。

- CD workflow: `.github/workflows/deploy-lxc.yml`
- release処理: `scripts/deploy/remote-release.sh`
- systemd unit: `deploy/prizgram-web.service`
- service名: `prizgram-web.service`

`pnpm --filter @prizgram/web start` や `/opt/prizgram` を前提とする構成は使用しません。

## 1. Canonical directory model

デプロイユーザーは `prizgram-deploy`、`DEPLOY_ROOT` は `/home/prizgram-deploy/prizgram` です。

```text
/home/prizgram-deploy/prizgram/
  ├─ releases/<commit-sha>/       # commitごとのsourceとbuild artifact
  ├─ current -> releases/<sha>/   # 稼働releaseへのsymlink
  └─ shared/
      ├─ .env                     # server-only secrets (0600)
      ├─ data/prizgram.sqlite     # SQLite本体とWAL sidecar
      ├─ backups/                 # deploy前backupと定期backup
      └─ cloudflared.token        # tunnelを使う場合のみ

/home/prizgram-deploy/.config/systemd/user/
  ├─ prizgram-web.service
  └─ cloudflared-prizgram.service # 任意
```

application serviceの各値は `deploy/prizgram-web.service` と一致させます。

| 項目             | canonical value                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------ |
| WorkingDirectory | `%h/prizgram/current/apps/web/.next/standalone/apps/web`                                   |
| ExecStart        | `%h/.local/node/bin/node %h/prizgram/current/apps/web/.next/standalone/apps/web/server.js` |
| EnvironmentFile  | `%h/prizgram/shared/.env`                                                                  |
| migrations       | `%h/prizgram/current/apps/web/.next/standalone/apps/web/.next/drizzle`                     |
| service          | user unit `prizgram-web.service`                                                           |

## 2. Initial provisioning

デプロイユーザーでNode.js 22とpnpm 10を配置します。root systemd unitやglobal pnpmは使用しません。

管理端末からbootstrap scriptを転送します。

```bash
scp scripts/deploy/bootstrap-user.sh prizgram-deploy@<tailscale-host>:/tmp/prizgram-bootstrap-user.sh
```

LXC上で実行します。

```bash
bash /tmp/prizgram-bootstrap-user.sh
sudo loginctl enable-linger prizgram-deploy
mkdir -p "$HOME/prizgram/shared/data" "$HOME/prizgram/shared/backups"
install -m 0600 /dev/null "$HOME/prizgram/shared/.env"
```

`bootstrap-user.sh` は次へ固定バージョンを配置します。

```text
~/.local/node/bin/node
~/.local/bin/pnpm
```

GitHub Environment `lxc-production` に以下を設定します。

- `TAILSCALE_AUTHKEY`
- `PRIZGRAM_DEPLOY_SSH_KEY`
- `PRIZGRAM_DEPLOY_KNOWN_HOSTS`

## 3. Production environment

`$HOME/prizgram/shared/.env` はデプロイ先だけに置き、repositoryへ追加しません。

```ini
DATABASE_URL=file:/home/prizgram-deploy/prizgram/shared/data/prizgram.sqlite
APP_ORIGIN=https://prizgram.kuraryu.jp
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=...
OPENAI_MODEL=...
OPENAI_TIMEOUT_MS=30000
CAREERJET_API_KEY=...
```

```bash
chmod 600 "$HOME/prizgram/shared/.env"
```

## 4. Release and activation flow

`main` のCI成功後、`.github/workflows/deploy-lxc.yml` が次を実行します。

1. TailscaleでLXCへ接続する。
2. sourceを `$DEPLOY_ROOT/releases/$DEPLOY_SHA` へ展開する。
3. 既存DBとWAL sidecarを `$DEPLOY_ROOT/shared/backups` へ退避する。
4. release内で依存関係をinstallし、migrationとbuildを実行する。
5. standalone配下へmigration、static、public assetsを配置する。
6. `deploy/prizgram-web.service` を user unit directoryへinstallする。
7. `current` symlinkを新releaseへ切り替える。
8. `systemctl --user restart prizgram-web.service` を実行する。
9. `http://127.0.0.1:3000/api/health` が成功するまで確認する。

standalone serviceはNode.jsで `server.js` を直接起動します。稼働時にpnpm CLIやworkspace sourceを参照しません。

手動で同じrelease処理を再実行する場合:

```bash
export DEPLOY_ROOT="$HOME/prizgram"
export DEPLOY_SHA=<40-character-commit-sha>
bash "$DEPLOY_ROOT/releases/$DEPLOY_SHA/scripts/deploy/remote-release.sh"
```

## 5. Health and service inspection

```bash
systemctl --user status prizgram-web.service
journalctl --user-unit prizgram-web.service --since "30 minutes ago"
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

`/api/health` はmigration journal一致とforeign key整合を確認します。

## 6. Migration and backup

Migrationは `remote-release.sh` が新releaseのactivation前に単一プロセスで実行します。既存migrationを編集せず、前方互換なmigrationを追加してください。

定期backupはshared DBとshared backup directoryを明示します。

```bash
"$HOME/prizgram/current/scripts/backup-db.sh" \
  "$HOME/prizgram/shared/data/prizgram.sqlite" \
  "$HOME/prizgram/shared/backups" \
  14
```

cron例（毎日03:20）:

```cron
20 3 * * * /home/prizgram-deploy/prizgram/current/scripts/backup-db.sh /home/prizgram-deploy/prizgram/shared/data/prizgram.sqlite /home/prizgram-deploy/prizgram/shared/backups 14
```

月1回のrestore drill:

```bash
"$HOME/prizgram/current/scripts/restore-drill.sh" \
  "$HOME/prizgram/shared/backups"
```

## 7. Rollback

Health checkが失敗した場合は、DBをすぐに復元せず、まず直前のreleaseへ戻します。

```bash
ls -1dt "$HOME/prizgram/releases/"*
ln -sfn "$HOME/prizgram/releases/<previous-sha>" "$HOME/prizgram/current"
systemctl --user restart prizgram-web.service
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

Migrationは前方互換を前提とします。DB破損が疑われる場合だけserviceを停止し、restore drillでbackupを検証してから復元判断を行います。

## 8. Reminder batch

Reminder batchはrelease sourceとpnpmを必要とするため、standalone web serviceとは別プロセスとして実行します。

```cron
*/15 * * * * flock -n /tmp/prizgram-reminders.lock /home/prizgram-deploy/.local/bin/pnpm --dir /home/prizgram-deploy/prizgram/current --filter @prizgram/web reminders:cron
```

失敗時は非0終了をjournaldまたは監視基盤で検知します。

## 9. Cloudflare Tunnel / TLS requirements

本番のcanonical edgeはCloudflare Tunnelです。Tunnel側でTLSを終端し、LXC上のweb serviceへloopback接続します。

- auth rate limitのclient source keyには、Cloudflareが上書きする `CF-Connecting-IP` だけを使う。
- `deploy/prizgram-web.service` は `HOSTNAME=127.0.0.1` とし、web serviceをloopbackにだけbindする。
- LXCのport 3000を外部へ公開しない。Tunnel以外から任意のforwarded headerを送れる経路を作らない。
- Tunnel tokenは `shared/cloudflared.token` に置き、リポジトリやworkflowへ書かない。
- Cloudflare側でTLS、Host制御、必要なアクセス制御を有効にする。

## 10. Incident checklist

1. `systemctl --user status prizgram-web.service` を確認する。
2. `journalctl --user-unit prizgram-web.service` でrequest bodyやsecretを出さずに原因を確認する。
3. health check失敗なら直前releaseへrollbackする。
4. DB破損疑いなら書き込みを止め、shared backupのrestore drillを実行する。

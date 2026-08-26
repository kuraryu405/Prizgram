# Prizgram 運用 Runbook（EC2 / SQLite）

MVPをEC2相当の単一ホストで安全に運用するための手順です。対象: Node 22、pnpm 10、SQLite(WAL)。

## 1. プロビジョニング

- Amazon Linux 2023 / Ubuntu 22.04 以上のEC2インスタンス
- ボリュームはアプリとDBで同一EBS（スナップショット対象を1つに集約）
- セキュリティグループ: 80/443 のみ公開。SSHはSSM Session Manager経由

```bash
# Node 22 (nvm例)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && nvm alias default 22
corepack enable pnpm   # package.jsonのpackageManagerに追従
```

## 2. デプロイ構成

```text
/opt/prizgram/            # アプリ一式 (git clone or rsync)
  ├─ .env                 # server-only secrets (root:600)
  ├─ data/prizgram.sqlite # SQLite本体 (WAL有効)
/var/backups/prizgram/    # sqlite3 .backup 出力先
/etc/systemd/system/prizgram.service
```

`.env`（root所有・600パーミッション）。秘密はrepoに置かない:

```ini
DATABASE_URL=file:/opt/prizgram/data/prizgram.sqlite
APP_ORIGIN=https://<your-domain>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=...        # server-only
OPENAI_MODEL=...
CAREERJET_API_KEY=...     # server-only / 求人探索（https://www.careerjet.com/partners/api）
# CAREERJET_LOCALE_CODE=ja_JP
# rate limit既定値は .env.example 参照
```

## 3. systemd

```ini
# /etc/systemd/system/prizgram.service
[Unit]
Description=Prizgram web
After=network-online.target

[Service]
User=prizgram
WorkingDirectory=/opt/prizgram/apps/web
EnvironmentFile=/opt/prizgram/.env
ExecStart=/usr/bin/env pnpm --filter @prizgram/web start
Restart=on-failure
RestartSec=3
# SQLiteは単一writer前提。複数インスタンスにしないこと
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/prizgram/data

[Install]
WantedBy=multi-user.target
```

ビルドと起動:

```bash
cd /opt/prizgram
pnpm install --frozen-lockfile
pnpm build
sudo systemctl daemon-reload && sudo systemctl enable --now prizgram
curl -fsS http://127.0.0.1:3000/api/health   # 200 ok を確認
```

## 4. migration手順（バックアップ → migrate → health）

```bash
set -euo pipefail
sudo -u prizgram bash -c 'cd /opt/prizgram && git pull --ff-only'
/opt/prizgram/scripts/backup-db.sh                     # 1) 必ず先行backup
pnpm db:migrate                                        # 2) 単一プロセスで適用
systemctl restart prizgram                             # 3) 新codeへ切替
sleep 2
curl -fsS http://127.0.0.1:3000/api/health             # 4) 非200なら即rollback
```

`/api/health` はmigration journal一致とFK整合を見る。非200時は**旧artifactへ戻す**（DBはbackup復元ではなく原則そのまま。drizzle互換の前方のみmigrationのため）。

## 5. バックアップ / リストア drill

```bash
# 毎日 03:20JST に論理backup（cron）
20 3 * * * /opt/prizgram/scripts/backup-db.sh
```

- `scripts/backup-db.sh`: `sqlite3 .backup` + gzip + 14世代保持
- `scripts/restore-drill.sh`: 最新backupを一時DBへ展開し `integrity_check` とテーブル件数を出力。**月1回は必ず実行して復元可能性を検証**

## 6. リマインダー cron

```bash
# 15分おき（排他はflock、ログはjournald）
*/15 * * * * prizgram flock -n /tmp/prizgram-reminders.lock \
  pnpm --filter @prizgram/web reminders:cron >>/var/log/prizgram/reminders.log 2>&1
```

失敗時は非0終了するため、`flock` + ログ監視（CloudWatch Agent等）で通知を設定。

## 7. reverse proxy / TLS 最小checklist (nginx例)

```nginx
server {
  listen 443 ssl http2;
  server_name <your-domain>;
  ssl_certificate     /etc/letsencrypt/live/<domain>/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;

  # security headers
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # 上書き前提(信頼proxy運用)
    proxy_set_header X-Forwarded-Proto https;
  }
}
server { listen 80; return 301 https://$host$request_uri; }
```

- **X-Forwarded-Forはこのproxyが必ず上書き**すること（auth rate limitのsource keyが信頼できること）
- 証明書更新: certbot timer有効化

## 8. PII最小化方針

- ログにpassword/session token/Authorization/request bodyを出さない（API層で実装済み）
- DBには求人・応募・回答など業務データのみ。不要になったユーザーデータは `users` 行削除でカスケード消去
- backupファイルは `/var/backups/prizgram` 配下 root:600

## 9. 障害時フロー

1. `systemctl status prizgram` / journald確認
2. `/api/health` 非200 → 直近deploy差分をrollback、DBは触らない
3. DB破損疑い → 書込停止 → `restore-drill.sh` で最新backup検証 → 入れ替え

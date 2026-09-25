# DocsGraph

このプロジェクトは、フロントエンド(React/Vite)とバックエンド(Node.js/Express)で構成されたアプリケーションです。
バックエンドのデータストアとして Gremlin Server と OpenSearch を使用しています。

## 前提条件

- [Node.js](https://nodejs.org/)
- [Docker](https://www.docker.com/) および Docker Compose

## 開発環境の起動手順

### 1. データストアの起動

プロジェクトルート（`DocsGraph`ディレクトリ）で Docker Compose を使用して、必要なデータベース・サービスをバックグラウンドで起動します。

```bash
docker compose up -d
```

起動される主なサービス:
- **Gremlin Server**: `localhost:8182`
- **Gremlin Visualizer**: `localhost:3000`
- **OpenSearch**: `localhost:9200`

### 2. 依存パッケージのインストール

プロジェクトルートで以下のコマンドを実行し、フロントエンドとバックエンド両方の依存関係を一括でインストールします。

```bash
npm run install:all
```
*(内部的に `backend` と `frontend` それぞれのディレクトリで `npm install` が実行されます)*

### 3. バックエンドの起動

新しいターミナルを開き、バックエンドを開発モードで起動します。
ソースコードを変更すると自動的に再起動します。

```bash
cd backend
npm run dev
```

### 4. フロントエンドの起動

さらに別のターミナルを開き、フロントエンドの開発サーバーを起動します。

```bash
cd frontend
npm run dev
```
起動後、コンソールに表示されるローカルURL（例: `http://localhost:5173`）にブラウザでアクセスして確認してください。

---

## 環境の停止方法

開発を終了する際は、フロントエンドとバックエンドを起動したそれぞれのターミナルで `Ctrl + C` を押してプロセスを停止します。

Dockerコンテナを停止・削除する場合は、プロジェクトルートで以下のコマンドを実行します。

```bash
docker compose down
```

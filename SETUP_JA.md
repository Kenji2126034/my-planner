# My Planner — 公開用パッケージ（個人予定を含まない版）

このZIPのルートにある `index.html`, `sync.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png` がGitHub Pages公開に必要なファイルです。**個人の予定はこのパッケージに入っていません。** 公開後、旧アプリのJSONバックアップを使って引き継ぎます。公開サイトのURLは誰でもアクセス可能ですが、Googleスプレッドシートの内容自体は公開しないでください。

## 0. 最重要：古いアプリの予定をバックアップ

1. 現在使っている旧 `MyPlanner_Standalone.html` または v2 を開く。
2. 右上の「設定」→ 「データのバックアップ」→ 「JSON」で保存。
3. **バックアップのJSONはGitHubへアップロードしない。** 自分のPCや私的なフォルダに保存。
4. 後で公開アプリを初めて開いたら「設定」→「バックアップを読み込む」からこのJSONを取り込む。

## 1. GitHub Pagesに無料で公開

1. https://github.com/new を開き、Repository nameを `my-planner`、Public（公開）にして作成。
2. 新しいリポジトリの「Add file」→「Upload files」。ZIPを**解凍**し、この中の6ファイル（index.html, sync.js, sw.js, manifest.webmanifest, icon-192.png, icon-512.png）を**ルート**にアップロード。ZIPのままアップロードしない。
3. Commit changesをクリック。
4. Repository の Settings → Pages → Build and deployment の Source を `Deploy from a branch` → `main` / `(root)` → Save。
5. `https://あなたのGitHubユーザー名.github.io/my-planner/` を開き、UIが表示されることを確認。

注意：GitHub FreeではPagesのためリポジトリはPublicです。コードも公開されるため、データ・アカウント情報・JSON・認証情報をアップロードしないでください。アプリ上の予定データはブラウザ内/ログイン済みGoogle Sheetに保管します。

## 2. Google CloudでOAuth設定

1. https://console.cloud.google.com/ にGoogleアカウントでログイン。新しいプロジェクトを作成（例: My Planner Personal）。
2. [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) を有効化。
3. [Google Auth Platform](https://console.cloud.google.com/auth/overview) で、Branding、Audience、Data Accessを構成。Audienceは個人用の適切な設定（Personalが利用できる場合はPersonal、なければExternalで自分をテストユーザーに登録）。OAuthの利用条件・再認証条件は画面の案内を確認。
4. Data Accessのスコープは `https://www.googleapis.com/auth/spreadsheets` を使用します。**これはGoogle Sheets全体に対する読み書き権限です**。既存のシートをアプリから編集するために必要ですが、権限が広い点に注意してください。自分のPC・スマホだけで使い、公開コードにアクセストークンや秘密鍵を入れないでください。
5. ClientsでOAuth 2.0 クライアントを **ウェブアプリケーション** として作成。Authorized JavaScript origins（承認済みJavaScript生成元）に `https://あなたのGitHubユーザー名.github.io` を登録（末尾の `/my-planner/` は含まない）。
6. Client ID（末尾が `.apps.googleusercontent.com`）をコピー。**Client Secretはアプリに入力しない。**

## 3. My Plannerに接続して、ChatGPT側で用意した保存先を指定

1. 公開アプリを開き、バックアップを取り込んで既存の予定が表示されることを確認。
2. 「Google同期を設定」→「Google OAuth 2.0 クライアントID」に先ほどのIDを貼り付ける。
3. 「設定を保存」→「Googleに接続」。必要な権限をGoogleアカウントで許可。
4. 保存先スプレッドシートIDに、あらかじめ用意した `1wrqd3Ell1NUhn3-o4SFh5unFJ-Zjy10gMp6V3sf3hck` を入力し「設定を保存」。**「保存用シートを新規作成」は選ばない**。
5. 「クラウドから読み込む」を選ぶ。最初はクラウド側にデータがあるため、競合の表示が出る可能性があります。ローカルの予定はJSONバックアップを取ってから読み込んでください。
6. 既存のローカル予定も残したい場合は、JSONバックアップの「統合」で重複を確認してください。
7. 保存先シートの共有設定は**非公開**にする。クラウド同期済みと表示されることを確認。

**重要**：今回はChatGPTからも同じシートに追記できるよう、既存のGoogleシートを利用します。初回同期時はまず「クラウドから読み込む」を使用し、ローカル側の未保存変更を上書きしないよう注意してください。

## 4. スマホでも同じ予定を開く

1. スマホで公開URLを開く（HTTPS）。
2. 同じOAuth Client IDと保存先スプレッドシートIDを入力してGoogleに接続。
3. 初回は「クラウドから読み込む」を選び、PCの予定を取得。
4. ブラウザのホーム画面に追加するとアプリのように利用できます。

## 5. ChatGPTから予定を更新

1. このガイドに掲載した保存先シートをChatGPTから更新します。「My Plannerの `PlannerData` に予定を追加して」と指示できます。
2. `Kind=item`、`ID` 一意、`Title` 必須、`Type=task/event`、`Date=YYYY-MM-DD`、`Time=HH:mm`、`Category`、`Priority=high/normal/low`、`Important=TRUE/FALSE`、`Completed=TRUE/FALSE` を列見出しに沿って使う。
3. アプリに戻って「最新状態を同期」を実行すると、ChatGPTがシートへ実際に書き込めた予定が表示されます。
4. アプリが保存中・競合状態のときにChatGPT側で同時編集しないようにする。更新前にバックアップを保存。

自動監視ではありません。「予定に追加して」と明示してChatGPT側で実際に更新処理が成功したときに反映されます。

## 6. 料金と注意点

- OpenAI API・独自MCPサーバー・独自データベース・常時稼働の個人サーバーは不使用。
- GitHub Freeの公開リポジトリPagesは無料で利用可能（将来も必ず無料とは保証できません）。
- Google CloudのOAuthとSheets APIは通常の個人利用で無料範囲を想定。実際の使用量制限や提供条件を確認してください。OAuthのテスト公開状態では権限や再認証に制約が生じる場合があります。
- Googleログインの有効期限が切れたら「Googleに接続」で再ログインが必要です。
- ブラウザの保存データが消える可能性があるため、定期的にJSONバックアップしてください。
- Googleカレンダーとの同期は一切ありません。アプリ自体がTo Do＋カレンダーを提供します。

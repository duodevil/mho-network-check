# MHO Network Check — 部署步驟

順序：**先後端（Google），再前端（GitHub Pages）**。

## A. 後端：試算表與 Apps Script（只做一次）

1. **建立試算表。** 在 Google 雲端硬碟新增一份試算表，命名「MHO Network Check」。網址中 `/d/` 與 `/edit` 之間那一段就是 ID，填進 `apps-script.js` 最上方的 `SHEET_ID`。
2. **建立截圖資料夾。** 在雲端硬碟新增資料夾「MHO Network Check Screenshots」。網址最後一段是 ID，填進 `DRIVE_FOLDER_ID`。
3. **分享給服務帳號。** 試算表右上角「共用」→ 加入 `claude-sheet@steve-lab-499006.iam.gserviceaccount.com`，權限「編輯者」。之後 Claude 就能直接讀資料做驗證。
4. **貼上程式。** 試算表選單「擴充功能」→「Apps Script」→ 刪掉預設內容，貼上整份 `apps-script.js`（已經填好兩個 ID）→ 儲存。
5. **初始化。** 上方函式下拉選單選 `setup` →「執行」→ 依畫面完成授權。完成後，試算表會出現 `IP_Region`、`APAC`、`KR`、`LATAM`、`MEA`、`Other` 六個分頁。
6. **部署。** 右上角「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」→ 執行身分「我」→ 誰可以存取「任何人」→「部署」→ 複製網址（`https://script.google.com/macros/s/…/exec`），交給 Claude 填進 `index.html` 的 `CONFIG.appsScriptUrl`。

## B. 伺服器清單：`IP_Region` 分頁

| Region | Server Name | IP | Country Codes |
|---|---|---|---|
| APAC／KR／LATAM／MEA 擇一 | 玩家看得到的名稱，例 `Singapore` | 測試用 IP | ISO 兩碼國碼，逗號分隔；`*` 代表其他所有國家 |

- 同一個國碼可以出現在多列，玩家會拿到所有符合的伺服器。回報寫入**由上而下第一個**符合列的 Region 分頁。
- `*` 列給沒有比對到任何國家的玩家使用，這些回報寫入 `Other`。
- 國碼必須是 ISO 3166-1 alpha-2（例：KR、MX、BR）；國碼欄留空的列永遠比對不到。
- 填入的 IP 要先開好防火牆規則，放行 ICMP 與 traceroute。
- 改這個分頁**不需要重新部署**，前端立即生效。

## C. 前端：GitHub Pages

1. 在 GitHub 建立空的 repo `duodevil/mho-network-check`（Public，不要勾選 README）。
2. Settings → Pages → Source 選「Deploy from a branch」→ Branch `main`／`/ (root)` → Save。
3. Claude 推送：

```bash
git remote add origin git@github.com:duodevil/mho-network-check.git
git push -u origin main
```

4. 約 1 分鐘後生效。驗證線上與本機一致：

```bash
curl -sL https://duodevil.github.io/mho-network-check/ -o /tmp/mho-live.html
diff -q /tmp/mho-live.html index.html && echo "線上 = 本地"
```

## D. 之後更新 Apps Script（⚠️ 最容易出錯）

「部署」→「管理部署作業」→ 鉛筆圖示 → 版本選「新版本」→「部署」。

**絕對不要再按「新增部署作業」**：那會產生新的網址，前端送出的資料會全部送到舊網址而消失。

## E. 本機測試

```bash
node tests/run.js                                    # 單元測試
python3 -m http.server 8765                          # 另開一個終端機
node tests/browser-smoke.js                          # headless Chrome 實測，約 40 秒
node tests/browser-smoke.js http://localhost:8765/ ar /tmp/ar.png   # 切阿拉伯文並截圖
```

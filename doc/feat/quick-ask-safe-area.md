# 追问气泡贴选区右下角 + 悬浮窗避让原生浮条（quick-ask-safe-area）

## 问题

平板上用微信内置浏览器打开时，划词追问的悬浮窗**输入框被遮挡**，导致无法输入问题。

截图为证：悬浮窗底部的 `针对这段内容提问…（Enter 发送）` 输入框，正好被一条横贯屏幕的「AI 帮写」浮条压住。

| 现象 | 根因 |
|---|---|
| 输入框被横条盖住 | 微信/QQ 内置浏览器的「AI 帮写」浮条是**浏览器原生 UI**，绘制在 WebView 合成层之上。页面里 `z-index` 再高、`position: fixed`、portal 都盖不住它 |
| 浮条常驻不消失 | 用户反馈「一直存在」，不是选中后的短暂提示 |
| 为什么 CodeReader 没这问题 | 它的提问面板用 `top: max(70, innerHeight*0.16)` 贴视口中上部，输入框始终远离屏幕底部，从不和浮条抢位置 |

原实现的两处设计正好把窗口推向底部：

```ts
// 1. 气泡居中 + 向上偏移，贴选区正上方
className="... -translate-x-1/2 -translate-y-full ..."
style={{ top: anchor.top - 6, left: anchor.left }}

// 2. 展开窗紧跟选区，且用固定高度 460
const h = 460
const y = clamp(initialRect.top + 12 + offset, 8, vh - h - 8)
```

选中文本靠近屏幕下方时，`y` 被 `vh - 460 - 8` 夹住，窗口底边紧贴视口下缘 —— 浮条就在那里。

## 目标

1. 划词气泡摆在**选区右下方**（与用户阅读方向一致，且远离底部浮条）。
2. 展开的悬浮窗**不贴视口底边**，输入框始终可见。
3. 拖动、缩放都不能把窗口重新塞回浮条下面。
4. 桌面端行为不发生可用性退化。

## 规范

### 一、底部安全区

```ts
function bottomSafeArea(): number
```

| UA | 返回值 | 依据 |
|---|---|---|
| 微信 / QQ 内置浏览器（含 X5、XWeb） | 96px | 「AI 帮写」浮条常驻屏幕底部 |
| iPad / iPhone / iPod | 24px | 底部 Home 指示条 |
| 其他 | 12px | 常规留白，与改造前行为接近 |

识别正则：`/MicroMessenger|\bQQ\/|QQBrowser|XWEB\//i`。

### 二、气泡锚点

| 维度 | 规则 |
|---|---|
| 水平 | `clamp(选区右边缘 + 6, 8, vw - BUBBLE_W - 8)` |
| 垂直 | 默认 `选区下边缘 + 6`；若 `下边缘 + 6 + 32 > vh - safe`，翻到选区上方 `rect.top - 32` |

`BUBBLE_W = 220` 为估算宽度（实测渲染约 178px），靠右时保守左移，避免溢出。

同时移除 `-translate-x-1/2 -translate-y-full`，改用绝对 `top`/`left` —— 原先 translate 与 `top - 6` 叠加，定位意图不直观。

### 三、展开窗初始位置

| 维度 | 改前 | 改后 |
|---|---|---|
| 高度 | 固定 `460` | `min(460, max(MIN_H, vh - safe - 24))` |
| 纵向 | `clamp(rect.top + 12, 8, vh - h - 8)` 紧跟选区 | `clamp(max(vh*0.16, rect.top+12), 8, vh - safe - h)` 贴上部 16% |

贴上部 16% 是 CodeReader 的取值，让输入框永远停在中上区。

### 四、拖动与缩放边界

| 交互 | 改前上限 | 改后上限 |
|---|---|---|
| 拖动 `y` | `vh - 40` | `vh - safe - 40` |
| 缩放高度 | `vh - frame.y - 8` | `vh - safe - frame.y` |

## 验证方法

Playwright 注入微信 UA（`MicroMessenger/8.0.42`）与普通 UA，分别在 1920×900、1920×720 下：

1. 选中正文文本触发气泡；
2. 断言 `bubble.left >= rect.right` 且 `bubble.top >= rect.bottom`（右下角）；
3. 点「追问」展开，断言 `innerHeight - window.bottom >= 90`；
4. 边界用例：选区贴视口右下时，气泡翻到上方且不溢出右侧；
5. 回归 `scripts/test-quick-ask.cjs` 全量 12 例。

## 已知限制

- 安全区是**固定估算值**。不同微信版本浮条高度可能不同，若真机仍被压住，需要按实际 UA 与浮条高度微调 `bottomSafeArea()`。
- 该方案是「避让」而非「覆盖」：原生 UI 在 WebView 之上，CSS 无法干预。
- `BUBBLE_W` 为估算值，按钮文案变长时需同步调整。

## 实现与校验结果

### 落地清单

| 位置 | 改动 |
|---|---|
| `bottomSafeArea()` | 新增：微信/QQ 96px、iOS 24px、其他 12px |
| 气泡锚点 `useLayoutEffect` | 选区右边缘 +6 / 下边缘 +6；贴底时翻到上方 |
| 气泡 className | 去掉 `-translate-x-1/2 -translate-y-full`，改用绝对 `top`/`left` |
| 展开窗初始位置 | 高度 `min(460, max(MIN_H, vh-safe-24))`；`y = max(vh*0.16, rect.top+12)` |
| `onHeaderPointerMove` | 拖动上限 `vh - safe - 40` |
| `onResizeMove` | 缩放上限 `vh - safe - frame.y` |

### 实测对照

| 场景 | 修复前底部余量 | 修复后底部余量 |
|---|---|---|
| 微信 UA 1920×900 | — | 209px |
| 微信 UA 1920×720 | **31px（被浮条压住）** | 96px |
| 普通桌面 1920×900 | — | 209px |

气泡位置：修复前 `bubble.x=700 < sel.right=817`（居中，盖住选区右侧）；
修复后 `bubble.x >= sel.right` 恒成立（右下方）。

### 踩到的坑

1. **浏览器原生 UI 在 WebView 之上**
   微信「AI 帮写」浮条不是 DOM，`z-index`、`position: fixed`、portal 全部无效。
   唯一可靠对策是避让，而不是覆盖。这一点值得写进任何面向移动端 WebView 的设计准则。
2. **固定高度 + 紧跟选区，两个设计叠加把窗口推向底部**
   `h=460` 固定 + `y=clamp(rect.top+12, 8, vh-h-8)` 跟随，在大视口选中靠下文本时
   `y` 被夹到 `vh-468`，底边贴住视口下缘。两处都要按可用高度自适应。

### 测试有效性验证

把实现 stash 掉（只保留测试）重跑：**5/9 通过**，失败项正是 `bubble.x < sel.right`
与 `1920x720 底部余量 31px`。恢复实现后 **9/9 通过** —— 说明测试确实守住了这个 bug，
而非空转。

### 已知限制

- 安全区是固定估算值（96px）。不同微信版本/机型浮条高度可能不同；浮条不改变
  `visualViewport`，无法自动测量，只能按真机实测微调。
- `BUBBLE_W = 220` 为估算宽度（实测渲染 178px），按钮文案变长时需同步调整。

### 验证

```bash
npm run build
npx vite preview --port 5199 &
APP_URL=http://127.0.0.1:5199/ node scripts/test-quick-ask-safe-area.cjs   # 9/9
APP_URL=http://127.0.0.1:5199/ node scripts/test-quick-ask.cjs             # 12/12
```

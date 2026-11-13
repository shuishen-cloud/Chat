# 思考模式开关改用 Base UI Switch 原语（switch-primitive）

## 问题

设置弹窗里「思考模式」的开关**关闭态几乎不可辨识**，开启态滑块越出轨道右边界。

截图为证：红框内的开关呈一团纯黑色胶囊状，看不出轨道与滑块的边界。

| 现象 | 根因 |
|---|---|
| 关闭态看不到滑块、看不出轨道 | 轨道 `bg-muted`（oklch 0.97）、滑块 `bg-background`（纯白），浅色主题白卡片上两者几乎同色，对比度不足 |
| 开启态滑块贴边溢出 | 轨道 `w-9`(36px)、滑块 `size-4`(16px)，`translate-x-4.5` = 18px，加初始 `0.5`(2px) 使滑块右缘落到 36px，正好顶出轨道 |
| 键盘用户无焦点反馈 | 手写 `button` 未写 `focus-visible` 样式 |
| 无法禁用 | 未处理 `disabled`，保存进行中无法阻止交互 |
| 无原生表单语义 | 手写 `role="switch"` 只有 ARIA，没有隐藏 `<input>` |

原实现（提交 `e920562`）：

```tsx
<button
  type="button"
  role="switch"
  aria-checked={thinking}
  onClick={() => setThinking((v) => !v)}
  className={cn(
    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
    thinking ? "bg-primary" : "bg-muted"
  )}
>
  <span
    className={cn(
      "absolute top-0.5 size-4 rounded-full bg-background transition-transform",
      thinking ? "translate-x-4.5" : "translate-x-0.5"
    )}
  />
</button>
```

**为什么当初手写**：`src/components/ui/` 只有 14 个组件，**从未封装过 switch**。
shadcn 是组件按需 `add` 的，不是装了就全套都有。当时「目录里没有 → 手写一个」
而不是「查底座有没有 → 补一层封装」，于是缺口被埋下。

## 目标

1. 关闭态轨道与滑块都有清晰边界，浅色/暗色主题下皆可辨识。
2. 滑块在两种状态下都完整落在轨道内，不溢出。
3. 补齐焦点环、禁用态、原生表单语义。
4. 点击「思考模式」文字也能切换（增大点击热区）。
5. 不影响 `thinkingEnabled` 的存储与请求行为。

## 规范

### 一、新增 `src/components/ui/switch.tsx`

薄封装 `@base-ui/react/switch` 的 `Root` + `Thumb`，不持有自有状态。

| 部件 | 类名要点 |
|---|---|
| Root | `h-5 w-9 rounded-full`；`bg-input` → `data-[checked]:bg-primary` |
| Root 焦点 | `focus-visible:ring-ring/50 focus-visible:ring-[3px]` |
| Root 禁用 | `disabled:cursor-not-allowed disabled:opacity-50` |
| Thumb | `size-4 rounded-full bg-background shadow-xs` |
| Thumb 位移 | `translate-x-0.5` → `data-[checked]:translate-x-4` |
| Thumb 暗色 | `dark:data-[checked]:bg-primary-foreground` |

位移校验：轨道内宽 `36 - 2*2(左右各 2px 基数) = 32`，滑块 16，
`translate-x-4`(16px) + `0.5`(2px) = 18px，滑块右缘 34px < 36px，不溢出。

属性名依据 `@base-ui/react/switch/root/SwitchRootDataAttributes.js`：
选中态暴露为 `data-checked`（非 `data-[state=checked]`）。

### 二、改造 `settings-dialog.tsx`

```tsx
<Label htmlFor="thinking-mode" className="text-sm">思考模式</Label>
<Switch
  id="thinking-mode"
  className="mt-0.5"
  checked={thinking}
  onCheckedChange={setThinking}
/>
```

- Base UI 会自动派生 `aria-labelledby`，`Label` 的 `htmlFor` 因此生效，文字可点击。
- `mt-0.5` 让开关与标题首行基线对齐（外层是 `items-start`）。
- 移除不再使用的 `cn` 导入。

## 验证方法

Playwright 打开设置弹窗：

1. 断言 `[data-slot="switch"]` 数量为 1；
2. 点击开关本体，`aria-checked` 翻转为 `false`；
3. 点击「思考模式」文字，`aria-checked` 翻转为 `true`；
4. 分别对开启/关闭两态截图，人工确认轨道与滑块边界清晰、滑块不溢出。

```bash
npx vite --port 5199 &
node scripts/test-switch-primitive.cjs
```

## 已知限制

- 关闭态轨道沿用主题变量 `--input`（oklch 0.922），在极高亮度屏上对比仍偏柔；
  若后续觉得不够，可换 `bg-muted-foreground/30`，但那会偏离 shadcn 默认值。
- 本组件目前仅供设置弹窗使用，未覆盖 `size` 变体；若画板等其他位置需要
  大号开关，再补 `size` prop。
- 暗色主题下 `--primary` 变为近白，因此开启态是「浅轨道 + 深滑块」，与浅色主题
  的「深轨道 + 白滑块」方向相反。这与 shadcn 官方 Switch 行为一致（暗色下开关
  用亮色表达「开」），故保持不变；若团队希望两主题同向，需加 `dark:` 覆盖轨道色。

## 实现与校验结果

### 落地清单

| 位置 | 改动 |
|---|---|
| `src/components/ui/switch.tsx` | 新增：封装 Base UI `Switch.Root` / `Switch.Thumb` |
| `src/components/settings-dialog.tsx` | 手写 `button`+`span` → `<Switch>`；补 `htmlFor`/`id`；移除 `cn` |

### 实测对照

| 状态 | 修复前 | 修复后 |
|---|---|---|
| 关闭 | 轨道与滑块同色，一片白，仅剩黑色轮廓 | 灰色轨道 `bg-input` + 白色滑块，边界清晰 |
| 开启 | 滑块 18px 位移，右缘顶出 36px 轨道 | 深色轨道 `bg-primary` + 白色滑块，完整内嵌 |
| 暗色开启 | 同手写缺陷 | 浅轨道 `primary` + 深滑块 `primary-foreground`，可辨 |

滑块越界的精确读数（Playwright `getBoundingClientRect`）：

| 版本 | 轨道区间 | 滑块区间 | 结论 |
|---|---|---|---|
| 修复前 | `[902.8, 937.4]` | `[937.4, 952.8]` | 滑块完全跑到轨道右侧**之外** |
| 修复后 | `[905.6, 940.9]` | 内嵌 | 两态均在轨道内 |

DOM 断言（Playwright 读取 `outerHTML`）确认：
`role="switch"`、`aria-checked="true"`、`data-checked=""`、
`aria-labelledby="thinking-mode-label"` 均正确生成。

### 踩到的坑

1. **底座有原语，但没人去查**
   `@base-ui/react` 实际导出 60+ 个组件（switch / slider / progress / tabs /
   tooltip …），项目只用了零头。缺组件时的正确顺序是
   `ls node_modules/@base-ui/react/` → 补 shadcn 风格薄封装，而不是直接手写。
   手写会漏掉焦点环、禁用态、隐藏 input、暗色适配这一整套。
2. **Tailwind 任意值让越界不易察觉**
   `translate-x-4.5` 在 v4 下合法（4.5 × 0.25rem = 18px），但不报错也不警告，
   视觉上只是滑块贴边——直到有人截图才暴露。位移量应当对着轨道/滑块尺寸手算。
3. **Base UI 的选中态属性是 `data-checked`，不是 `data-[state=checked]`**
   与 Radix 版本不同，直接套 shadcn 旧模板会整段样式失效。以
   `node_modules/@base-ui/react/*/stateAttributesMapping` 为准。
4. **`transition-colors` 会让测试读到动画中间态**
   切主题/切状态后立刻读 `getComputedStyle().backgroundColor`，可能拿到过渡中间值，
   暗色用例因此一度报「亮度差 0.0」的假失败。读取前必须等过渡结束。
5. **canvas `fillStyle` 对不支持的语法静默失败**
   把颜色喂给 canvas 转 RGB 时，若语法不被接受，`fillStyle` 会**沿用上一次的值**
   而不报错，导致两种颜色被读成同一个数。需先设哨兵色再校验是否被覆盖。

### 测试有效性验证

把实现 stash 掉（只保留测试）重跑：**3/6 通过**。失败项正是两个真实缺陷：

| 用例 | 修复前 | 失败原因 |
|---|---|---|
| `thumbStaysInsideTrack` | ✗ | 滑块 `[937.4, 952.8]` 完全在轨道 `[902.8, 937.4]` 之外 |
| `toggleByLabelClick` | ✗ | 点「思考模式」文字无反应（旧版 `Label` 无 `htmlFor`） |

恢复实现后 **6/6 通过** —— 说明测试确实守住了这两个 bug，而非空转。

> `trackAndThumbContrast` 在旧实现下也是绿的：`bg-muted` 与卡片背景实测有足够亮度差，
> 关闭态并非「隐形」，真正不可辨的是**滑块与轨道**几乎同色。该用例保留为规范守卫，
> 防止后续改坏配色。

### 验证

```bash
npx tsc -b          # 无输出
npm run build       # ✓ built
node scripts/test-switch-primitive.cjs   # 6/6
CASE=thinkingToggle node scripts/test-board.cjs   # 1/1（原有回归未破）
```

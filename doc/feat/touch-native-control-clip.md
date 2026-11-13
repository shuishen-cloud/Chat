# 平板浏览器原生控件遮挡自绘勾选框（touch-native-control-clip）

## 问题

在平板上勾选收藏面板的复选框时，自绘的方框会被**浏览器/系统本身的勾选图形**盖住：
勾看起来是「糊的」「重影的」，深色主题下尤其像被蒙了一层。

| 现象 | 根因 |
|---|---|
| 平板上勾选框出现系统勾选图形 / 点按灰块 | Base UI 的 Checkbox 在自绘根节点旁渲染了一个**仅供表单提交**的 `<input type="checkbox">`，它只有内联的 `visuallyHidden`（`clip-path` + 1px + `position:fixed/absolute`），**没有 `appearance: none`** |
| 桌面端完全正常 | 桌面浏览器对 1px + `clip-path` 的 input 不再基于系统外观绘制；平板系统会照原生控件再画一遍，而原生绘制与一些辅助浮层（放大镜、朗读选中框、点按高亮）**可以溢出 1px 盒子**，正好落在自绘方框上 |
| 上一版修复无效 | 上一版选择器写成后代形式 `[data-slot="checkbox"] input[...]`，但幽灵 input 是根节点的**兄弟**而非子节点；而且它带内联 `style`，普通选择器优先级也不够 |

关键事实（`@base-ui/react/checkbox/root/CheckboxRoot.mjs`）：

```js
// inputProps
style: name ? visuallyHiddenInput : visuallyHidden,   // 无 appearance
tabIndex: -1,
type: 'checkbox',
'aria-hidden': true,
...
// 渲染结构
children: [element /* <span data-slot="checkbox"> */, <input {...inputProps} />]
```

即 DOM 形如：

```html
<div class="…">
  <span data-slot="checkbox" role="checkbox">…</span>
  <input type="checkbox" aria-hidden tabindex="-1" style="clip-path:inset(50%);…">
</div>
```

## 目标

1. 那个幽灵 input 在任何设备上都不被系统绘制（不可见、不可命中）。
2. 不破坏表单语义：input 仍留在 DOM，`name`/`value`/`checked` 照常提交。
3. 不改变桌面端视觉；业务侧仍可用普通 class 覆盖勾选框样式。
4. 顺带修掉触屏下的两个可见性缺口（勾选居中偏移、下拉菜单勾选态不可见）。

## 规范

### 一、压制幽灵 input

```css
html :where([data-slot="checkbox"] + input[type="checkbox"],
            [data-slot="switch"] + input[type="checkbox"]) { … !important }
```

三条约束，缺一不可：

| 约束 | 原因 |
|---|---|
| 相邻兄弟选择器 `+` | 幽灵 input 与根节点同级，后代选择器永不命中 |
| `html` 前缀 | 目标元素带内联 `style`，`:where()` 单独用优先级为 0，压不过内联 |
| `!important` | 内联样式只能靠 `!important` 覆盖 |

属性清单及各自作用：

| 属性 | 作用 |
|---|---|
| `appearance: none` / `-webkit-appearance: none` | 断掉系统外观绘制（本次 bug 的正面根因） |
| `opacity: 0` | 兜底：即使有引擎忽略 appearance 也看不见 |
| `width/height: 1px` + `clip-path: inset(50%)` | 维持 Base UI 原有的「视觉隐藏但保留可访问性/表单」策略 |
| `pointer-events: none` | 不参与命中测试，不会抢走自绘方框的点击 |
| `-webkit-tap-highlight-color: transparent` | 去掉 iOS/安卓的点按灰块 |
| `background/border/padding/margin: 0` | 避免原生控件的默认盒子影响布局 |

用 `:where()` 保持对内层选择器的低特异性意图，同时对业务侧 class 仍可覆盖。

### 二、Checkbox 组件本身

| 改动 | 原因 |
|---|---|
| 根节点 `bg-transparent` | 未勾选时方框背景必须透明，`<input>` 若有默认底会被透出 |
| 根节点 `select-none` | 触屏长按不选中周围文字 |
| 根节点 `[-webkit-tap-highlight-color:transparent]` | 去掉点按灰块 |
| Indicator 改 `pointer-events-none absolute inset-0` | 根节点用 `after:-inset-x-3 -inset-y-2` 扩大了命中区，flex 居中会被更大的 padding box 带偏（实测勾比方框偏移 1px）；`absolute inset-0` 以方框为准 |

### 三、下拉菜单里的勾选项

`DropdownMenuCheckboxItem` 原本只在 `focus:` 态给背景。触屏没有 hover，菜单项进不了 focus 态，勾选状态几乎看不出来。补 `data-checked:bg-accent`（常显）+ 触屏媒体查询内同样规则。

## 验证方法

Playwright + iPad Pro 11 设备描述符 + Chromium，注入带两条收藏的 localStorage 后打开收藏面板：

```js
// 断言（修复后）
hiddenInput: { appearance: "none", opacity: "0", size: [1, 1], insideRoot: false }
// 点击前
root: { 14×14, bg: "rgba(0, 0, 0, 0)", ariaChecked: "false" }
// 点击后
root: { 14×14, bg: "oklch(0.205 0 0)" /* = --primary */, ariaChecked: "true" }
indicator: 12×12，x/y 正好比方框各 +1（居中）
// 再点一次
root: { bg: "rgba(0, 0, 0, 0)", ariaChecked: "false" }
```

修复前的同一脚本给出 `appearance: "auto"`，即系统仍会绘制 —— 这正是 bug 的直接证据。

## 已知限制

- **系统级**放大镜 / 朗读选中框由 OS 绘制，不属于 DOM，CSS 无法干预。若真机仍被遮挡，需要设备与浏览器信息另行定位。
- 该兜底依赖 Base UI 的 DOM 结构（根节点 + 相邻 input）。若上游改了结构，需要同步调整选择器；`[data-slot=switch]` 一并覆盖因为 Switch 用同样的 `type="checkbox"` 幽灵 input。

## 实现与校验结果

### 落地清单

| 文件 | 改动 |
|---|---|
| `src/index.css` | 新增 `html :where([data-slot="checkbox"] + input[type="checkbox"], [data-slot="switch"] + input[type="checkbox"])` 规则，逐条 `!important` 压制幽灵 input |
| `src/components/ui/checkbox.tsx` | 根节点补 `bg-transparent` / `select-none` / `[-webkit-tap-highlight-color:transparent]`；Indicator 改 `pointer-events-none absolute inset-0` |
| `src/components/ui/dropdown-menu.tsx` | `DropdownMenuCheckboxItem` 补 `data-checked:bg-accent` 常显勾选态（触屏无 hover） |
| `scripts/test-native-control.cjs` | 回归测试，断言 computed style 与几何，而非像素截图 |

### 实测对照（Playwright + iPad Pro 11 设备描述符 + Chromium）

| 状态 | 修复前 | 修复后 |
|---|---|---|
| 幽灵 input `appearance` | `auto`（系统会绘制） | `none` |
| 幽灵 input `opacity` / 尺寸 | `1` / `1×1`（系统仍可能溢出绘制） | `0` / `1×1` |
| 幽灵 input 命中 | 可参与 | `pointer-events: none` |
| 勾相对方框偏移 | `dx=1, dy=1` | `dx=0, dy=0` |

修复前的 `appearance: auto` 就是本 bug 的直接证据：系统会照原生控件再画一遍这个 1px 的 input。

### 踩到的三个坑

1. **后代选择器命不中兄弟节点**（严重）
   Base UI 把幽灵 input 渲染成根节点的相邻兄弟（`children: [<span>, <input>]`）。
   上一版 CSS 写成 `[data-slot="checkbox"] input[type="checkbox"]`，永不匹配 ——
   实测 computed `appearance` 仍是 `auto`，即上一版修复完全无效。
   必须用相邻兄弟选择器 `+`。
2. **内联 style 只能靠 `!important` 覆盖**
   幽灵 input 带内联样式，`:where()` 单独用特异性为 0，压不过内联声明。
   方案：`html` 前缀抬高优先级 + 逐条 `!important`，选择器主体仍包在 `:where()` 保持对外友好。
3. **Indicator 被 `after` 伪元素撑大的 padding box 带偏**
   根节点 `after:-inset-x-3 -inset-y-2` 把可用区域扩到约 24×26，参与布局的 Indicator
   按这个更大的盒子居中，勾比方框偏 1px。改 `absolute inset-0` 后误差为 0。

### 已知限制

- **系统级**放大镜 / 朗读选中框由 OS 绘制，不属于 DOM，CSS 无法干预。
  若真机仍被遮挡，需提供设备型号与浏览器 UA 才能进一步定位；已在 `pdm` 中登记为可控异常。
- 该兜底依赖 Base UI 的 DOM 结构（根节点 + 相邻 input）。上游若改结构，需同步调整选择器；
  已顺手覆盖 `[data-slot="switch"]`（Switch 用同样的 `type="checkbox"` 幽灵 input）。

### 验证

```bash
npm run build
npx vite preview --port 5199 &
APP_URL=http://127.0.0.1:5199/ node scripts/test-native-control.cjs
# 2/2 通过
```

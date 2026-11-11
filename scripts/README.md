scripts/*.cjs 需要 playwright，单独安装

# 测试基座

依赖 playwright（`npx playwright install --with-deps chromium` 或复用已装浏览器）。

```bash
# 需先启动 dev server: npm run dev
node scripts/test-quick-ask.cjs
```

## 约定

- 全局超时 4s（可用 `TIMEOUT` 环境变量覆盖），选择器写错立刻失败而不干等
- `waitUntil: "domcontentloaded"` + 定位等待，不用 `networkidle` 和固定 sleep
- `selectIn()` 用 DOM Range 精确选文本，避免坐标猜测
- 断言失败立即抛出，避免后续步骤连带报错

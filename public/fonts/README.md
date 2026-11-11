# 字体来源与许可

本目录下的 `.woff2` 均为**自托管**字体，页面通过 `src/index.css` 的 `@font-face` 加载，
不请求任何外部 CDN。为控制仓库体积，只保留实际被引用的 woff2 文件；
上游发布的源码包（zip / ttf / otf）已排除，见 `.gitignore`。

## Fira Code

- 文件：`fira-code/FiraCode-VF.woff2`（可变字重 300–700）
- 用途：`--font-mono`，仅代码场景
- 上游：https://github.com/tonsky/FiraCode
- 许可：SIL Open Font License 1.1

## 霞鹜文楷 LXGW WenKai

- 文件：`lxgw-wenkai/LXGWWenKai-Regular.woff2`（400）、`lxgw-wenkai/LXGWWenKai-Medium.woff2`（500）
- 用途：`--font-sans`，正文主字体
- 上游：https://github.com/lxgw/LxgwWenKai
- 许可：SIL Open Font License 1.1

## 关于 SIL Open Font License 1.1

两套字体均以 SIL Open Font License 1.1 发布。该许可允许自由使用、修改与再分发，
包括嵌入和自托管，但要求：

1. 字体不得单独出售；
2. 修改后的版本不得使用原保留字体名称（Reserved Font Name）；
3. 再分发时需随附本许可声明。

本仓库中的 woff2 为上游原样产物（未做字形修改），仅做格式转换，保留原始名称。
完整的 OFL-1.1 条款见 https://scripts.sil.org/OFL 。

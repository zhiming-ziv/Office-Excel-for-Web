# Excel 编辑工具

一个纯本地运行的网页版 Excel 编辑器：打开、编辑、保存 `.xlsx` / `.xlsm` / `.csv` 文件，
数据全程留在浏览器里，不经过任何服务器。

## 快速开始

```bash
npm install     # 安装依赖
npm run build   # 构建
npm run preview # 启动本地服务（默认 http://127.0.0.1:4173）
```

浏览器打开 `http://127.0.0.1:4173/` 即可使用。

## 功能

| 能力 | 说明 |
| --- | --- |
| 打开文件 | 支持 `.xlsx` / `.xlsm` / `.csv`，也可直接把文件拖进窗口；CSV 自动识别 UTF-8 / GBK / UTF-16；当前工作簿有内容时会先确认，避免覆盖草稿 |
| 完整编辑 | 单元格录入、公式、函数（sum/count/average…）、排序、筛选、批注、插入图片等（图片不参与导入导出） |
| 样式保留 | 打开与保存均保留加粗/斜体/下划线/删除线、字体颜色、背景色、边框、对齐、数字格式、自动换行 |
| 合并单元格 | 打开与保存均保留合并区域 |
| 行列尺寸 | 列宽、行高、冻结行列在保存后保留 |
| 保存 | `Ctrl+S` 或工具栏「保存」，生成标准 `.xlsx` 下载到本地；`.xlsm` / `.csv` 来源统一转为 `.xlsx`，不保留宏 |
| 导出 CSV | 将当前工作表导出为 CSV（带 BOM，Excel 直接打开不乱码；以 `= + - @` 开头的文本会加前导单引号，避免公式注入） |
| 自动保存草稿 | 编辑内容定期存入浏览器 localStorage，刷新/误关后可恢复；写入失败时保留上一份草稿并提示，离开页面前会拦截提醒 |
| 多工作表 | 支持多 sheet 切换、新建、重命名、隐藏 |
| 快捷键 | `Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存 |
| 主题切换 | 右上角月亮/太阳按钮切换浅色 / 深色主题；选择会记住，刷新不丢失；首次访问跟随系统偏好 |

## 技术栈

- [Luckysheet](https://github.com/mengshukeji/Luckysheet) —— 表格编辑核心（画布渲染、公式引擎、撤销重做）
- [Luckyexcel](https://github.com/mengshukeji/Luckyexcel) —— xlsx 解析导入
- [ExcelJS](https://github.com/exceljs/exceljs) —— xlsx 写出（样式/公式/合并/列宽）
- Vite + 原生 JS

> 说明：npm 源上的 `xlsx@0.18.5`（SheetJS）被裁剪了样式写入能力，因此导出改用 ExcelJS 实现。
>
> 注意：`src/main.js` 必须显式导入 `luckysheet/dist/assets/iconfont/iconfont.css`——Luckysheet 工具栏图标（粗体/斜体/颜色/对齐/合并等）的字形定义只在这个文件里，`dist/css/luckysheet.css` 只引用 `.luckysheet-iconfont-*` 类而不定义 `@font-face`，漏导会导致按钮空白（tooltip 正常但无图标）。
>
> 注意：必须显式引入 `luckysheet/dist/plugins/plugins.css` **和** `luckysheet/dist/plugins/css/pluginsCss.css`，后者含 spectrum 取色器与 jQuery UI 的样式，漏导会让颜色面板无样式。
>
> 注意：`luckysheet/dist/plugins/js/plugin.js`（官方插件包，含 spectrum 取色器 / sPage 分页 / jQuery UI）**不能**作为 ES module 引入——它的 UMD 在打包环境下不会把插件挂到全局 jQuery 上，会导致「文字颜色 / 单元格底色 / 边框颜色」面板报 `$(...).spectrum is not a function` 而完全打不开。正确做法是以经典 `<script>` 加载（见 `index.html`），文件由 `vite.config.js` 在 dev/build 启动时从 node_modules 同步到 `public/`；`src/jquery-global.js` 会优先复用这份已带插件的全局 jQuery，只有缺失时才退回 npm 的 jquery。

## 目录结构

```
├── index.html          # 页面骨架（含 Luckysheet 插件包的经典 script 引入）
├── public/
│   └── luckysheet-plugin.js # 由 vite.config.js 自动从 node_modules 同步
├── src/
│   ├── main.js         # 主逻辑：打开/保存/CSV/草稿/拖拽/主题/重命名
│   ├── jquery-global.js# Luckysheet 依赖的全局 jQuery 挂载（优先复用插件包实例）
│   ├── luckysheet-dark.css # 深色主题下 Luckysheet 内置界面的覆盖样式
│   └── style.css       # 界面样式（浅色/深色双主题 CSS 变量）
├── sample.xlsx         # 测试样例（含样式、公式、合并单元格）
├── tests/              # 测试脚本（playwright-core 驱动系统 Chrome）
│   ├── e2e-test.cjs        # 端到端冒烟（打开→编辑→保存→解包校验）
│   ├── dark-test.cjs       # 主题切换专项验证
│   ├── autosave-test.cjs   # 草稿写入失败/恢复专项
│   ├── save-test.cjs       # 保存命名/冻结导出/覆盖确认专项
│   ├── csv-test.cjs        # CSV 编码/数字保真/公式注入/导出格式专项
│   ├── rename-test.cjs     # 文件名重命名专项
│   ├── toolbar-test.cjs    # 工具栏逐项功能验证（深色主题，46 项）
│   ├── audit-dark.cjs      # 深色截图亮色区域像素审计
│   └── final-shots.cjs     # 生成各弹出层对比截图
├── start.cjs / start.bat # 一键启动（缺依赖自动装、缺 dist 自动构建）
└── vite.config.js
```

## 测试

```bash
npm run preview                              # 先启动服务
node tests/e2e-test.cjs                      # 打开示例→编辑→保存→解包校验（浅色主题）
node tests/dark-test.cjs                     # 主题切换专项：注入/剥离/持久化/保存产物校验
node tests/autosave-test.cjs                 # 草稿写入失败/保留旧草稿/恢复后重试/刷新恢复
node tests/save-test.cjs                     # 保存命名/冻结导出/打开覆盖确认
node tests/csv-test.cjs                      # CSV 编码/数字保真/公式注入/导出格式
node tests/regression-test.cjs               # 多表数据隔离、格式/边框/颜色、立即刷新与 xls 拒绝
node tests/toolbar-test.cjs                  # 工具栏逐项功能验证（深色主题，46 项）
```

`toolbar-test.cjs` 会真实点击工具栏每个控件并断言数据变化：撤销/重做、格式刷、货币/百分比/小数位、数字格式/字体/字号下拉、粗斜下删线、文字颜色与底色取色板、边框、合并、水平/垂直对齐、自动换行、文字旋转、冻结、求和、排序、筛选、批注、「更多」按钮，以及逐个弹出层的深色可读性对比度检查。

样例文件 `sample.xlsx` 在仓库根目录；测试脚本以自身所在目录为基准定位资源（产物统一写入根目录 `.e2e-downloads/`，已忽略），可在任意路径的仓库副本中运行。

Chrome 默认从 `Program Files` / `Program Files (x86)` 探测，也可用环境变量 `CHROME_PATH` 指定 `chrome.exe`。

## 主题实现说明

Luckysheet 2.x 无原生深色模式，画布单元格按白底黑字硬编码渲染。本项目方案：

- **应用外壳**（顶部工具栏、状态栏、按钮、遮罩、提示）：CSS 自定义属性双主题，`<html data-theme>` 切换
- **Luckysheet 内置界面**（其工具栏、公式栏、工作表页签、弹出菜单）：`luckysheet-dark.css` 在深色下用 `!important` 覆盖
- **行列标题栏**（与数据区同画布渲染，颜色改不了）：`backdrop-filter: invert()` 覆盖层反色，位置由 ResizeObserver 自动跟踪
- **表格数据区**：深色时给「无样式」单元格非侵入式注入深色底色/浅色文字（运行时数据）；保存/导出/草稿前原样剥离，**写出的 xlsx 与主题无关**；用户显式设置的样式优先保留

已知限制：缩放到网格范围之外（超过 84 行 × 60 列的数据区）会露出画布白色底色。

## 已知限制

- 不支持旧版 `.xls`（BIFF），请先用 Excel 或 LibreOffice 转存为 `.xlsx`
- 图片/图表/透视表等高级对象不做导入导出
- 草稿保存在浏览器 localStorage，注意清理大文件占用

# Excel 编辑工具

一个纯本地运行的网页版 Excel 编辑器：打开、编辑、保存 `.xlsx` / `.xlsm` / `.csv` 文件，
数据全程留在浏览器里，不经过任何服务器。

## 快速开始

需要 Node.js 22 或 24 与 npm。Windows 可双击 `start.bat`，其他平台使用 `npm start`。
`npm start` 每次都会重新构建当前源码，构建失败即停止；修改源码后不会继续使用旧的 `dist/`。
开发时建议使用 `npm run dev`，获得即时更新。

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
| 自动保存草稿 | 小草稿同步写入 localStorage；大草稿写入 IndexedDB，按数据密度选择稀疏坐标或二维数组，事务成功后才清理旧副本。失败保留上一份草稿；大草稿尚未写完时离开页面会提醒 |
| 多工作表 | 支持多 sheet 切换、新建、重命名、隐藏 |
| 快捷键 | `Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存 |
| 主题切换 | 右上角月亮/太阳按钮切换浅色 / 深色主题；选择会记住，刷新不丢失；首次访问跟随系统偏好 |

## 技术栈

- [Luckysheet](https://github.com/mengshukeji/Luckysheet) —— 表格编辑核心（画布渲染、公式引擎、撤销重做）
- [Luckyexcel](https://github.com/mengshukeji/Luckyexcel) —— xlsx 解析导入
- [ExcelJS](https://github.com/exceljs/exceljs) —— xlsx 写出（样式/公式/合并/列宽）
- Vite + 原生 JS
- JSZip：读取工作簿传统批注与不支持功能的元数据

## 导入导出能力

保存会重新生成 XLSX，不能保证任意 Excel 文件无损往返；请保留原始文件。

| 功能 | 导入 / 编辑 | 保存为 XLSX |
| --- | --- | --- |
| 值、公式、基本字体与颜色、数字格式、对齐、换行 | 支持 | 支持；公式计算兼容性取决于表格引擎 |
| 合并、行列尺寸、冻结、隐藏工作表 | 支持 | 支持 |
| 传统批注 | 读取文字，可编辑 | 保留文字；作者与富文本格式不保留 |
| 文字旋转、隐藏行列 | 支持 | 支持 |
| 筛选、数据验证、条件格式、超链接 | 取决于导入器和编辑引擎 | 尚未映射；检测到时显示提示 |
| 结构化表格、工作表保护、外部链接 | 不保证兼容 | 不保留；检测到时显示提示 |
| 宏、图片、图表、透视表、线程批注 | 不保证兼容 | 不保留；检测到时显示提示 |
| CSV | 支持编码识别与文本/数字处理 | CSV 只包含当前工作表的值，不含样式或批注 |

功能检测不是完整的 Excel 兼容性检查；未列出的高级属性也可能丢失。

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
│   ├── draft-store.js  # 小草稿同步保存、大草稿 IndexedDB 事务与迁移
│   ├── workbook-metadata.js # 批注、隐藏尺寸与功能兼容性检测
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
├── start.cjs / start.bat # 一键启动（缺依赖自动装、每次重新构建）
└── vite.config.js
```

## 测试

先执行 `npm run build`，再执行 `npm test`，会自动启动预览服务并运行回归。
端口 4173 必须空闲；也可手动启动服务后运行以下单项测试。
GitHub Actions 配置了 Windows/Linux、Node.js 22/24 的安装和构建检查。

```bash
npm run preview                              # 先启动服务
node tests/e2e-test.cjs                      # 打开示例→编辑→保存→解包校验（浅色主题）
node tests/dark-test.cjs                     # 主题切换专项：注入/剥离/持久化/保存产物校验
node tests/autosave-test.cjs                 # 草稿写入失败/保留旧草稿/恢复后重试/刷新恢复
node tests/save-test.cjs                     # 保存命名/冻结导出/打开覆盖确认
node tests/csv-test.cjs                      # CSV 编码/数字保真/公式注入/导出格式
node tests/regression-test.cjs               # 多表数据隔离、格式/边框/颜色、立即刷新与 xls 拒绝
node tests/toolbar-test.cjs                  # 工具栏逐项功能验证（深色主题，46 项）
node tests/fidelity-test.cjs                 # 批注、旋转、隐藏行列的文件往返
node tests/large-draft-test.cjs              # IndexedDB 迁移、失败回滚、重试与恢复
node tests/theme-scroll-test.cjs             # 深色远距离滚动补绘与空白对象回收
node tests/performance-test.cjs              # 稀疏/密集大表格基准，产物写入 .e2e-downloads/
```

`toolbar-test.cjs` 会真实点击工具栏每个控件并断言数据变化：撤销/重做、格式刷、货币/百分比/小数位、数字格式/字体/字号下拉、粗斜下删线、文字颜色与底色取色板、边框、合并、水平/垂直对齐、自动换行、文字旋转、冻结、求和、排序、筛选、批注、「更多」按钮，以及逐个弹出层的深色可读性对比度检查。

样例文件 `sample.xlsx` 在仓库根目录；测试脚本以自身所在目录为基准定位资源（产物统一写入根目录 `.e2e-downloads/`，已忽略），可在任意路径的仓库副本中运行。

测试通过 `tests/browser-path.cjs` 共用浏览器探测，支持 Windows、macOS 与 Linux 的常见 Chrome/Chromium 路径；也可用 `CHROME_PATH` 指定可执行文件。浏览器需自行安装。

## 主题实现说明

Luckysheet 2.x 无原生深色模式，画布单元格按白底黑字硬编码渲染。本项目方案：

- **应用外壳**（顶部工具栏、状态栏、按钮、遮罩、提示）：CSS 自定义属性双主题，`<html data-theme>` 切换
- **Luckysheet 内置界面**（其工具栏、公式栏、工作表页签、弹出菜单）：`luckysheet-dark.css` 在深色下用 `!important` 覆盖
- **行列标题栏**（与数据区同画布渲染，颜色改不了）：`backdrop-filter: invert()` 覆盖层反色，位置由 ResizeObserver 自动跟踪
- **表格数据区**：只处理活动表；有内容/样式的单元格注入主题色，空白单元格仅在可视区及冻结区注入，滚动后回收区外纯主题对象；保存/导出/草稿前原样剥离，**写出的 xlsx 与主题无关**，用户显式颜色优先保留

已知限制：网格实际范围之外的画布仍可能显示白底；快速滚动时主题补绘有短暂延迟。

## 已知限制

- 不支持旧版 `.xls`（BIFF），请先用 Excel 或 LibreOffice 转存为 `.xlsx`
- 图片/图表/透视表等高级对象不做导入导出
- 草稿按来源地址保存在浏览器中，切换端口/浏览器无法共享；清除网站数据会删除草稿
- 任一工作表超过 20,000 个网格位置时使用 IndexedDB 草稿，按密度选择数据表示，避免重复保存 `data` 和 `celldata`；小草稿 JSON 超过 256 Ki 字符时也转入 IndexedDB
- 大草稿写入是异步事务，离开页面前应等待写入完成；浏览器强制退出无法保证最后一次写入完成
- 数据快照仍需遍历活动数据，大文件并非无限容量；使用 `performance-test.cjs` 测量目标设备的实际表现

# Excel 编辑工具

一个在本地浏览器中运行的 Excel 编辑器：导入 `.xlsx` / `.xlsm` / `.csv`，编辑后保存为 `.xlsx` 或将当前工作表导出为 CSV。
工作簿内容在浏览器内处理，不上传服务器；本地开发或预览服务提供应用页面和静态资源。

## 快速开始

需要 Node.js 22 或 24 与 npm。在项目根目录执行：

```bash
npm install     # 安装依赖
npm start       # 重新构建、启动本地服务并打开浏览器
```

服务地址为 `http://127.0.0.1:4173/`；若浏览器未自动打开，可手动访问。按 `Ctrl+C` 停止服务。
Windows 也可双击 `start.bat`，它调用相同的启动脚本。

`npm start` 每次都会重新构建当前源码，构建失败即停止。端口 4173 被占用时需先停止已有服务，再启动。

## 功能

| 能力 | 说明 |
| --- | --- |
| 打开文件 | 支持 `.xlsx` / `.xlsm` / `.csv`，也可直接把文件拖进窗口；CSV 自动识别 UTF-8 / GBK / UTF-16；当前工作簿有内容时会先确认，避免覆盖草稿 |
| 表格编辑 | 单元格录入、公式、函数（SUM/COUNT/AVERAGE…）、排序、筛选、批注、插入图片等；各功能的保存范围见下方能力表 |
| 样式保留 | 打开与保存均保留加粗/斜体/下划线/删除线、字体颜色、背景色、边框、对齐、数字格式、自动换行 |
| 合并单元格 | 打开与保存均保留合并区域 |
| 行列尺寸 | 支持保存列宽、行高、冻结和隐藏行列 |
| 保存 | `Ctrl+S` 或工具栏「保存」，生成标准 `.xlsx` 下载到本地；`.xlsm` / `.csv` 来源统一转为 `.xlsx`，不保留宏 |
| 导出 CSV | 将当前工作表的值导出为 UTF-8 CSV，带 BOM；转义引号与换行，并对可能被解释为公式的内容加前导单引号，普通负数保留 |
| 自动保存草稿 | 小草稿同步写入 localStorage；大草稿写入 IndexedDB，按数据密度选择稀疏坐标或二维数组，事务成功后才清理旧副本。失败保留上一份草稿；大草稿尚未写完时离开页面会提醒 |
| 多工作表 | 支持多 sheet 切换、新建、重命名、隐藏 |
| 快捷键 | `Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存 |
| 主题切换 | 右上角月亮/太阳按钮切换浅色 / 深色主题；选择会记住，刷新不丢失；首次访问跟随系统偏好 |
| 界面语言 | 简体中文、繁体中文、英文；记住手动选择，首次访问匹配浏览器语言 |

## 多语言

顶部语言选择器同时控制应用界面和 Luckysheet 工具栏。优先使用已保存的语言设置，其次匹配浏览器语言；未支持的语言回退为英文。繁体中文覆盖 `zh-TW`、`zh-HK`、`zh-MO` 和 `zh-Hant`，简体中文覆盖 `zh-CN`、`zh-SG` 和 `zh-Hans`。

切换时会先结束单元格编辑、等待已有草稿事务，再保存最新内容并刷新。工作簿内容恢复，撤销历史清空；切换前会说明这一点。草稿或语言设置写入失败时不刷新，保留当前内容和语言。文件导入期间暂时不能切换。

界面语言不会重命名已有文件或工作表，也不会转换公式、日期、货币、数字格式或 CSV 分隔符。新建文件使用当前语言的默认文件名。兼容性警告以稳定功能标识保存，已有草稿中的中文警告会自动迁移。

应用词典位于 `src/locales/`，由 `src/i18n.js` 统一处理占位符、语言匹配和缺失文案回退。引擎使用其内置语言包，其中少量历史译法可能与应用文案不同；浏览器原生确认框的按钮语言由浏览器决定。

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
| CSV 导入的数据 | 支持编码识别与文本/数字处理 | 可保存为 XLSX |

功能检测不是完整的 Excel 兼容性检查；未列出的高级属性也可能丢失。

**CSV 导出**是独立操作：只导出当前工作表的值，公式导出为计算结果；不保留样式、批注、多工作表或公式表达式。CSV 导入后的文本或数字识别，以及导出时的公式转义，可能改变原始文本表示，因此不保证逐字节往返。

## 已知限制

- 不支持旧版 `.xls`（BIFF），请先用 Excel 或 LibreOffice 转存为 `.xlsx`；`.xlsm` 保存为 `.xlsx`，不保留宏
- 图片、图表、透视表等高级对象不支持完整导入导出；具体范围见能力表
- 草稿按来源地址保存在浏览器中，切换端口或浏览器无法共享；清除网站数据会删除草稿
- 大草稿写入是异步事务，离开页面前应等待写入完成；浏览器强制退出无法保证最后一次写入完成
- 实际网格范围外可能显示白色画布，快速滚动时主题补绘有短暂延迟
- 大表格仍有快照处理与渲染开销；可使用 `performance-test.cjs` 测量目标设备的实际表现

## 开发说明

### 技术栈

- [Luckysheet](https://github.com/mengshukeji/Luckysheet)：表格编辑核心，提供画布渲染、公式引擎和撤销重做
- [Luckyexcel](https://github.com/mengshukeji/Luckyexcel)：XLSX/XLSM 导入解析
- [ExcelJS](https://github.com/exceljs/exceljs)：本项目用于生成 XLSX，映射值、公式、样式、合并区域等属性
- JSZip：读取传统批注、隐藏行列尺寸及不支持功能的元数据
- Vite + 原生 ES Module JavaScript

### 开发与手动预览

开发时运行 `npm run dev`，默认地址为 `http://127.0.0.1:5173/`，支持源码更新。
需要单独构建或预览时执行：

```bash
npm run build   # 构建到 dist/
npm run preview # 预览已有构建，默认 http://127.0.0.1:4173/
```

`npm run preview` 本身不会重新构建；源码修改后应先运行 `npm run build`，或直接使用 `npm start`。

### 集成约束

- `src/main.js` 必须显式引入 `luckysheet/dist/assets/iconfont/iconfont.css`，否则工具栏图标可能空白。
- 保留 `luckysheet/dist/plugins/plugins.css` 和 `luckysheet/dist/plugins/css/pluginsCss.css` 两套样式，确保取色器和 jQuery UI 正常显示。
- 本项目通过经典 `<script>` 加载 Luckysheet 插件包，避免其 UMD 插件未挂载到全局 jQuery 而出现 `$(...).spectrum is not a function`。`vite.config.js` 在开发和构建时同步插件包到 `public/`；`src/jquery-global.js` 优先复用该实例。
- `public/luckysheet-plugin.js` 和 `dist/` 均为生成物，不手工修改。

### 目录结构

```
├── index.html          # 页面骨架（含 Luckysheet 插件包的经典 script 引入）
├── public/
│   └── luckysheet-plugin.js # 由 vite.config.js 自动从 node_modules 同步
├── src/
│   ├── main.js         # 主逻辑：打开/保存/CSV/草稿/拖拽/主题/重命名
│   ├── draft-store.js  # 小草稿同步保存、大草稿 IndexedDB 事务与迁移
│   ├── workbook-metadata.js # 批注、隐藏尺寸与功能兼容性检测
│   ├── i18n.js         # 语言匹配、词典读取与静态界面翻译
│   ├── locales/        # 简体中文、繁体中文、英文词典
│   │   ├── zh-CN.js
│   │   ├── zh-TW.js
│   │   └── en.js
│   ├── warning-codes.js # 兼容性警告标识与旧草稿迁移
│   ├── jquery-global.js # 全局 jQuery 挂载（优先复用插件包实例）
│   ├── luckysheet-dark.css # 深色主题下 Luckysheet 内置界面的覆盖样式
│   └── style.css       # 界面样式（浅色/深色双主题 CSS 变量）
├── sample.xlsx         # 测试样例（含样式、公式、合并单元格）
├── tests/              # 测试脚本（playwright-core 驱动系统 Chrome）
│   ├── run-tests.cjs      # 启动预览服务并顺序运行回归
│   ├── browser-path.cjs   # 跨平台浏览器路径探测
│   ├── e2e-test.cjs        # 端到端冒烟（打开→编辑→保存→解包校验）
│   ├── dark-test.cjs       # 主题切换专项验证
│   ├── autosave-test.cjs   # 草稿写入失败/恢复专项
│   ├── save-test.cjs       # 保存命名/冻结导出/覆盖确认专项
│   ├── csv-test.cjs        # CSV 编码/数字保真/公式注入/导出格式专项
│   ├── regression-test.cjs # 多表数据、样式与即时刷新回归
│   ├── fidelity-test.cjs   # 批注、旋转、隐藏行列的文件往返
│   ├── large-draft-test.cjs # IndexedDB 迁移、回滚、重试与恢复
│   ├── theme-scroll-test.cjs # 深色滚动补绘与主题对象回收
│   ├── i18n-unit-test.cjs  # 词典、占位符、语言匹配与警告迁移
│   ├── i18n-test.cjs       # 三语言界面、切换保护与窄屏布局
│   ├── performance-test.cjs # 稀疏/密集大表格基准
│   ├── rename-test.cjs     # 文件名重命名专项
│   ├── toolbar-test.cjs    # 工具栏逐项功能验证（深色主题，46 项）
│   ├── audit-dark.cjs      # 深色截图亮色区域像素审计
│   └── final-shots.cjs     # 生成各弹出层对比截图
├── .github/workflows/build.yml # Windows/Linux 安装与构建检查
├── start.cjs / start.bat # 一键启动（未检测到 Vite 时安装依赖，每次重新构建）
└── vite.config.js
```

### 测试

完整回归会自动启动预览服务，结束后停止该服务。运行前确保端口 4173 空闲：

```bash
npm run build
npm test
```

也可在端口空闲时使用 `npm test -- i18n-unit-test i18n-test` 只运行指定脚本。
`performance-test.cjs`（性能基准）和 `final-shots.cjs`（截图生成）不在默认回归中，需单独运行。

手动运行浏览器测试时，在一个终端执行 `npm run preview` 并保持运行，在另一个终端执行以下命令；纯词典测试 `i18n-unit-test.cjs` 不需要服务：

```bash
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
node tests/i18n-unit-test.cjs                # 词典完整性、占位符、语言匹配与警告迁移
node tests/i18n-test.cjs                     # 三语言界面、导出、切换保护、存储事务与窄屏布局
node tests/rename-test.cjs                   # 重命名、取消、保存命名与草稿恢复
node tests/audit-dark.cjs                    # 深色主题像素审计
node tests/performance-test.cjs              # 稀疏/密集大表格基准，产物写入 .e2e-downloads/
node tests/final-shots.cjs                   # 生成弹出层对比截图
```

`toolbar-test.cjs` 会真实点击工具栏每个控件并断言数据变化：撤销/重做、格式刷、货币/百分比/小数位、数字格式/字体/字号下拉、粗斜下删线、文字颜色与底色取色板、边框、合并、水平/垂直对齐、自动换行、文字旋转、冻结、求和、排序、筛选、批注、「更多」按钮，以及逐个弹出层的深色可读性对比度检查。

样例文件 `sample.xlsx` 在仓库根目录；测试脚本以自身所在目录为基准定位资源（产物统一写入根目录 `.e2e-downloads/`，已忽略），可在任意路径的仓库副本中运行。

测试通过 `tests/browser-path.cjs` 共用浏览器探测，支持 Windows、macOS 与 Linux 的常见 Chrome/Chromium 路径；也可用 `CHROME_PATH` 指定可执行文件。浏览器需自行安装。

既有功能回归固定使用 `zh-CN` 浏览器区域，避免测试结果依赖运行机器的语言。多语言专项分别验证三种语言的应用界面和引擎工具栏。

GitHub Actions 配置了 Windows/Linux、Node.js 22/24 的安装和构建检查，不包含浏览器功能回归。

### 草稿存储

任一工作表超过 20,000 个网格位置时使用 IndexedDB，按密度选择稀疏坐标或二维数组，避免重复保存 `data` 和 `celldata`；小草稿 JSON 超过 256 Ki 字符时也转入 IndexedDB。事务成功后才清理旧副本。数据快照仍需遍历工作簿网格。

### 主题实现

Luckysheet 2.x 无原生深色模式，画布单元格按白底黑字硬编码渲染。本项目方案：

- **应用外壳**（顶部工具栏、状态栏、按钮、遮罩、提示）：CSS 自定义属性双主题，`<html data-theme>` 切换
- **Luckysheet 内置界面**（其工具栏、公式栏、工作表页签、弹出菜单）：`luckysheet-dark.css` 在深色下用 `!important` 覆盖
- **行列标题栏**（与数据区同画布渲染，颜色改不了）：`backdrop-filter: invert()` 覆盖层反色，位置由 ResizeObserver 自动跟踪
- **表格数据区**：只处理活动表；有内容/样式的单元格注入主题色，空白单元格仅在可视区及冻结区注入，滚动后回收区外纯主题对象；保存/导出/草稿前原样剥离，**写出的 xlsx 与主题无关**，用户显式颜色优先保留

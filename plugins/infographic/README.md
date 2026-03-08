# Infographic Plugin - 信息图生成插件

基于 [AntV Infographic](https://infographic.antv.vision/) 框架的信息图生成和渲染插件。

## 功能特性

- 📊 **丰富的模板** - 支持列表、流程、对比、层级、关系、图表等多种信息图类型
- 🎨 **主题系统** - 支持自定义配色、暗色主题、手绘风格等
- 📱 **多端输出** - 生成 HTML 文件，可导出 SVG 格式
- 🔄 **流式渲染** - 支持 AI 流式输出和实时渲染
- 🌐 **Web 预览** - 前端内置 Infographic 预览组件

## 安装

本插件已集成到 MantisBot 项目中，无需单独安装。

项目依赖安装：
```bash
npm install
```

## 使用方法

### 1. 使用 Slash 命令

```
/create-infographic 创建一个产品开发流程，包含 5 个阶段
```

### 2. 使用工具调用

直接使用 `infographic` 工具：

```json
{
  "tool": "infographic",
  "args": {
    "syntax": "infographic list-row-simple-horizontal-arrow\ndata\n  title 流程\n  lists\n    - label 步骤 1\n    - label 步骤 2",
    "title": "我的信息图",
    "format": "html"
  }
}
```

### 3. 在前端预览

生成的 HTML 文件会自动保存到文件存储，可在 Web UI 中预览：

1. 打开 MantisBot Web UI
2. 在文件管理器中找到生成的 `.html` 文件
3. 点击预览，自动渲染信息图
4. 可导出 SVG 或在新窗口打开

## 可用模板

### 列表类 (list-*)
- `list-row-simple-horizontal-arrow` - 水平流程
- `list-column-simple-vertical-arrow` - 垂直流程
- `list-grid-badge-card` - 网格徽章卡片

### 顺序类 (sequence-*)
- `sequence-steps-simple` - 简单步骤
- `sequence-timeline-simple` - 时间线
- `sequence-roadmap-vertical-simple` - 路线图

### 对比类 (compare-*)
- `compare-swot` - SWOT 分析
- `compare-binary-horizontal-badge-card-arrow` - 二元对比
- `compare-quadrant-quarter-simple-card` - 四象限图

### 层级类 (hierarchy-*)
- `hierarchy-structure` - 层级结构
- `hierarchy-tree-curved-line-rounded-rect-node` - 树图

### 图表类 (chart-*)
- `chart-column-simple` - 柱状图
- `chart-pie-plain-text` - 饼图
- `chart-wordcloud` - 词云图

完整模板列表见 [skills/infographic-creator/references/templates.md](plugins/infographic/skills/infographic-creator/references/templates.md)

## 语法示例

### 基础流程

```infographic
infographic list-row-horizontal-icon-arrow
data
  title 互联网技术演进
  desc 从 Web 1.0 到 AI 时代
  lists
    - time 1991
      label Web 1.0
      icon web
    - time 2004
      label Web 2.0
      icon account multiple
    - time 2023
      label AI 大模型
      icon brain
```

### SWOT 分析

```infographic
infographic compare-swot
data
  title 产品 SWOT 分析
  compares
    - label Strengths
      children
        - label 强大的品牌
        - label 忠诚用户
    - label Weaknesses
      children
        - label 成本偏高
        - label 周期长
    - label Opportunities
      children
        - label 新兴市场
        - label AI 融合
    - label Threats
      children
        - label 竞争加剧
        - label 监管风险
```

### 时间线

```infographic
infographic sequence-timeline-simple
data
  title 项目里程碑
  sequences
    - time 2024 Q1
      label 项目启动
    - time 2024 Q2
      label MVP 发布
    - time 2024 Q3
      label 用户破万
```

## 主题配置

### 自定义配色

```infographic
infographic list-row-simple
theme
  palette #3b82f6 #8b5cf6 #f97316
```

### 暗色主题

```infographic
infographic list-row-simple
theme dark
  palette
    - #61DDAA
    - #F6BD16
    - #F08BB4
```

### 手绘风格

```infographic
infographic list-row-simple
theme
  stylize rough
  base
    text
      font-family 851tegakizatsu
```

## 文件结构

```
plugins/infographic/
├── .claude-plugin/
│   └── plugin.json              # 插件清单
├── skills/
│   ├── infographic-creator/     # 信息图生成技能
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── infographic-syntax.md
│   │       └── templates.md
│   └── infographic-syntax-creator/  # 语法生成技能
│       └── SKILL.md
├── commands/
│   ├── create-infographic.md    # 创建命令
│   └── export-infographic.md    # 导出命令
└── README.md
```

## 前端集成

### InfographicViewer 组件

```tsx
import { InfographicViewer } from './components/InfographicViewer';

<InfographicViewer
  infographicSyntax={`
    infographic list-row-simple
    data
      title 示例
      lists
        - label 项 1
        - label 项 2
  `}
  width="100%"
  height="100%"
/>
```

### InfographicPreview 组件

```tsx
import { InfographicPreview } from './components/InfographicPreview';

<InfographicPreview
  infographicSyntax={syntax}
  title="我的信息图"
/>
```

## 飞书集成

在飞书渠道中使用时，信息图会自动以 HTML 文件形式发送，用户可下载查看。

## 技术细节

- **渲染引擎**: AntV Infographic (CDN 加载)
- **输出格式**: HTML + SVG
- **依赖管理**: 通过 npm 安装 `@antv/infographic`
- **工具注册**: 自动注册到 ToolRegistry

## 容错机制

Infographic 工具具有三层容错机制，确保即使 LLM 生成的语法有误也能正常渲染：

### 第一层：SKILL.md 提示
在 `SKILL.md` 中明确列出所有可用模板和标准字段名称，引导 LLM 生成正确的语法。

### 第二层：模板名称自动修正
当 LLM 使用了无效或非标准的模板名称时，工具会自动映射到最接近的有效模板：

| 无效模板 | 修正后模板 |
|---------|----------|
| `comparison-matrix` / `matrix` / `table` | `list-grid-badge-card` |
| `process-steps` | `sequence-steps-simple` |
| `flow-*` | `sequence-steps-simple` |
| `step-*` | `sequence-steps-simple` |
| `timeline-*` | `sequence-timeline-simple` |
| `roadmap-*` | `sequence-roadmap-vertical-simple` |
| `swot` | `compare-swot` |
| `compare-*` / `vs` / `versus` | `compare-binary-horizontal-badge-card-arrow` |
| `hierarchy-*` / `tree-*` | `hierarchy-structure` |
| `mindmap-*` | `hierarchy-mindmap-level-gradient-compact-card` |
| `chart-*` / `bar-*` / `column-*` | `chart-column-simple` |
| `pie-*` | `chart-pie-plain-text` |
| `list-*` | `list-row-horizontal-icon-arrow` |

### 第三层：数据字段自动修正
当 LLM 使用了非标准的数据字段名称时，工具会自动修正：

| 无效字段 | 修正后字段 |
|---------|----------|
| `steps` | `sequences` |
| `items` | `sequences` |
| `columns` / `rows` | `lists` (转换为网格卡片格式) |

示例：即使 LLM 生成 `steps` 字段，工具也会自动修正为 `sequences`，确保渲染成功。

### 第四层：特殊格式转换

当 LLM 生成表格类语法（`columns`/`rows`）时，工具会：
1. 将模板映射到 `list-grid-badge-card`
2. 将 `rows` 转换为 `lists` 格式
3. 移除 `columns` 部分（因为网格卡片模板不支持列表头）

## 许可证

MIT License

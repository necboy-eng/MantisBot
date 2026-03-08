---
name: infographic-creator
description: 基于给定文字内容创建精美信息图。当用户请求创建信息图、数据可视化、流程图、对比图等信息图表时使用此技能。**重要：必须使用下方"可用模板"列表中列出的模板名称，不要自创模板名。**
---

# Infographic Creator - 信息图生成技能

信息图（Infographic）将数据、信息与知识转化为可感知的视觉语言。

本任务使用 [AntV Infographic](https://infographic.antv.vision/) 创建可视化信息图。

## ⚠️ 重要规则

1. **必须使用下方"可用模板"列表中列出的模板名称**
2. **不要自创模板名**（如 `process-steps` 是无效的）
3. **数据字段必须与模板类型匹配**：`list-*` 用 `lists`，`sequence-*` 用 `sequences`
4. **输出格式**：使用 ` ```infographic ` 代码块输出语法，前端会自动渲染

## 快速开始

### 输出格式

直接在回复中使用 `infographic` 代码块，前端会自动识别并渲染：

````
```infographic
infographic sequence-steps-simple
data
  title 产品开发流程
  sequences
    - label 需求分析
      desc 市场调研、需求文档
    - label 设计
      desc UI/UX 设计、原型制作
    - label 开发
      desc 编码实现、代码审查
    - label 测试
      desc 单元测试、集成测试
    - label 发布
      desc 部署上线、监控运维
```
````

### 注意事项

- **不需要调用任何工具**，直接输出代码块即可
- 代码块语言标识必须是 `infographic`
- 语法内容必须以 `infographic <模板名>` 开头

## 可用模板（必须从以下列表中选择）

### 流程/步骤类 (sequence-*)
- `sequence-steps-simple` - 简单步骤流程
- `sequence-timeline-simple` - 时间线
- `sequence-roadmap-vertical-simple` - 垂直路线图
- `sequence-pyramid-simple` - 金字塔图
- `sequence-funnel-simple` - 漏斗图

### 列表类 (list-*)
- `list-row-simple-horizontal-arrow` - 水平箭头列表
- `list-row-horizontal-icon-arrow` - 带图标的水平列表
- `list-column-simple-vertical-arrow` - 垂直箭头列表
- `list-grid-badge-card` - 网格徽章卡片
- `list-zigzag-down-simple` - 之字形下降列表
- `list-zigzag-up-simple` - 之字形上升列表

### 对比类 (compare-*)
- `compare-swot` - SWOT 分析（4 象限）
- `compare-binary-horizontal-simple-fold` - 二元对比
- `compare-binary-horizontal-badge-card-arrow` - 带徽章的二元对比（推荐用于产品/服务对比）

**❌ 不支持的格式**：表格类语法（如 `headers`/`rows`/`columns`/`values`）不是有效的 AntV Infographic 格式。

**✅ 对比图正确用法**（以二元对比为例）：

```infographic
infographic compare-binary-horizontal-badge-card-arrow
data
  title 产品对比
  compares
    - label 产品 A
      children
        - label 特点 1
          描述内容
        - label 特点 2
          描述内容
    - label 产品 B
      children
        - label 特点 1
          描述内容
        - label 特点 2
          描述内容
```

### 层级类 (hierarchy-*)
- `hierarchy-structure` - 层级结构图
- `hierarchy-mindmap-level-gradient-compact-card` - 思维导图

### 图表类 (chart-*)
- `chart-column-simple` - 柱状图
- `chart-pie-plain-text` - 饼图
- `chart-wordcloud` - 词云图

### 关系类 (relation-*)
- `relation-dagre-flow-tb-simple-circle-node` - 流程图

## 数据字段规则

| 模板类型 | 数据字段 | 示例 |
|----------|----------|------|
| `list-*` | `lists` | `- label 项 1` |
| `sequence-*` | `sequences` | `- label 步骤 1` |
| `compare-*` | `compares` | `- label Strengths` |
| `hierarchy-*` | `root` | `root: label CEO` |
| `chart-*` | `values` | `- label 销售额 value 100` |

## 使用流程

1. **理解用户需求** - 分析用户想表达的信息结构
2. **选择合适模板** - 从上方列表中选择
3. **生成 DSL 语法** - 构建符合规范的语法
4. **输出代码块** - 使用 ` ```infographic ` 代码块直接输出，前端会自动渲染

## 完整示例

### 示例 1：产品开发流程（使用 sequence-steps-simple）

```infographic
infographic sequence-steps-simple
data
  title 产品开发流程
  sequences
    - label 需求分析
      desc 市场调研、需求文档
    - label 设计
      desc UI/UX 设计、原型制作
    - label 开发
      desc 编码实现、代码审查
    - label 测试
      desc 单元测试、集成测试
    - label 发布
      desc 部署上线、监控运维
```

### 示例 2：SWOT 分析（使用 compare-swot）

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

### 示例 3：时间线（使用 sequence-timeline-simple）

```infographic
infographic sequence-timeline-simple
data
  title 互联网发展史
  sequences
    - time 1991
      label Web 1.0
      icon web
    - time 2004
      label Web 2.0
      icon account multiple
    - time 2023
      label AI 时代
      icon brain
```

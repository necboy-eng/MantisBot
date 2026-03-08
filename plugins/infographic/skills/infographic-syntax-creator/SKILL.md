---
name: infographic-syntax-creator
description: 根据用户描述生成 AntV Infographic 语法。当用户需要将文字描述转换为信息图 DSL 语法时使用此技能，支持流式输出。
---

# Infographic Syntax Creator - 信息图语法生成技能

本技能将用户的文字描述转换为 AntV Infographic DSL 语法，支持 AI 流式输出和实时渲染。

## 核心能力

1. **需求理解** - 分析用户描述的信息结构和关系
2. **模板匹配** - 根据内容类型选择最合适的模板
3. **语法生成** - 输出符合 AntV Infographic 规范的 DSL
4. **流式输出** - 支持边生成边渲染，增强用户体验

## 语法格式

```infographic
infographic <template-name>
data
  title 标题
  desc 描述
  lists
    - label 项 1
      desc 说明 1
    - label 项 2
      desc 说明 2
theme
  palette #3b82f6 #8b5cf6 #f97316
```

## 数据字段映射

| 内容类型 | 模板前缀 | 数据字段 |
|----------|----------|----------|
| 列举/清单 | `list-*` | `lists` |
| 顺序/步骤 | `sequence-*` | `sequences` |
| 交互流程 | `sequence-interaction-*` | `sequences` + `relations` |
| 对比分析 | `compare-*` | `compares` |
| 层级结构 | `hierarchy-*` | `root` 或 `items` |
| 关系网络 | `relation-*` | `nodes` + `relations` |
| 数据图表 | `chart-*` | `values` |

## 使用示例

### 用户输入
> 帮我生成一个产品发展路线图，包含 4 个阶段：2023 Q1 产品立项、2023 Q3 MVP 发布、2024 Q1 用户破万、2024 Q4 商业化

### 输出
```infographic
infographic sequence-roadmap-vertical-simple
data
  title 产品发展路线图
  desc 从立项到商业化的关键里程碑
  sequences
    - time 2023 Q1
      label 产品立项
      icon lightbulb
    - time 2023 Q3
      label MVP 发布
      icon launch
    - time 2024 Q1
      label 用户破万
      icon account multiple
    - time 2024 Q4
      label 商业化
      icon money
```

## 主题配置

### 预设主题

```infographic
theme light
theme dark
```

### 自定义配色

```infographic
theme
  palette #3b82f6 #8b5cf6 #f97316
```

### 特殊效果

```infographic
theme
  stylize rough
  base
    text
      font-family 851tegakizatsu
```

## 最佳实践

1. **保持简洁** - 每个节点只表达一个核心信息
2. **结构清晰** - 使用合适的字段（label/desc/value/icon）
3. **语言一致** - 尊重用户输入的语言（中文/英文）
4. **适度使用图标** - 图标应增强理解，不要过度装饰
5. **数据准确** - 数值型数据确保准确性

## 错误处理

如果用户描述不清晰，应询问澄清问题：
- 信息之间的主要关系是什么？（顺序/对比/层级/因果）
- 想要表达的核心观点是什么？
- 有特定的视觉风格偏好吗？

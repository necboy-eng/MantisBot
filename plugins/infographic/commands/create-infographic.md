---
name: create-infographic
description: 创建信息图。根据用户提供的文字内容或主题，生成并渲染信息图 HTML 文件。
---

# 创建信息图命令

## 命令用法

```
/create-infographic [主题或内容描述]
```

## 执行流程

1. **理解需求** - 分析用户想要表达的信息结构
2. **选择模板** - 根据内容类型选择合适的 infographic 模板
3. **生成语法** - 使用 AntV Infographic DSL 描述内容
4. **创建 HTML** - 生成完整的 HTML 文件，包含渲染逻辑
5. **交付用户** - 告知文件路径，指导用户用浏览器打开

## 模板选择指南

- **流程/步骤** → `sequence-*` 或 `list-row-horizontal-*`
- **时间线** → `sequence-timeline-*`
- **列举要点** → `list-grid-*` 或 `list-column-*`
- **对比分析** → `compare-*` 或 `compare-swot`
- **层级结构** → `hierarchy-*`
- **数据统计** → `chart-*`
- **关系流程** → `relation-*`

## 示例

### 示例 1：创建流程图

用户输入：
```
/create-infographic 创建一个产品开发流程，包含需求分析、设计、开发、测试、发布 5 个阶段
```

处理步骤：
1. 选择 `sequence-steps-simple` 模板
2. 生成 infographic 语法
3. 创建 HTML 文件 `产品开发流程-infographic.html`

### 示例 2：创建 SWOT 分析

用户输入：
```
/create-infographic 为我们的产品做 SWOT 分析
```

处理步骤：
1. 选择 `compare-swot` 模板
2. 根据上下文或询问用户获取具体内容
3. 生成 infographic 语法
4. 创建 HTML 文件

## 输出格式

生成的 HTML 文件应包含：
- CDN 引入 @antv/infographic
- 自适应容器 (100% 宽高)
- 初始化代码和渲染逻辑
- 字体加载处理

## 注意事项

1. 必须尊重用户输入的语言（中文/英文）
2. 图标使用简洁的关键词
3. 配色应协调，可使用默认或询问用户偏好
4. 告知用户如何用浏览器打开和导出 SVG

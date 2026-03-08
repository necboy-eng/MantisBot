# AntV Infographic 语法规范

## 语法结构

AntV Infographic 使用自定义 DSL 描述信息图渲染配置：

```infographic
infographic <template-name>
data
  title 标题
  desc 描述
  lists
    - label 项 1
      desc 说明
```

## 核心规则

1. **第一行**必须是 `infographic <template-name>`
2. 使用 `data` / `theme` 块，块内用两个空格缩进
3. 键值对使用「键 空格 值」；数组使用 `-` 作为条目前缀
4. icon 使用图标关键词（如 `star fill`）

## 数据字段选择

根据模板类型选择对应的主数据字段：

| 模板类型 | 数据字段 | 说明 |
|----------|----------|------|
| `list-*` | `lists` | 列表项 |
| `sequence-*` | `sequences` | 顺序步骤 |
| `sequence-interaction-*` | `sequences` + `relations` | 交互流程/时序图 |
| `compare-*` | `compares` | 对比项 |
| `hierarchy-tree-*` | `root` | 树形结构 |
| `hierarchy-structure` | `items` | 层级结构 |
| `relation-*` | `nodes` + `relations` | 关系图 |
| `chart-*` | `values` | 图表数据 |
| 不确定 | `items` | 兜底字段 |

## 主题配置

### 基本主题

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

### 渐变效果

```infographic
infographic list-row-simple
theme
  stylize linear-gradient
```

## 图标使用

图标使用关键词格式：

- 单个图标：`icon star`
- 多个图标：`icon secure shield check`
- 带填充：`icon star fill`
- Mingcute 图标：`icon mingcute/computer-line`

## 关系图边语法

```infographic
infographic relation-dagre-flow-tb-simple-circle-node
data
  nodes
    - id A
      label Node A
    - id B
      label Node B
  relations
    A - approves -> B
    A -->|blocks| B
```

## 交互时序图

```infographic
infographic sequence-interaction-compact-animated-badge-card
data
  title TCP 三次握手
  sequences
    - label 客户端
      children
        - label CLOSED
          id client-closed
          step 0
        - label SYN-SENT
          id client-syn-sent
          step 2
    - label 服务器
      children
        - label LISTEN
          id server-listen
          step 1
  relations
    client-closed - SYN=1 -> server-listen
    server-listen - SYN=1, ACK=1 -> client-syn-sent
    client-syn-sent - ACK=1 -> server-syn-rcvd
```

## 完整示例

### 列举型信息图

```infographic
infographic list-grid-badge-card
data
  title 核心功能
  lists
    - label 快速部署
      desc 一键发布到云端
      icon flash fast
    - label 安全防护
      desc 企业级数据保护
      icon secure shield check
    - label 数据分析
      desc 实时业务洞察
      icon chart line
```

### 对比型信息图

```infographic
infographic compare-binary-horizontal-badge-card-arrow
data
  title 方案对比
  compares
    - label 方案 A
      children
        - label 成本低
        - label 实施快
    - label 方案 B
      children
        - label 功能全
        - label 扩展强
```

### 词云图

```infographic
infographic chart-wordcloud
data
  values
    - label AI
      value 100
    - label 大数据
      value 85
    - label 云计算
      value 72
    - label 区块链
      value 65
```

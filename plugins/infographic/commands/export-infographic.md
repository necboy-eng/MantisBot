---
name: export-infographic
description: 导出信息图为 SVG 格式。将已创建的信息图 HTML 文件导出为 SVG 格式，便于分享和打印。
---

# 导出信息图命令

## 命令用法

```
/export-infographic [文件路径或 URL]
```

## 功能说明

此命令用于将信息图 HTML 文件导出为 SVG 格式，便于：
- 在文档中嵌入
- 打印输出
- 分享到社交媒体
- 进一步编辑

## 执行流程

1. **读取 HTML 文件** - 从指定路径或最近创建的信息图
2. **提取语法** - 从 HTML 中提取 infographic DSL
3. **生成 SVG** - 使用 @antv/infographic 的 toDataURL 方法
4. **保存文件** - 保存为 .svg 文件

## 示例

### 示例 1：导出最近创建的信息图

用户输入：
```
/export-infographic
```

处理：导出最近创建的信息图为 SVG

### 示例 2：导出指定文件

用户输入：
```
/export-infographic 产品开发流程-infographic.html
```

处理：导出指定文件为 SVG

## 输出

- SVG 文件路径：`[原文件名]-export.svg`
- 告知用户文件位置
- 提示如何在其他应用中使用

## 技术实现

使用 AntV Infographic 的导出功能：

```javascript
const svgDataUrl = await infographic.toDataURL({
  type: 'svg',
  width: 1920,
  height: 1080
});
```

## 注意事项

1. 确保 HTML 文件存在且可访问
2. SVG 导出需要等待字体加载完成
3. 导出前确保信息图已完全渲染
